// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { orders } from '../../db/schema/orders';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { activeClientPredicate, orderScopePredicate } from '../../lib/client-portal/predicates';
import { dailyOrderUnitsRows } from '../../lib/client-portal/dashboard-aggregate';
import { dashboardTopSkus } from '../../lib/client-portal/read-models/dashboard';
import { getClientPortalSalesTotals, getClientPortalDailyRevenue } from '../analysis';
import { parseDate, asTimestamp, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

app.get('/me', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const capabilities = clientPortalCapabilities(scope);
  await recordPortalAudit('portal.me.view', scope);
  return c.json({
    id: scope.userId || null,
    email: scope.email ?? null,
    role: scope.role ?? null,
    isAdmin: scope.isGlobal,
    isGlobal: scope.isGlobal,
    isRestricted: scope.isRestricted,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    permissions: scope.permissions,
    canViewFinancials: scope.canViewFinancials,
    canViewCredentials: scope.canViewCredentials,
    ...capabilities,
  });
});

app.get('/dashboard', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  // CP-010: accept dateFrom/dateTo (aligned with /analysis) with a legacy
  // from/to fallback, so Dashboard and Analysis evaluate the SAME window.
  const from = parseDate(c.req.query('dateFrom') ?? c.req.query('from')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('dateTo') ?? c.req.query('to')) ?? new Date();
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);
  const where = and(
    orderScopePredicate(scope, { clientId, storeId }),
    activeClientPredicate(),
    gte(orders.orderDate, from),
    lte(orders.orderDate, to)
  );
  // The capped orders array feeds ONLY the non-ranking per-day orders/units bar
  // chart (`daily` below) — a bounded VISUAL sample, never a business ranking or
  // financial total. Every ranked/financial number on this page comes from a
  // set-based backend owner instead (see below), so nothing truncates at 1000.
  const rows = await db.select().from(orders).where(where).limit(1000);
  // CP-010 / CP-021: Revenue + Units KPIs, the revenue drill-down, AND the
  // Top-SKUs ranking (with per-SKU units + Avg Shipping Price) all come from the
  // ONE canonical Analysis SKU owner (set-based SQL over order_items + shipment
  // label_cost allocation — no 1000-row truncation, same definition/filters as
  // the Analysis page), NEVER from folding/sorting/slicing the capped rows above.
  // Sharing the query is what STRUCTURALLY GUARANTEES Dashboard == Analysis for
  // the same window/scope (same numbers, one definition).
  const salesQuery = {
    dateFrom: asTimestamp(from),
    dateTo: asTimestamp(to),
    clientId: clientId ?? undefined,
    storeId: storeId ?? undefined,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
    canViewFinancials: scope.canViewFinancials,
    includeCancelled: false,
    hideTestOrders: false,
  };
  const [totals, dailyRevenue, bySku] = await Promise.all([
    getClientPortalSalesTotals(salesQuery),
    getClientPortalDailyRevenue(salesQuery),
    // Backend ranks the Top-SKUs (units desc) via the canonical Analysis query;
    // the frontend just renders these rows in order — no client-side ranking.
    dashboardTopSkus({ ...salesQuery, limit: 10 }, 10),
  ]);
  await recordPortalAudit('portal.dashboard.view', scope, { from, to, rows: rows.length });
  return c.json({
    revenue: totals.revenue,
    units: totals.units,
    // CP-021: canonical, Analysis-parity Top-SKUs from the shared read-model.
    bySku,
    // Order + unit counts per day power the cumulative bar chart. Counts are
    // non-financial, so they are returned regardless of canViewFinancials.
    daily: dailyOrderUnitsRows(rows),
    dailyRevenue,
  });
});

app.get('/daily-counts', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('from')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('to')) ?? new Date();
  const scopePredicate = orderScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) });
  const rows = await db.execute<{
    day: string;
    order_status: string;
    count: number;
  }>(sql`
    select to_char(order_date::date, 'YYYY-MM-DD') as day,
           order_status,
           count(*)::int as count
    from orders
    where order_date >= ${asTimestamp(from)}
      and order_date <= ${asTimestamp(to)}
      ${scopePredicate ? sql`and ${scopePredicate}` : sql``}
      and ${activeClientPredicate()}
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

app.get('/activity', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  await recordPortalAudit('portal.activity.view', scope);
  return c.json({ data: [] });
});

export default app;
