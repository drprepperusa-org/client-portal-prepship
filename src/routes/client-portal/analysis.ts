// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { inventory } from '../../db/schema/inventory';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope } from '../../lib/client-portal/scope';
import { inventoryScopePredicate, rawOrderScopeForAlias, shipmentScopePredicate } from '../../lib/client-portal/predicates';
import { getSkuBreakdownFromOrderItems } from '../analysis';
import { getSkuOrdersForSku } from '../../services/sku-orders';
import { parseDate, parsePageSize, parsePositiveInt, asTimestamp, requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

type ClientAnalysisSourceRow = Awaited<
  ReturnType<typeof getSkuBreakdownFromOrderItems>
>['rows'][number];
type ClientAnalysisSkuOrdersSource = Awaited<ReturnType<typeof getSkuOrdersForSku>>;
type ClientAnalysisSkuOrderSource = ClientAnalysisSkuOrdersSource['orders'][number];

export type ClientAnalysisSkuRow = {
  sku: string;
  name: string | null;
  image_url: string | null;
  inv_sku_id: number | null;
  client_id: number | null;
  client_name: string | null;
  orders: number;
  pending: number;
  total_qty: number;
  total_revenue: string;
  daily_qty: number[];
};

export function toClientAnalysisRow(
  row: ClientAnalysisSourceRow,
  canViewFinancials: boolean,
): ClientAnalysisSkuRow {
  return {
    sku: row.sku,
    name: row.name,
    image_url: row.image_url,
    inv_sku_id: row.inv_sku_id,
    client_id: row.client_id,
    client_name: row.client_name,
    orders: row.orders,
    pending: row.pending,
    total_qty: row.total_qty,
    total_revenue: canViewFinancials ? row.total_revenue : '0',
    daily_qty: row.daily_qty,
  };
}

export type ClientAnalysisSkuOrderDto = {
  order_id: number;
  order_number: string;
  order_date: string | null;
  order_status: string;
  ship_to_name: string | null;
  qty: number;
  unit_price: string | null;
  item_name: string | null;
  shippingCharge: string | null;
};

export type ClientAnalysisSkuOrdersDto = {
  sku: string;
  name: string | null;
  totalUnits: number;
  avgShippingCharge: string;
  averageUnitsPerDay: number;
  dailySales: Array<{ day: string; units: number }>;
  orders: ClientAnalysisSkuOrderDto[];
};

export function toClientAnalysisSkuOrderDto(order: ClientAnalysisSkuOrderSource): ClientAnalysisSkuOrderDto {
  return {
    order_id: order.order_id,
    order_number: order.order_number,
    order_date: order.order_date,
    order_status: order.order_status,
    ship_to_name: order.ship_to_name,
    qty: order.qty,
    unit_price: order.unit_price,
    item_name: order.item_name,
    shippingCharge: order.standard_shipping_cost,
  };
}

export function toClientAnalysisSkuOrdersDto(result: ClientAnalysisSkuOrdersSource): ClientAnalysisSkuOrdersDto {
  return {
    sku: result.sku,
    name: result.name,
    totalUnits: result.totalUnits,
    avgShippingCharge: result.avgStandardShippingCost,
    // Backend owner: totalUnits / dense dailySales buckets for the requested
    // inclusive date window. Empty windows return zero.
    averageUnitsPerDay: result.dailySales.length > 0 ? result.totalUnits / result.dailySales.length : 0,
    dailySales: result.dailySales.map((point) => ({ day: point.day, units: point.units })),
    orders: result.orders.map(toClientAnalysisSkuOrderDto),
  };
}

app.get('/analysis', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const to = parseDate(c.req.query('dateTo')) ?? new Date();
  const from = parseDate(c.req.query('dateFrom')) ?? new Date(to.getTime() - 29 * 86_400_000);
  const limit = parsePageSize(c.req.query('limit'), 200, 2000);
  const result = await getSkuBreakdownFromOrderItems({
    dateFrom: asTimestamp(from),
    dateTo: asTimestamp(to),
    limit,
    clientId: requestedClientId(c) ?? undefined,
    storeId: requestedStoreId(c) ?? undefined,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
    canViewFinancials: scope.canViewFinancials,
    hideTestOrders: false,
    includeCancelled: false,
    includeOrderCombinations: true,
    // CP-038: the client Analysis table reads the canonical billed shipping.
    shippingBasis: 'customer_billed',
  });
  await recordPortalAudit('portal.analysis.view', scope);
  // CP-047: this explicit whitelist is the customer Analysis API contract.
  // Shared operator/debug rows may keep internal shipping and fee metrics, but
  // those fields never cross the Client Portal boundary.
  const rows = result.rows.map((row) => toClientAnalysisRow(row, scope.canViewFinancials));
  return c.json({
    data: rows,
    dateBuckets: result.dateBuckets,
    totalSkus: result.totalSkus,
    totalOrders: result.totalOrders,
    // CP-010: backend-owned canonical KPI totals (financially redacted). The
    // frontend renders these instead of reducing the SKU rows itself.
    totalRevenue: result.totalRevenue,
    totalUnits: result.totalUnits,
    orderCombinations: result.orderCombinations,
  });
});

