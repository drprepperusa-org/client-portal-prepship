// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { activeClientPredicate, orderScopePredicate } from '../../lib/client-portal/predicates';
import { getClientPortalDashboardSummary } from '../../lib/client-portal/read-models/dashboard';
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
  // CP-049: the backend owns the complete scoped Dashboard DTO. The browser
  // receives full-window aggregates and never fans out or folds business facts.
  const summary = await getClientPortalDashboardSummary({
    scope,
    dateFrom: from,
    dateTo: to,
    clientId,
    storeId,
  });
  await recordPortalAudit('portal.dashboard.view', scope, { from, to });
  return c.json(summary);
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
