import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { inventory, inventoryLedger } from '../db/schema/inventory';
import { inventorySkuParents } from '../db/schema/inventory-sku-parents';
import { orderItems } from '../db/schema/order-items';
import { orders } from '../db/schema/orders';
import { parentSkus } from '../db/schema/parent-skus';
import { offsetOf, paginated, paginationSchema } from '../lib/pagination';
import { getClientStoreScope, type ClientStoreScope } from '../lib/client-store-scope';
import { hasAppPermission } from '../middleware/auth';
import { applyMovement, inventoryStats } from '../services/inventory';
import {
  importSkusFromOrders,
  syncShipStationProducts,
} from '../services/inventory-enrichment';
import { msSince, timedInventoryStep, logSlowInventoryRoute, type InventoryRouteTimings } from '../lib/inventory-timing';
import { buildInventoryListPayload } from '../services/inventory-list';
import { skuOrdersAnalytics } from '../services/inventory-sku-orders';

const app = new Hono();

const booleanQuery = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return value;
}, z.boolean());

const activeInventoryClientPredicate = sql`(
  ${inventory.clientId} is null
  or exists (
    select 1 from clients visible_client
    where visible_client.id = ${inventory.clientId}
      and coalesce(visible_client.active, true) = true
  )
)`;

function normalizeScopeIds(values: number[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function intArraySql(values: number[]): SQL {
  return sql`array[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::int[]`;
}

function inventoryScopeFromContext(c: Context): ClientStoreScope {
  return getClientStoreScope({
    email: c.get('email' as never) as string | undefined,
    role: c.get('role' as never) as string | undefined,
    permissions: c.get('permissions' as never) as string[] | undefined,
    clientIds: c.get('clientIds' as never) as number[] | undefined,
    storeIds: c.get('storeIds' as never) as number[] | undefined,
  });
}

function canViewInventoryFinancials(c: Context): boolean {
  return hasAppPermission(
    {
      email: c.get('email' as never) as string | undefined,
      role: c.get('role' as never) as string | undefined,
      permissions: c.get('permissions' as never) as string[] | undefined,
    },
    'financials:read'
  );
}

function inventoryScopePredicate(scope: ClientStoreScope): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(scope.clientIds);
  const storeIds = normalizeScopeIds(scope.storeIds);

  if (clientIds.length) {
    predicates.push(sql`${inventory.clientId} = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`exists (
      select 1 from clients scoped_client
      where scoped_client.id = ${inventory.clientId}
        and scoped_client.store_ids && ${intArraySql(storeIds)}
    )`);
  }
  if (!predicates.length) {
    return scope.isRestricted ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

function inventoryOrderScopePredicate(scope: ClientStoreScope): SQL {
  const predicates: SQL[] = [];
  const clientIds = normalizeScopeIds(scope.clientIds);
  const storeIds = normalizeScopeIds(scope.storeIds);

  if (clientIds.length) {
    predicates.push(sql`o.client_id = any(${intArraySql(clientIds)})`);
  }
  if (storeIds.length) {
    predicates.push(sql`o.store_id = any(${intArraySql(storeIds)})`);
  }
  if (!predicates.length) {
    return scope.isRestricted ? sql`false` : sql`true`;
  }
  if (predicates.length === 1) return predicates[0]!;
  return sql`(${sql.join(predicates, sql` or `)})`;
}

const listQuery = paginationSchema.extend({
  clientId: z.coerce.number().int().optional(),
  search: z.string().optional(),
  lowStock: booleanQuery.optional(),
  active: booleanQuery.optional(),
  // Opt-in flag — when true, the response includes inventory rows
  // where active=false. Default behavior (omitted/false) keeps the
  // legacy "active-only" semantics so the rate browser, order
  // auto-fulfillment lookups, and Receive tab don't accidentally
  // start seeing deactivated SKUs. Currently only the Stock Levels
  // tab sets this when its "Active only" toolbar toggle is off.
  includeInactive: booleanQuery.optional(),
  // Emergency/debug-only escape hatch. Normal page loads must use
  // worker-generated metrics or cheap row-level fallbacks instead of
  // scanning order history live.
  liveMetrics: booleanQuery.optional(),
});

app.get('/', zValidator('query', listQuery), async (c) => {
  const routeStartedAt = performance.now();
  const timings: InventoryRouteTimings = {};
  const q = c.req.valid('query');
  const scope = inventoryScopeFromContext(c);
  const shouldRunLiveMetrics = q.liveMetrics === true;
  const where = and(
    ...[
      q.clientId !== undefined ? eq(inventory.clientId, q.clientId) : undefined,
      q.search
        ? or(
            ilike(inventory.sku, `%${q.search}%`),
            ilike(inventory.name, `%${q.search}%`)
          )
        : undefined,
      q.lowStock ? lte(inventory.stockQty, inventory.reorderLevel) : undefined,
      // Active filter: applied unless the caller explicitly asks
      // for everything via ?includeInactive=true.
      q.active !== undefined
        ? eq(inventory.active, q.active)
        : q.includeInactive ? undefined : eq(inventory.active, true),
      activeInventoryClientPredicate,
      inventoryScopePredicate(scope),
    ].filter(<T>(x: T | undefined): x is T => x !== undefined)
  );

  const { response, total, rowCount } = await buildInventoryListPayload({
    q,
    where,
    timings,
    shouldRunLiveMetrics,
  });

  logSlowInventoryRoute('list', timings, msSince(routeStartedAt), {
    page: q.page,
    pageSize: q.pageSize,
    total,
    rows: rowCount,
    clientId: q.clientId ?? null,
    hasSearch: Boolean(q.search?.trim()),
    lowStock: q.lowStock ?? false,
    active: q.active ?? null,
    includeInactive: q.includeInactive ?? false,
  });

  return c.json(response);
});

// Global ledger query — flattens the ledger across all SKUs with filters.
// Safe: the id-scoped `/:id{[0-9]+}/ledger` below won't match the literal
// string "ledger" because the regex constrains :id to digits.
const ledgerQuery = paginationSchema.extend({
  clientId: z.coerce.number().int().optional(),
  sku: z.string().optional(),
  type: z.string().optional(),
  dateStart: z.coerce.number().optional(),
  dateEnd: z.coerce.number().optional(),
});

app.get('/ledger', zValidator('query', ledgerQuery), async (c) => {
  const routeStartedAt = performance.now();
  const timings: InventoryRouteTimings = {};
  const q = c.req.valid('query');
  const ledgerScope = inventoryScopeFromContext(c);
  const dateStart = q.dateStart != null && Number.isFinite(q.dateStart) ? new Date(q.dateStart) : null;
  const dateEnd = q.dateEnd != null && Number.isFinite(q.dateEnd) ? new Date(q.dateEnd) : null;
  const where = and(
    ...[
      q.clientId !== undefined ? eq(inventory.clientId, q.clientId) : undefined,
      q.sku ? eq(inventory.sku, q.sku) : undefined,
      q.type ? eq(inventoryLedger.type, q.type) : undefined,
      dateStart && !Number.isNaN(dateStart.getTime()) ? gte(inventoryLedger.createdAt, dateStart) : undefined,
      dateEnd && !Number.isNaN(dateEnd.getTime()) ? lte(inventoryLedger.createdAt, dateEnd) : undefined,
      activeInventoryClientPredicate,
      inventoryScopePredicate(ledgerScope),
    ].filter(<T>(x: T | undefined): x is T => x !== undefined)
  );

  const [rows, countRows] = await timedInventoryStep(timings, 'pageAndCount', () =>
    Promise.all([
      db
        .select({
          id: inventoryLedger.id,
          inventoryId: inventoryLedger.inventoryId,
          sku: inventory.sku,
          name: inventory.name,
          clientId: inventory.clientId,
          type: inventoryLedger.type,
          qty: inventoryLedger.qty,
          orderId: inventoryLedger.orderId,
          note: inventoryLedger.note,
          createdBy: inventoryLedger.createdBy,
          createdAt: inventoryLedger.createdAt,
        })
        .from(inventoryLedger)
        .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
        .where(where)
        .orderBy(desc(inventoryLedger.createdAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventoryLedger)
        .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
        .where(where),
    ])
  );

  logSlowInventoryRoute('ledger', timings, msSince(routeStartedAt), {
    page: q.page,
    pageSize: q.pageSize,
    total: countRows[0]?.count ?? 0,
    rows: rows.length,
    clientId: q.clientId ?? null,
    type: q.type ?? null,
    hasSku: Boolean(q.sku?.trim()),
  });

  return c.json(paginated(rows, countRows[0]?.count ?? 0, q));
});

app.get('/stats', async (c) => {
  const clientId = c.req.query('clientId');
  const parsed = clientId !== undefined ? Number(clientId) : undefined;
  const statsScope = inventoryScopeFromContext(c);
  const stats = await inventoryStats(
    Number.isFinite(parsed as number) ? (parsed as number) : undefined,
    inventoryScopePredicate(statsScope)
  );
  return c.json(stats);
});

// v2-parity: GET /inventory/alerts?clientId=N
// Returns low-stock items (stock_qty <= reorder_level) for the given client.
// v2 computed stock by summing ledger; v4 stores stock_qty on the row, so
// the query is a simple compare.
app.get(
  '/alerts',
  zValidator('query', z.object({ clientId: z.coerce.number().int().optional() })),
  async (c) => {
    const { clientId } = c.req.valid('query');
    const alertsScope = inventoryScopeFromContext(c);
    const rows = await db
      .select({
        id: inventory.id,
        sku: inventory.sku,
        name: inventory.name,
        stock: inventory.stockQty,
        minStock: inventory.reorderLevel,
        parentSkuId: inventory.parentSkuId,
        clientId: inventory.clientId,
      })
      .from(inventory)
      .where(
        and(
          ...[
            clientId !== undefined ? eq(inventory.clientId, clientId) : undefined,
            eq(inventory.active, true),
            activeInventoryClientPredicate,
            inventoryScopePredicate(alertsScope),
            lte(inventory.stockQty, inventory.reorderLevel),
          ].filter(<T>(x: T | undefined): x is T => x !== undefined)
        )
      )
      .orderBy(inventory.stockQty);
    return c.json({ data: rows.map((r) => ({ type: 'sku' as const, ...r })) });
  }
);

app.get('/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const detailScope = inventoryScopeFromContext(c);
  const [row] = await db
    .select()
    .from(inventory)
    .where(and(eq(inventory.id, id), inventoryScopePredicate(detailScope)))
    .limit(1);
  if (!row) return c.json({ error: 'Inventory item not found' }, 404);
  return c.json(row);
});

app.get('/:id{[0-9]+}/ledger', async (c) => {
  const id = Number(c.req.param('id'));
  const ledgerDetailScope = inventoryScopeFromContext(c);
  const rows = await db
    .select({
      id: inventoryLedger.id,
      inventoryId: inventoryLedger.inventoryId,
      type: inventoryLedger.type,
      qty: inventoryLedger.qty,
      orderId: inventoryLedger.orderId,
      note: inventoryLedger.note,
      createdBy: inventoryLedger.createdBy,
      createdAt: inventoryLedger.createdAt,
    })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .where(and(eq(inventoryLedger.inventoryId, id), inventoryScopePredicate(ledgerDetailScope)))
    .orderBy(desc(inventoryLedger.createdAt))
    .limit(200);
  return c.json({ data: rows });
});

// Orders that contain this SKU, bounded by an optional date window.
// Scans orders.items JSONB for any element with {sku: <this sku>} and
// returns an ordered list for the Inventory view's "Used by" panel.
app.get(
  '/:id{[0-9]+}/sku-orders',
  zValidator(
    'query',
    z.object({
      days: z.coerce.number().int().positive().max(3650).optional(),
      dateFrom: z.string().datetime().optional(),
      dateTo: z.string().datetime().optional(),
    })
  ),
  async (c) => {
    const id = Number(c.req.param('id'));
    const { days, dateFrom, dateTo } = c.req.valid('query');
    const skuOrdersScope = inventoryScopeFromContext(c);
    const canViewFinancials = canViewInventoryFinancials(c);

    const [row] = await db
      .select({ sku: inventory.sku, name: inventory.name, clientId: inventory.clientId })
      .from(inventory)
      .where(and(eq(inventory.id, id), inventoryScopePredicate(skuOrdersScope)))
      .limit(1);
    if (!row) return c.json({ error: 'Inventory item not found' }, 404);

    const { dailySales, shippingSummary, rows } = await skuOrdersAnalytics({
      sku: row.sku,
      days,
      dateFrom,
      dateTo,
      orderScopeSql: inventoryOrderScopePredicate(skuOrdersScope),
    });

    const visibleShippingSummary = canViewFinancials ? shippingSummary : null;
    const visibleRows = canViewFinancials
      ? rows
      : rows.map((orderRow) => ({
          ...orderRow,
          shipping_cost: null,
          shipping_total: null,
          standard_shipping_cost: null,
          standard_shipping_total: null,
        }));

    return c.json({
      sku: row.sku,
      name: row.name,
      clientId: row.clientId,
      totalUnits: dailySales.reduce((sum, r) => sum + r.units, 0),
      standardShipCount: visibleShippingSummary?.standard_ship_count ?? 0,
      standardShippingTotal: visibleShippingSummary?.standard_shipping_total ?? '0',
      avgStandardShippingCost: visibleShippingSummary?.avg_standard_shipping_cost ?? '0',
      dailySales,
      orders: visibleRows,
    });
  }
);

const createBody = z.object({
  clientId: z.number().int().nullable().optional(),
  sku: z.string().min(1),
  name: z.string().optional(),
  imageUrl: z.string().url().nullable().optional(),
  stockQty: z.number().int().nonnegative().optional(),
  reorderLevel: z.number().int().nonnegative().optional(),
  baseUnitQty: z.number().int().positive().optional(),
  unitsPerPack: z.number().int().positive().optional(),
  cuFtOverride: z.number().nonnegative().nullable().optional(),
  packageId: z.number().int().positive().nullable().optional(),
  weightOz: z.number().nonnegative().nullable().optional(),
  length: z.number().nonnegative().nullable().optional(),
  width: z.number().nonnegative().nullable().optional(),
  height: z.number().nonnegative().nullable().optional(),
  // 2026-05-12: `active` was missing from this schema, so PATCHes
  // from the toolbar/per-row toggle had the field silently stripped
  // by zod's default .strip() mode — the row's updatedAt bumped but
  // the active column never changed. Adding it here makes the
  // active-only toggle and the per-row toggle actually persist.
  active: z.boolean().optional(),
});

app.post('/', zValidator('json', createBody), async (c) => {
  const body = c.req.valid('json');
  const [row] = await db.insert(inventory).values(body).returning();
  return c.json(row, 201);
});

app.patch(
  '/:id{[0-9]+}',
  zValidator('json', createBody.omit({ sku: true }).partial().extend({ sku: z.string().min(1).optional() })),
  async (c) => {
    const id = Number(c.req.param('id'));
    const body = c.req.valid('json');
    const [row] = await db
      .update(inventory)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(inventory.id, id))
      .returning();
    if (!row) return c.json({ error: 'Inventory item not found' }, 404);
    return c.json(row);
  }
);

const movementBody = z.object({
  qty: z.number().int(),
  note: z.string().optional(),
  orderId: z.number().int().optional(),
  type: z.enum(['receive', 'adjust', 'pick', 'ship', 'return', 'damage']).optional(),
  receivedAt: z.string().datetime().optional(),
  adjustedAt: z.string().datetime().optional(),
});

function movementDateFrom(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

app.post(
  '/:id{[0-9]+}/receive',
  zValidator('json', movementBody.refine((v) => v.qty > 0, 'Receive qty must be > 0')),
  async (c) => {
    const id = Number(c.req.param('id'));
    const body = c.req.valid('json');
    const email = c.get('email' as never) as string | undefined;
    const result = await applyMovement({
      inventoryId: id,
      type: 'receive',
      qty: body.qty,
      note: body.note,
      createdBy: email ?? 'manual',
      createdAt: movementDateFrom(body.receivedAt ?? body.adjustedAt),
    });
    return c.json(result);
  }
);

app.put(
  '/:id{[0-9]+}/set-parent',
  zValidator(
    'json',
    z.object({ parentSkuId: z.number().int().positive().nullable() })
  ),
  async (c) => {
    const id = Number(c.req.param('id'));
    const { parentSkuId } = c.req.valid('json');
    // Dual-write: update inventory.parentSkuId FK (primary parent — back-compat)
    // AND upsert inventory_sku_parents join (v2-parity multi-parent table).
    // When parentSkuId is null, clear both: null out the FK and delete the
    // primary row from the join.
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(inventory)
        .set({ parentSkuId, updatedAt: new Date() })
        .where(eq(inventory.id, id))
        .returning();
      if (!row) return null;

      // Clear any existing primary row for this inventory id so the unique
      // partial index doesn't fight us on a re-parent.
      await tx
        .delete(inventorySkuParents)
        .where(
          and(
            eq(inventorySkuParents.inventoryId, id),
            eq(inventorySkuParents.isPrimary, true)
          )
        );

      if (parentSkuId !== null) {
        await tx
          .insert(inventorySkuParents)
          .values({ inventoryId: id, parentSkuId, isPrimary: true })
          .onConflictDoUpdate({
            target: [inventorySkuParents.inventoryId, inventorySkuParents.parentSkuId],
            set: { isPrimary: true },
          });
      }
      return row;
    });
    if (!result) return c.json({ error: 'Inventory item not found' }, 404);
    return c.json(result);
  }
);

// v2-parity: list all parent SKUs a given inventory row belongs to (may be
// many, since an inventory item can belong to multiple bundles). Uses the
// join table + left-joins parent_skus for display fields.
app.get('/:id{[0-9]+}/parents', async (c) => {
  const id = Number(c.req.param('id'));
  const parentsScope = inventoryScopeFromContext(c);
  const rows = await db
    .select({
      parentSkuId: inventorySkuParents.parentSkuId,
      isPrimary: inventorySkuParents.isPrimary,
      createdAt: inventorySkuParents.createdAt,
      name: parentSkus.name,
      sku: parentSkus.sku,
      baseUnitQty: parentSkus.baseUnitQty,
    })
    .from(inventorySkuParents)
    .innerJoin(inventory, eq(inventory.id, inventorySkuParents.inventoryId))
    .innerJoin(parentSkus, eq(parentSkus.id, inventorySkuParents.parentSkuId))
    .where(and(eq(inventorySkuParents.inventoryId, id), inventoryScopePredicate(parentsScope)))
    .orderBy(desc(inventorySkuParents.isPrimary), parentSkus.name);
  return c.json({ data: rows });
});

// Add a non-primary parent (idempotent). For primary parent use /set-parent.
app.post(
  '/:id{[0-9]+}/add-parent',
  zValidator(
    'json',
    z.object({ parentSkuId: z.number().int().positive() })
  ),
  async (c) => {
    const id = Number(c.req.param('id'));
    const { parentSkuId } = c.req.valid('json');
    const [inv] = await db
      .select({ id: inventory.id })
      .from(inventory)
      .where(eq(inventory.id, id))
      .limit(1);
    if (!inv) return c.json({ error: 'Inventory item not found' }, 404);

    await db
      .insert(inventorySkuParents)
      .values({ inventoryId: id, parentSkuId, isPrimary: false })
      .onConflictDoNothing({
        target: [inventorySkuParents.inventoryId, inventorySkuParents.parentSkuId],
      });
    return c.json({ data: { inventoryId: id, parentSkuId, isPrimary: false } });
  }
);

// Remove a parent from the join. If it was the primary parent, also null
// out inventory.parentSkuId so the two representations stay consistent.
app.delete(
  '/:id{[0-9]+}/parents/:parentSkuId{[0-9]+}',
  async (c) => {
    const id = Number(c.req.param('id'));
    const parentSkuId = Number(c.req.param('parentSkuId'));
    const result = await db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(inventorySkuParents)
        .where(
          and(
            eq(inventorySkuParents.inventoryId, id),
            eq(inventorySkuParents.parentSkuId, parentSkuId)
          )
        )
        .returning();
      if (removed?.isPrimary) {
        await tx
          .update(inventory)
          .set({ parentSkuId: null, updatedAt: new Date() })
          .where(eq(inventory.id, id));
      }
      return removed;
    });
    if (!result) return c.json({ error: 'Parent link not found' }, 404);
    return c.json({ deleted: true, wasPrimary: result.isPrimary });
  }
);

app.post(
  '/:id{[0-9]+}/adjust',
  zValidator('json', movementBody.refine((v) => v.qty !== 0, 'Adjust qty cannot be 0')),
  async (c) => {
    const id = Number(c.req.param('id'));
    const body = c.req.valid('json');
    const email = c.get('email' as never) as string | undefined;
    const result = await applyMovement({
      inventoryId: id,
      type: body.type ?? 'adjust',
      qty: body.qty,
      note: body.note,
      createdBy: email ?? 'manual',
      createdAt: movementDateFrom(body.adjustedAt ?? body.receivedAt),
    });
    return c.json(result);
  }
);

const bulkReceiveBody = z.object({
  clientId: z.number().int().nullable().optional(),
  note: z.string().optional(),
  receivedAt: z.string().datetime().optional(),
  items: z
    .array(
      z.object({
        invSkuId: z.number().int().positive().optional(),
        inventoryId: z.number().int().positive().optional(),
        sku: z.string().trim().optional(),
        name: z.string().trim().optional(),
        qty: z.number().int().positive(),
        note: z.string().optional(),
      }).refine(
        (item) => item.invSkuId != null || item.inventoryId != null || Boolean(item.sku?.trim()),
        'Each receive item needs an inventory id or SKU'
      )
    )
    .min(1),
});

async function findOrCreateInventoryForReceive(
  item: z.infer<typeof bulkReceiveBody>['items'][number],
  clientId: number | null | undefined,
) {
  const requestedId = item.invSkuId ?? item.inventoryId;
  if (requestedId != null) {
    const [row] = await db
      .select()
      .from(inventory)
      .where(eq(inventory.id, requestedId))
      .limit(1);
    if (!row) throw new Error(`Inventory item #${requestedId} not found`);
    return row;
  }

  const sku = item.sku?.trim();
  if (!sku) throw new Error('SKU is required');
  const clientFilter = clientId == null ? isNull(inventory.clientId) : eq(inventory.clientId, clientId);
  const [existing] = await db
    .select()
    .from(inventory)
    .where(and(clientFilter, sql`lower(${inventory.sku}) = lower(${sku})`))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(inventory)
    .values({
      clientId: clientId ?? null,
      sku,
      name: item.name?.trim() || sku,
      stockQty: 0,
    })
    .returning();
  if (!created) throw new Error(`Could not create inventory item for ${sku}`);
  return created;
}

// v2-parity bulk receive: POST /inventory/receive body
// {clientId, note, receivedAt, items:[{sku|invSkuId, qty, name?, note?}]}.
// Calls applyMovement per item so every receipt lands in the ledger. Per-item
// errors are tallied without aborting the batch.
app.post(
  '/receive',
  zValidator('json', bulkReceiveBody),
  async (c) => {
    const body = c.req.valid('json');
    const email = c.get('email' as never) as string | undefined;
    const receivedAt = movementDateFrom(body.receivedAt);
    // v2-parity ReceiveInventoryResultDto adds `newStock` per item so
    // the receiving UI can display the post-receive on-hand total without a
    // round-trip fetch. applyMovement returns the updated inventory row,
    // whose stockQty IS the new on-hand total.
    const results: Array<{
      invSkuId: number;
      sku?: string | null;
      name?: string | null;
      qty?: number;
      ok: boolean;
      newStock?: number;
      ledgerId?: number;
      createdAt?: Date;
      error?: string;
    }> = [];
    for (const item of body.items) {
      try {
        const inv = await findOrCreateInventoryForReceive(item, body.clientId);
        const res = await applyMovement({
          inventoryId: inv.id,
          type: 'receive',
          qty: item.qty,
          note: item.note?.trim() || body.note?.trim() || undefined,
          createdBy: email ?? 'manual',
          createdAt: receivedAt,
        });
        results.push({
          invSkuId: inv.id,
          sku: res.inventory?.sku ?? inv.sku,
          name: res.inventory?.name ?? inv.name,
          qty: item.qty,
          ok: true,
          newStock: res.inventory?.stockQty ?? 0,
          ledgerId: res.ledger?.id,
          createdAt: res.ledger?.createdAt,
        });
      } catch (err) {
        results.push({
          invSkuId: item.invSkuId ?? item.inventoryId ?? 0,
          sku: item.sku ?? null,
          qty: item.qty,
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    const received = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    return c.json({
      ok: failed.length === 0,
      received,
      failed: failed.length,
      total: results.length,
      results,
    });
  }
);

// v2-parity single adjust: POST /inventory/adjust body {invSkuId, qty, note?}.
// Same semantic as POST /:id/adjust but v2 shape with id in the body.
app.post(
  '/adjust',
  zValidator(
    'json',
    z.object({
      invSkuId: z.number().int().positive(),
      qty: z.number().int().refine((v) => v !== 0, 'qty cannot be 0'),
      note: z.string().optional(),
      type: z.enum(['receive', 'adjust', 'pick', 'ship', 'return', 'damage']).optional(),
      adjustedAt: z.string().datetime().optional(),
      receivedAt: z.string().datetime().optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json');
    const email = c.get('email' as never) as string | undefined;
    const result = await applyMovement({
      inventoryId: body.invSkuId,
      type: body.type ?? 'adjust',
      qty: body.qty,
      note: body.note,
      createdBy: email ?? 'manual',
      createdAt: movementDateFrom(body.adjustedAt ?? body.receivedAt),
    });
    return c.json(result);
  }
);

// Bulk update of dimensions + pack-size fields for many inventory rows in one call.
// Extended for v2 parity: baseUnitQty, unitsPerPack, cuFtOverride, packageId — so
// CSV importers and bulk editors can populate the new pack-size fields without
// per-row PATCH round-trips.
const bulkDimsBody = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        weightOz: z.number().nonnegative().optional(),
        length: z.number().nonnegative().optional(),
        width: z.number().nonnegative().optional(),
        height: z.number().nonnegative().optional(),
        baseUnitQty: z.number().int().positive().optional(),
        unitsPerPack: z.number().int().positive().optional(),
        cuFtOverride: z.number().nonnegative().nullable().optional(),
        packageId: z.number().int().positive().nullable().optional(),
      })
    )
    .min(1)
    .max(500),
});

// v2-parity: POST /inventory/bulk-set-default-package
// {clientId, packageId, skus[]} — sets inventory.package_id for many SKUs in
// one call. Fired by the shipping panel when an auto-detected package can't be
// saved through the single-SKU savePanelSkuDefaults path (multi-SKU orders),
// so the same default package lands on every line item rather than only on
// single-SKU orders. clientId is required when scoping to a tenant; pass null
// to update the shared (clientId IS NULL) catalog rows.
const bulkSetPackageBody = z.object({
  clientId: z.number().int().nullable(),
  packageId: z.number().int().positive().nullable(),
  skus: z.array(z.string().trim().min(1)).min(1).max(200),
});

app.post(
  '/bulk-set-default-package',
  zValidator('json', bulkSetPackageBody),
  async (c) => {
    const { clientId, packageId, skus } = c.req.valid('json');
    let updated = 0;
    for (const rawSku of skus) {
      const sku = rawSku.trim();
      if (!sku) continue;
      const skuWhere = sql`lower(${inventory.sku}) = lower(${sku})`;
      const where = and(
        skuWhere,
        clientId === null ? isNull(inventory.clientId) : eq(inventory.clientId, clientId)
      );
      const rows = await db
        .update(inventory)
        .set({ packageId, updatedAt: new Date() })
        .where(where)
        .returning({ id: inventory.id });
      updated += rows.length;
    }
    return c.json({
      updated,
      skipped: skus.length - updated,
      total: skus.length,
    });
  }
);

app.post('/bulk-update-dims', zValidator('json', bulkDimsBody), async (c) => {
  const { items } = c.req.valid('json');
  let updated = 0;
  for (const item of items) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (item.weightOz !== undefined) patch.weightOz = item.weightOz;
    if (item.length !== undefined) patch.length = item.length;
    if (item.width !== undefined) patch.width = item.width;
    if (item.height !== undefined) patch.height = item.height;
    if (item.baseUnitQty !== undefined) patch.baseUnitQty = item.baseUnitQty;
    if (item.unitsPerPack !== undefined) patch.unitsPerPack = item.unitsPerPack;
    if (item.cuFtOverride !== undefined) patch.cuFtOverride = item.cuFtOverride;
    if (item.packageId !== undefined) patch.packageId = item.packageId;
    const [row] = await db
      .update(inventory)
      .set(patch)
      .where(eq(inventory.id, item.id))
      .returning({ id: inventory.id });
    if (row) updated += 1;
  }
  return c.json({
    updated,
    skipped: items.length - updated,
    message: `Updated ${updated} of ${items.length} items`,
  });
});

// Scan orders.items JSONB and seed inventory rows for any SKU we don't
// have yet (clientId set from the order's clientId, or null if order is
// unassigned). Useful as a quick way to populate inventory from the
// orders that already synced from ShipStation.
//
// 2026-05-13: extracted to src/services/inventory-enrichment.ts so the
// in-process scheduler can call the same logic on a 30-min interval.
// This route handler is now a thin wrapper that the Inventory toolbar's
// "📥 Import SKUs from Orders" button still drives manually.
app.post('/import-from-orders', async (c) => {
  const result = await importSkusFromOrders();
  return c.json(result);
});

// Pull product catalog from ShipStation v1 /products (every account we
// know about) and upsert as inventory rows. stockQty stays 0 — the
// standard SS API doesn't expose stock levels. Matching:
//   • Main account products → clientId IS NULL (shared catalog)
//   • Per-client accounts (e.g. KFG) → clientId = account owner
// so each client's product catalog lands on its own row and pulls its
// ShipStation thumbnail + dims + weight.
//
// 2026-05-13: extracted to src/services/inventory-enrichment.ts so the
// in-process scheduler can fire this hourly. This route handler is the
// manual path — the "📐 Import Dims from SS" toolbar button still
// drives it on demand.
app.post('/sync-products', async (c) => {
  const result = await syncShipStationProducts();
  return c.json(result);
});

export default app;
