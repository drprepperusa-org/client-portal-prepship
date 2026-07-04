// Dashboard analytics read-model (CP-021).
//
// SOT rule: the Dashboard's Top-SKUs ranking, per-SKU units, and per-SKU Avg
// Shipping Price are business rankings/financials and MUST come from the ONE
// canonical Analysis SKU owner — set-based SQL over `order_items` with shipment
// `label_cost` allocation — NOT from a capped/sampled `orders.limit(1000)` array
// folded + `.sort().slice()`-ed in the frontend (the old topSkuRows(rows) path,
// which drifted from Analysis as order volume grew past the 1000-row sample).
//
// This module is a thin projection over `getSkuBreakdownFromOrderItems` (the
// exact function the Analysis page consumes). Because it runs the SAME query for
// the SAME scope/date window, numeric parity with the Analysis Top-SKUs table is
// STRUCTURALLY GUARANTEED — there is no second definition to drift.
import {
  getSkuBreakdownFromOrderItems,
  type SkuBreakdownQuery,
} from '../../../routes/analysis';

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
   * Avg Shipping Price per shipped unit for this SKU, or `null` when no shipped
   * unit of this SKU carried an allocated label cost (rendered "—", never a
   * misleading $0.00). SOT = the SAME internal allocated shipment `label_cost`
   * Analysis uses (`total_shipping`), divided by the SAME shipped-with-cost unit
   * denominator (`std_qty_total + exp_qty_total`). Always `null` when the caller
   * may not view financials (revenue/shipping are already zeroed upstream).
   */
  avgShippingPrice: number | null;
  /** Numerator/denominator behind `avgShippingPrice`, so the UI can show the
   *  literal calculation ($shipAlloc ÷ shipUnits = avg) instead of prose. Both
   *  `null` exactly when `avgShippingPrice` is `null`. */
  shipAlloc: number | null;
  shipUnits: number | null;
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
  const result = await getSkuBreakdownFromOrderItems(q);
  // `result.rows` are already ordered by total_qty desc and financially redacted
  // (std/exp/total_shipping/total_revenue zeroed when canViewFinancials is false).
  return result.rows.slice(0, limit).map((r) => {
    const shipAllocRaw = Number(r.total_shipping ?? 0);
    // Shipped-with-cost unit denominator — the SAME basis the allocated
    // total_shipping was summed over (std + exp shipped units carrying cost).
    const shipUnits = Number(r.std_qty_total ?? 0) + Number(r.exp_qty_total ?? 0);
    const hasShipping = shipAllocRaw > 0 && shipUnits > 0;
    const shipAlloc = hasShipping ? Math.round(shipAllocRaw * 100) / 100 : null;
    return {
      sku: r.sku,
      name: r.name ?? null,
      units30: Number(r.total_qty ?? 0),
      revenue: Number(r.total_revenue ?? 0) || 0,
      avgShippingPrice: hasShipping ? shipAllocRaw / shipUnits : null,
      shipAlloc,
      shipUnits: hasShipping ? shipUnits : null,
    };
  });
}
