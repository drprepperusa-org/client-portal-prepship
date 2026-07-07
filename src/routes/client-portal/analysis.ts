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
  // CP-010: redact per-SKU revenue for non-financial users so the table stays
  // consistent with the (already redacted) canonical Revenue KPI below.
  // CP-038: expose the canonical per-SKU billed shipping under the client-facing
  // intent name `billedShippingTotal` (customer_billed basis, see above). The
  // internal owner keeps `total_shipping`; only this boundary DTO is renamed, so
  // no cost/allocation-named key reaches the customer bundle or network payload.
  const toClientRow = ({ total_shipping, ...r }: (typeof result.rows)[number]) => ({
    ...r,
    billedShippingTotal: total_shipping,
  });
  const rows = scope.canViewFinancials
    ? result.rows.map(toClientRow)
    : result.rows.map((r) => toClientRow({ ...r, total_revenue: '0' }));
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
  // CP-018: the client portal never exposes carrier/service identity. The shared
  // sku-orders service keeps carrier_code/service_code for the operator inventory
  // drawer; strip them from every row here at the client-portal boundary.
  // CP-038: rename the per-order + summary shipping to a client-facing CHARGE and drop
  // the internal *_cost/*_total variants so no cost-named key reaches the client bundle.
  const { avgStandardShippingCost, ...rest } = result;
  return c.json({
    ...rest,
    avgShippingCharge: avgStandardShippingCost,
    orders: result.orders.map((o) => ({
      order_id: o.order_id,
      order_number: o.order_number,
      order_date: o.order_date,
      order_status: o.order_status,
      ship_to_name: o.ship_to_name,
      // CP-018: never expose carrier/service identity to the client.
      carrier_code: null,
      service_code: null,
      qty: o.qty,
      unit_price: o.unit_price,
      item_name: o.item_name,
      shippingCharge: o.standard_shipping_cost,
      is_external_shipped: o.is_external_shipped,
    })),
  });
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
