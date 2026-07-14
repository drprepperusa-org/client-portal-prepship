// Dashboard analytics read-model (CP-021).
//
// SOT rule: the Dashboard's Top-SKUs ranking, per-SKU units, and per-SKU Avg
// Shipping (CHARGE) are business rankings/financials and MUST come from the ONE
// canonical Analysis SKU owner — set-based SQL over `order_items` — NOT from a
// capped/sampled `orders.limit(1000)` array folded + `.sort().slice()`-ed in the
// frontend (the old topSkuRows(rows) path, which drifted from Analysis as order
// volume grew past the 1000-row sample). CP-038: the client passes `customer_billed`,
// so per-SKU shipping is the canonical billed customer charge, not the house markup.
//
// This module is a thin projection over `getSkuBreakdownFromOrderItems` (the
// exact function the Analysis page consumes). Because it runs the SAME query for
// the SAME scope/date window, numeric parity with the Analysis Top-SKUs table is
// STRUCTURALLY GUARANTEED — there is no second definition to drift.
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import {
  getSkuBreakdownFromOrderItems,
  type SkuBreakdownQuery,
} from '../../../routes/analysis';
import { buildDashboardDailyRows } from '../dashboard-aggregate';
import {
  activeClientPredicate,
  orderScopePredicate,
  shipmentScopePredicate,
  visibleAwaitingOrdersPredicate,
} from '../predicates';
import type { ClientPortalScope } from '../scope';
import { awaitingActiveOrderCount } from './orders';
import type { DashboardSummary } from '../contracts/dashboard';

/** One ranked Dashboard Top-SKU row. Every field is backend-owned and already
 *  financially redacted by the canonical owner; the frontend only renders it. */
export interface DashboardTopSkuRow {
  sku: string;
  name: string | null;
  /** Ordered units in the window (Analysis `total_qty`). The Dashboard label is
   *  "Unit Count Last 30 Days"; the number is identical to the Analysis row. */
  units30: number;
  /** Σ(unit_price × qty) product revenue (Analysis `total_revenue`). Zero when
   *  the caller can't view financials — the owner enforces that, not the UI. */
  revenue: number;
  /**
   * CP-038: Avg shipping CHARGE per shipped unit for this SKU — the client's BILLED
   * shipping (billing_line_items, `customer_billed` basis) allocated over the
   * shipped-with-charge unit denominator (`std_qty_total + exp_qty_total`), or `null`
   * when no shipped unit of this SKU carried a billed shipping charge (rendered "—").
   * Always `null` when the caller may not view financials (shipping is zeroed upstream).
   */
  avgShippingPrice: number | null;
}

type AnalysisSkuRow = Awaited<ReturnType<typeof getSkuBreakdownFromOrderItems>>['rows'][number];

export function projectDashboardTopSkus(
  rows: AnalysisSkuRow[],
  limit = 10,
): DashboardTopSkuRow[] {
  return rows.slice(0, limit).map((row) => {
    const billedShipping = Number(row.total_shipping ?? 0);
    const chargedUnits = Number(row.std_qty_total ?? 0) + Number(row.exp_qty_total ?? 0);
    const hasShipping = billedShipping > 0 && chargedUnits > 0;
    return {
      sku: row.sku,
      name: row.name ?? null,
      units30: Number(row.total_qty ?? 0),
      revenue: Number(row.total_revenue ?? 0) || 0,
      avgShippingPrice: hasShipping ? billedShipping / chargedUnits : null,
    };
  });
}

/**
 * Ranked Top-SKUs for the Dashboard widget, computed by the canonical Analysis
 * SKU owner. `limit` caps how many ranked rows come back (the owner orders by
 * units desc); the underlying aggregation is set-based, so the ranking is over
 * EVERY in-scope order, not a 1000-row sample.
 */