// Per-SKU "Recent Orders" payload for the Analysis page detail drawer.
// Portal counterpart of the operator GET /inventory/:id/sku-orders route —
// it resolves the inventory row *within the caller's scope* (so a client can
// only inspect their own SKUs) and feeds the shared READ-only analytics
// helper a tenant-scoped order predicate.
app.get('/analysis/sku-orders', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const inventoryId = parsePositiveInt(c.req.query('inventoryId') ?? c.req.query('invSkuId'));
  if (!inventoryId) return c.json({ error: 'inventoryId is required' }, 400);

  const to = parseDate(c.req.query('dateTo')) ?? new Date();
  const from = parseDate(c.req.query('dateFrom')) ?? new Date(to.getTime() - 29 * 86_400_000);
  const clientId = requestedClientId(c);
  const storeId = requestedStoreId(c);

  let [item] = await db
    .select({ sku: inventory.sku, name: inventory.name, clientId: inventory.clientId })
    .from(inventory)
    .where(and(eq(inventory.id, inventoryId), inventoryScopePredicate(scope, { clientId, storeId })))
    .limit(1);
  // The Analysis SKU table resolves inv_sku_id to ONE inventory row per SKU
  // (globally, smallest id) — which can be a client_id=NULL / other-client row a
  // scoped caller can't open, even though their own orders carry that SKU. When
  // the exact id isn't in scope, fall back to the caller's OWN inventory row for
  // the same SKU. Still scope-checked, and the analytics below only ever read
  // the caller's orders (orderScopeSql), so this never widens visibility.
  if (!item) {
    const [ref] = await db
      .select({ sku: inventory.sku })
      .from(inventory)
      .where(eq(inventory.id, inventoryId))
      .limit(1);
    if (ref?.sku) {
      [item] = await db
        .select({ sku: inventory.sku, name: inventory.name, clientId: inventory.clientId })
        .from(inventory)
        .where(and(sql`lower(${inventory.sku}) = lower(${ref.sku})`, inventoryScopePredicate(scope, { clientId, storeId })))
        .limit(1);
    }
  }
  if (!item) return c.json({ error: 'Inventory item not found' }, 404);

  const result = await getSkuOrdersForSku({
    sku: item.sku,
    name: item.name,
    clientId: item.clientId,
    dateFrom: asTimestamp(from),
    dateTo: asTimestamp(to),
    canViewFinancials: scope.canViewFinancials,
    orderScopeSql: rawOrderScopeForAlias(scope, { clientId, storeId }),
    // CP-038: the client SKU drawer reads the canonical billed shipping.
    shippingBasis: 'customer_billed',
  });

  await recordPortalAudit('portal.analysis.sku_orders', scope, { inventoryId, orders: result.orders.length });
  // CP-050: explicit top-level and per-order whitelists prevent shared
  // operator/debug fields from crossing the customer boundary.
  return c.json(toClientAnalysisSkuOrdersDto(result));
});

app.get('/daily-shipments', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const from = parseDate(c.req.query('dateFrom')) ?? new Date(Date.now() - 30 * 86_400_000);
  const to = parseDate(c.req.query('dateTo')) ?? new Date();
  const scopePredicate = shipmentScopePredicate(scope, { clientId: requestedClientId(c), storeId: requestedStoreId(c) });
  const rows = await db.execute<{ day: string; shipments: number }>(sql`
    select to_char(ship_date::date, 'YYYY-MM-DD') as day,
           count(*)::int as shipments
    from shipments
    where coalesce(voided, false) = false
      and ship_date >= ${asTimestamp(from)}
      and ship_date <= ${asTimestamp(to)}
      ${scopePredicate ? sql`and ${scopePredicate}` : sql``}
    group by day
    order by day asc
  `);
  await recordPortalAudit('portal.analysis.daily_shipments', scope, { from, to });
  return c.json({ data: rows });
});

export default app;
