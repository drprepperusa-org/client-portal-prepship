import { tableOrderBy, referenceOrder } from '../../lib/client-portal/read-models/table-sort';
// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { z } from 'zod';
import { exportPortalInventory, InventoryExportTooLarge } from '../../lib/client-portal/read-models/inventory-export';
import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { inventory, inventoryLedger } from '../../db/schema/inventory';
import { recordCriticalPortalAudit, recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { inventoryLedgerScopePredicate, inventoryScopePredicate } from '../../lib/client-portal/predicates';
import { listPortalInventory } from '../../lib/client-portal/read-models/inventory';
import { applyMovements } from '../../services/inventory';
import { asTimestamp, parsePage, parsePageSize, parseDate, requestedClientId, requestedStoreId, requestedSearch, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();
const inventoryQuery = z.object({
  format: z.literal('csv').optional(),
  clientId: z.coerce.number().int().positive().optional(),
  storeId: z.coerce.number().int().positive().optional(),
  lowStock: z.enum(['1', '0', 'true', 'false', 'yes', 'no']).optional(),
});

app.get('/inventory', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  c.header('Cache-Control', 'private, no-store');
  const query = inventoryQuery.safeParse(c.req.query());
  if (!query.success) return c.json({ error: 'Invalid inventory filters or export format.' }, 400);
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const search = requestedSearch(c);
  const lowStock = ['1', 'true', 'yes'].includes((c.req.query('lowStock') ?? '').toLowerCase());
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  if (query.data.format === 'csv') {
    try {
      const result = await exportPortalInventory(scope, {
        clientId, storeId, search, lowStock, sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir'),
      });
      await recordPortalAudit('portal.inventory.export', scope, { clientId, storeId, search, lowStock,
        rows: result.rows, sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir') });
      c.header('Content-Type', 'text/csv; charset=utf-8');
      c.header('Content-Disposition', 'attachment; filename="inventory.csv"');
      return c.body(result.csv);
    } catch (error) {
      if (error instanceof InventoryExportTooLarge) return c.json({ error: 'Export is too large. Narrow your filters and try again.' }, 413);
      return c.json({ error: 'Could not export inventory. Please try again.' }, 503);
    }
  }
  const result = await listPortalInventory(scope, {
    sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir'),
    page,
    pageSize,
    clientId,
    storeId,
    search,
    lowStock,
  });
  await recordPortalAudit('portal.inventory.list', scope, {
    page, pageSize, clientId, storeId, search, lowStock,
    rows: result.data.length, total: result.pagination.total,
    sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir'),
  });
  return c.json(result);
});

// Inventory movement history (audit trail) — ledger rows scoped to the
// caller's clients. Read-only. Filters: clientId, sku, type, date range.
app.get('/inventory-history', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const sku = c.req.query('sku')?.trim();
  const type = c.req.query('type')?.trim();
  const from = parseDate(c.req.query('from'));
  const to = parseDate(c.req.query('to'));
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const movementClientId = sql`coalesce(${inventoryLedger.clientId}, ${inventory.clientId})`;
  const movementSku = sql`coalesce(${inventoryLedger.sku}, ${inventory.sku})`;
  const movementClock = sql`coalesce(${inventoryLedger.effectiveAt}, ${inventoryLedger.createdAt})`;
  const where = and(
    inventoryLedgerScopePredicate(scope, { clientId, storeId }),
    sku ? ilike(movementSku, `%${sku}%`) : undefined,
    type ? eq(inventoryLedger.type, type) : undefined,
    // Explicit ::timestamptz cast, NOT drizzle gte/lte.
    //
    // movementClock is a raw coalesce() expression carrying no column type, so
    // gte(movementClock, date) bound the parameter untyped and Postgres could not
    // resolve the comparison. Every request with from/to returned 500 while an
    // unfiltered one succeeded — which is why the History tab failed but the
    // Stock Levels tab did not.
    from ? sql`${movementClock} >= ${asTimestamp(from)}::timestamptz` : undefined,
    to ? sql`${movementClock} <= ${asTimestamp(to)}::timestamptz` : undefined,
  );
  const rows = await db
    .select({
      id: inventoryLedger.id,
      sku: movementSku,
      name: inventory.name,
      clientName: clients.name,
      type: inventoryLedger.type,
      qty: inventoryLedger.qty,
      orderId: inventoryLedger.orderId,
      note: inventoryLedger.note,
      source: inventoryLedger.createdBy,
      createdAt: movementClock,
    })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .leftJoin(clients, eq(clients.id, movementClientId))
    .where(where)
    .orderBy(...tableOrderBy({ sortBy: c.req.query('sortBy'), sortDir: c.req.query('sortDir') }, {
      date: movementClock, sku: referenceOrder(movementSku), type: inventoryLedger.type,
      qty: inventoryLedger.qty, note: inventoryLedger.note, source: inventoryLedger.createdBy,
    }, [desc(movementClock), desc(inventoryLedger.id)], inventoryLedger.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.inventory.history', scope, {
    page,
    pageSize,
    clientId,
    storeId,
    sku: sku ?? null,
    type: type ?? null,
  });
  return c.json({
    data: rows.map((r) => ({ ...r, createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt })),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

app.post('/inventory/receive', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    return c.json({ error: 'Inventory receiving access required' }, 403);
  }

  const body = (await c.req.json().catch(() => ({}))) as {
    clientId?: number;
    idempotencyKey?: string;
    reference?: string;
    receivedAt?: string;
    items?: Array<{ inventoryId?: number; qty?: number }>;
  };
  const clientId = Number(body.clientId);
  const receivedAt = new Date(body.receivedAt ?? '');
  if (!Number.isInteger(clientId) || clientId <= 0) {
    return c.json({ error: 'A valid client is required' }, 400);
  }
  if (Number.isNaN(receivedAt.getTime())) {
    return c.json({ error: 'A valid received date is required' }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 200) {
    return c.json({ error: 'Add between 1 and 200 inventory items' }, 400);
  }

  const items = body.items.map((item) => ({
    inventoryId: Number(item.inventoryId),
    qty: Number(item.qty),
  }));
  if (items.some((item) => !Number.isInteger(item.inventoryId) || item.inventoryId <= 0 || !Number.isInteger(item.qty) || item.qty <= 0 || item.qty > 1_000_000)) {
    return c.json({ error: 'Every item needs a valid SKU and a whole-number quantity from 1 to 1,000,000' }, 400);
  }
  const inventoryIds = items.map((item) => item.inventoryId);
  if (new Set(inventoryIds).size !== inventoryIds.length) {
    return c.json({ error: 'Each SKU may appear only once per receive batch' }, 400);
  }

  const visibleItems = await db
    .select({ id: inventory.id })
    .from(inventory)
    .where(and(
      inArray(inventory.id, inventoryIds),
      eq(inventory.clientId, clientId),
      eq(inventory.active, true),
      inventoryScopePredicate(scope, { clientId }),
    ));
  if (visibleItems.length !== inventoryIds.length) {
    return c.json({ error: 'One or more inventory items are outside your client scope' }, 403);
  }

  const reference = body.reference?.trim().slice(0, 200) || undefined;
  const requestIdentity = body.idempotencyKey?.trim() || c.req.header('Idempotency-Key')?.trim();
  if (!requestIdentity || requestIdentity.length > 200) {
    return c.json({ error: 'A valid idempotency key is required' }, 400);
  }
  const totalUnits = items.reduce((sum, item) => sum + item.qty, 0);
  await recordCriticalPortalAudit('portal.inventory.receive.requested', scope, {
    clientId,
    inventoryIds,
    itemCount: items.length,
    totalUnits,
    receivedAt: receivedAt.toISOString(),
    reference: reference ?? null,
  });
  const results = await applyMovements(items.map((item, index) => ({
    inventoryId: item.inventoryId,
    type: 'receive',
    qty: item.qty,
    note: reference,
    createdBy: scope.email ?? scope.userId,
    effectiveAt: receivedAt,
    idempotencyKey: `portal-receive:${requestIdentity}:${index}:${item.inventoryId}`,
    sourceEntity: 'client_portal_receive',
    sourceId: `${requestIdentity}:${index}:${item.inventoryId}`,
  })));
  await recordPortalAudit('portal.inventory.receive.completed', scope, {
    clientId,
    ledgerIds: results.map((result) => result.ledger?.id).filter(Boolean),
    itemCount: results.length,
    totalUnits,
  });
  return c.json({ data: { received: results.length, totalUnits } });
});

export default app;