export async function dashboardTopSkus(
  q: SkuBreakdownQuery,
  limit = 10,
): Promise<DashboardTopSkuRow[]> {
  // CP-038: the client Dashboard reads the CANONICAL billed shipping, not the inline
  // markup re-derivation — `customer_billed` sums billing_line_items shipping lines.
  const result = await getSkuBreakdownFromOrderItems({ ...q, shippingBasis: 'customer_billed' });
  // `result.rows` are already ordered by total_qty desc and financially redacted
  // (std/exp/total_shipping/total_revenue zeroed when canViewFinancials is false).
  return projectDashboardTopSkus(result.rows, limit);
}

export interface DashboardSummaryQuery {
  scope: ClientPortalScope;
  dateFrom: Date;
  dateTo: Date;
  clientId?: number | null;
  storeId?: number | null;
}

/**
 * Full-scope Dashboard read model. One HTTP request reaches this owner; all
 * tenant/store unions and business aggregates stay in set-based backend SQL.
 */
export async function getClientPortalDashboardSummary(
  input: DashboardSummaryQuery,
): Promise<DashboardSummary> {
  const { scope, dateFrom, dateTo, clientId, storeId } = input;
  const filters = { clientId, storeId };
  const orderDay = sql<string>`to_char(${orders.orderDate} at time zone 'UTC', 'YYYY-MM-DD')`;
  const shipmentDay = sql<string>`to_char(${shipments.shipDate} at time zone 'UTC', 'YYYY-MM-DD')`;
  const salesQuery: SkuBreakdownQuery = {
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
    clientId: clientId ?? undefined,
    storeId: storeId ?? undefined,
    clientIds: scope.clientIds,
    storeIds: scope.storeIds,
    scopeRestricted: scope.isRestricted,
    canViewFinancials: scope.canViewFinancials,
    includeCancelled: false,
    hideTestOrders: false,
    includeOrderCombinations: false,
    shippingBasis: 'customer_billed',
    limit: 10,
  };

  const [analysis, statusRows, shipmentRows, openOrderCount] = await Promise.all([
    getSkuBreakdownFromOrderItems(salesQuery),
    db
      .select({
        day: orderDay,
        awaiting: sql<number>`count(*) filter (
          where ${orders.orderStatus} = 'awaiting_shipment'
            and ${visibleAwaitingOrdersPredicate()}
        )::int`,
        shipped: sql<number>`count(*) filter (where ${orders.orderStatus} = 'shipped')::int`,
        cancelled: sql<number>`count(*) filter (where ${orders.orderStatus} = 'cancelled')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(
        orderScopePredicate(scope, { clientId, storeId }),
        activeClientPredicate(),
        gte(orders.orderDate, dateFrom),
        lte(orders.orderDate, dateTo),
      ))
      .groupBy(orderDay)
      .orderBy(orderDay),
    db
      .select({
        day: shipmentDay,
        shipments: sql<number>`count(*)::int`,
      })
      .from(shipments)
      .where(and(
        shipmentScopePredicate(scope, { clientId, storeId }),
        eq(shipments.voided, false),
        gte(shipments.shipDate, dateFrom),
        lte(shipments.shipDate, dateTo),
      ))
      .groupBy(shipmentDay)
      .orderBy(shipmentDay),
    awaitingActiveOrderCount(scope, filters),
  ]);

  const { daily, period } = buildDashboardDailyRows(
    analysis.dailySales.map(({ day, orders: orderedOrders, units: orderedUnits }) => ({
      day,
      orders: orderedOrders,
      units: orderedUnits,
    })),
    statusRows.map((row) => ({
      day: row.day,
      awaiting: Number(row.awaiting) || 0,
      shipped: Number(row.shipped) || 0,
      cancelled: Number(row.cancelled) || 0,
      total: Number(row.total) || 0,
    })),
    shipmentRows.map((row) => ({
      day: row.day,
      shipments: Number(row.shipments) || 0,
    })),
  );

  return {
    revenue: analysis.totalRevenue,
    units: analysis.totalUnits,
    openOrderCount,
    period,
    daily,
    bySku: projectDashboardTopSkus(analysis.rows, 10),
  };
}
