import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { carrierAccountClients, carrierAccounts } from '../db/schema/carrier-accounts';
import { clients } from '../db/schema/clients';
import { inventory } from '../db/schema/inventory';
import { orders } from '../db/schema/orders';
import { shipments } from '../db/schema/shipments';
import { isAdminEmail } from '../lib/admin-emails';
import {
  toPortalIntegrationDto,
  toPortalInventoryDto,
  toPortalOrderDto,
  toPortalShipmentDto,
} from '../lib/client-portal/dto';
import { recordPortalAudit } from '../lib/client-portal/audit';
import {
  assertClientPortalScope,
  isClientPortalScope,
  type ClientPortalScope,
} from '../lib/client-portal/scope';

const app = new Hono();

function parsePage(value: string | undefined, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePageSize(value: string | undefined, fallback = 25, max = 200) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clientScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  if (!scope.clientIds.length) return sql`false`;
  return inArray(clients.id, scope.clientIds);
}

function orderScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(inArray(orders.clientId, scope.clientIds));
  if (scope.storeIds.length) predicates.push(inArray(orders.storeId, scope.storeIds));
  if (!predicates.length) return sql`false`;
  return predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
}

function inventoryScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(inArray(inventory.clientId, scope.clientIds));
  if (scope.storeIds.length) {
    predicates.push(sql`exists (
      select 1 from ${clients} scoped_client
      where scoped_client.id = ${inventory.clientId}
        and scoped_client.store_ids && ${scope.storeIds}::int[]
    )`);
  }
  if (!predicates.length) return sql`false`;
  return predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
}

function shipmentScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) predicates.push(inArray(shipments.clientId, scope.clientIds));
  if (scope.storeIds.length) {
    predicates.push(sql`exists (
      select 1 from ${orders} scoped_order
      where scoped_order.id = ${shipments.orderId}
        and scoped_order.store_id in (${sql.join(scope.storeIds.map((id) => sql`${id}`), sql`, `)})
    )`);
  }
  if (!predicates.length) return sql`false`;
  return predicates.length === 1 ? predicates[0] : (or(...predicates) ?? sql`false`);
}

function scopeOrResponse(c: Context) {
  const scope = assertClientPortalScope(c);
  return isClientPortalScope(scope) ? scope : scope;
}

app.get('/me', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.me.view', scope);
  return c.json({
    id: scope.userId || null,
    email: scope.email ?? null,
    role: scope.role ?? null,
    isAdmin: isAdminEmail(scope.email),
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
  });
});

app.get('/dashboard', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('from')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('to')) ?? new Date();
  const where = and(orderScopePredicate(scope), gte(orders.orderDate, from), lte(orders.orderDate, to));
  const rows = await db.select().from(orders).where(where).limit(1000);
  const revenue = scope.canViewFinancials
    ? rows.reduce((sum, row) => sum + Number(row.orderTotal ?? 0), 0)
    : 0;
  const units = rows.reduce((sum, row) => sum + safeItemQty(row.items), 0);
  await recordPortalAudit('portal.dashboard.view', scope, { from, to, rows: rows.length });
  return c.json({
    revenue,
    units,
    bySku: topSkuRows(rows),
    dailyRevenue: [],
  });
});

app.get('/daily-counts', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('from')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('to')) ?? new Date();
  const rows = await db.execute<{
    day: string;
    order_status: string;
    count: number;
  }>(sql`
    select to_char(order_date::date, 'YYYY-MM-DD') as day,
           order_status,
           count(*)::int as count
    from orders
    where order_date >= ${from}
      and order_date <= ${to}
      ${orderScopePredicate(scope) ? sql`and ${orderScopePredicate(scope)}` : sql``}
    group by day, order_status
    order by day asc
  `);
  const byDay = new Map<string, { day: string; awaiting: number; shipped: number; cancelled: number; total: number }>();
  for (const row of rows) {
    const current = byDay.get(row.day) ?? { day: row.day, awaiting: 0, shipped: 0, cancelled: 0, total: 0 };
    current.total += row.count;
    if (row.order_status === 'awaiting_shipment') current.awaiting += row.count;
    if (row.order_status === 'shipped') current.shipped += row.count;
    if (row.order_status === 'cancelled') current.cancelled += row.count;
    byDay.set(row.day, current);
  }
  await recordPortalAudit('portal.dashboard.daily_counts', scope, { from, to });
  return c.json({ data: [...byDay.values()] });
});

app.get('/orders', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const status = c.req.query('status');
  const where = and(
    orderScopePredicate(scope),
    status ? eq(orders.orderStatus, status) : undefined,
  );
  const rows = await db
    .select()
    .from(orders)
    .where(where)
    .orderBy(desc(orders.orderDate), desc(orders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.orders.list', scope, { status: status ?? 'all', page, pageSize });
  return c.json({
    data: rows.map((row) => toPortalOrderDto(row, { includeFinancials: scope.canViewFinancials })),
    pagination: {
      page,
      pageSize,
      total: Number(count),
      totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
    },
  });
});

app.get('/orders/:id{[0-9]+}', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(orders).where(and(eq(orders.id, id), orderScopePredicate(scope))).limit(1);
  if (!row) return c.json({ error: 'Order not found' }, 404);
  await recordPortalAudit('portal.orders.detail.view', scope, { orderId: id });
  return c.json({ data: toPortalOrderDto(row, { includeFinancials: scope.canViewFinancials }) });
});

app.get('/shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const where = and(eq(shipments.voided, false), shipmentScopePredicate(scope));
  const rows = await db
    .select()
    .from(shipments)
    .where(where)
    .orderBy(desc(shipments.shipDate), desc(shipments.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(shipments).where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.shipments.list', scope, { page, pageSize });
  return c.json({
    data: rows.map(toPortalShipmentDto),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

app.get('/inventory', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const page = parsePage(c.req.query('page'));
  const pageSize = parsePageSize(c.req.query('pageSize'));
  const where = and(eq(inventory.active, true), inventoryScopePredicate(scope));
  const rows = await db
    .select()
    .from(inventory)
    .where(where)
    .orderBy(desc(inventory.updatedAt), desc(inventory.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(inventory).where(where);
  const count = countRows[0]?.count ?? rows.length;
  await recordPortalAudit('portal.inventory.list', scope, { page, pageSize });
  return c.json({
    data: rows.map(toPortalInventoryDto),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  });
});

app.get('/analysis', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const rows = await db.select().from(inventory).where(and(eq(inventory.active, true), inventoryScopePredicate(scope))).limit(200);
  await recordPortalAudit('portal.analysis.view', scope);
  return c.json({
    data: rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      inv_sku_id: row.id,
      invSkuId: row.id,
      imageUrl: row.imageUrl,
      orders: 0,
      pending: 0,
      ext_shipped: 0,
      total_qty: 0,
      total_revenue: null,
      total_shipping: null,
      daily_qty: [],
    })),
    dateBuckets: [],
    totalSkus: rows.length,
    totalOrders: 0,
  });
});

app.get('/reports', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.reports.view', scope);
  return c.json({ data: [], grandTotal: 0 });
});

app.get('/integrations', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const carrierRows = await db
    .select({
      id: carrierAccounts.id,
      clientId: carrierAccounts.clientId,
      provider: carrierAccounts.provider,
      label: carrierAccounts.label,
      accountIdentifier: carrierAccounts.accountIdentifier,
      source: carrierAccounts.source,
      active: carrierAccounts.active,
      createdAt: carrierAccounts.createdAt,
      updatedAt: carrierAccounts.updatedAt,
      assignedClientId: carrierAccountClients.clientId,
    })
    .from(carrierAccounts)
    .leftJoin(carrierAccountClients, eq(carrierAccountClients.carrierAccountId, carrierAccounts.id))
    .where(and(eq(carrierAccounts.active, true), carrierScopePredicate(scope)));

  const byId = new Map<number, ReturnType<typeof toPortalIntegrationDto>>();
  for (const row of carrierRows) {
    const existing = byId.get(row.id);
    const assignedClientIds = [
      ...(existing?.assignedClientIds ?? []),
      ...(row.assignedClientId ? [row.assignedClientId] : []),
    ];
    byId.set(row.id, toPortalIntegrationDto({ ...row, type: 'carrier', assignedClientIds }));
  }

  const storeRows = await storeAccountRows(scope);
  await recordPortalAudit('portal.integrations.list', scope, { carriers: byId.size, stores: storeRows.length });
  return c.json({ data: [...storeRows, ...byId.values()] });
});

app.get('/activity', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.activity.view', scope);
  return c.json({ data: [] });
});

function carrierScopePredicate(scope: ClientPortalScope): SQL | undefined {
  if (!scope.isRestricted) return undefined;
  const predicates: SQL[] = [];
  if (scope.clientIds.length) {
    predicates.push(inArray(carrierAccounts.clientId, scope.clientIds));
    predicates.push(inArray(carrierAccountClients.clientId, scope.clientIds));
  }
  if (!predicates.length) return sql`false`;
  return or(...predicates) ?? sql`false`;
}

async function storeAccountRows(scope: ClientPortalScope) {
  try {
    const rows = await db.execute<{
      id: number;
      clientId: number | null;
      provider: string | null;
      label: string | null;
      accountIdentifier: string | null;
      source: string | null;
      active: boolean | null;
      createdAt: Date | string | null;
      updatedAt: Date | string | null;
    }>(sql`
      select id,
             client_id as "clientId",
             provider,
             label,
             account_identifier as "accountIdentifier",
             source,
             active,
             created_at as "createdAt",
             updated_at as "updatedAt"
      from store_accounts
      where coalesce(active, true) = true
        ${scope.isRestricted && scope.clientIds.length ? sql`and client_id in (${sql.join(scope.clientIds.map((id) => sql`${id}`), sql`, `)})` : sql``}
      order by created_at desc
      limit 200
    `);
    return rows.map((row) => toPortalIntegrationDto({ ...row, type: 'store' }));
  } catch (err) {
    console.warn('[client-portal] store account list unavailable:', err);
    return [];
  }
}

function safeItemQty(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    const qty = Number((item as Record<string, unknown>).quantity ?? (item as Record<string, unknown>).qty ?? 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

function topSkuRows(rows: Array<typeof orders.$inferSelect>) {
  const bySku = new Map<string, { sku: string; units30: number; units7: number; revenue: number }>();
  for (const row of rows) {
    if (!Array.isArray(row.items)) continue;
    for (const item of row.items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const sku = typeof record.sku === 'string' && record.sku.trim() ? record.sku : 'unknown';
      const qty = Number(record.quantity ?? record.qty ?? 0);
      const current = bySku.get(sku) ?? { sku, units30: 0, units7: 0, revenue: 0 };
      current.units30 += Number.isFinite(qty) ? qty : 0;
      bySku.set(sku, current);
    }
  }
  return [...bySku.values()].sort((a, b) => b.units30 - a.units30).slice(0, 10);
}

export default app;
