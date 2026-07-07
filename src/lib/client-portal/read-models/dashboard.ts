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
   * CP-038: Avg shipping CHARGE per shipped unit for this SKU — the client's BILLED
   * shipping (billing_line_items, `customer_billed` basis) allocated over the
   * shipped-with-charge unit denominator (`std_qty_total + exp_qty_total`), or `null`
   * when no shipped unit of this SKU carried a billed shipping charge (rendered "—").
   * Always `null` when the caller may not view financials (shipping is zeroed upstream).
   */
  avgShippingPrice: number | null;
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
  return result.rows.slice(0, limit).map((r) => {
    // total_shipping is now the client's BILLED shipping (customer_billed basis),
    // allocated over the shipped-with-charge unit denominator.
    const billedShipping = Number(r.total_shipping ?? 0);
    const chargedUnits = Number(r.std_qty_total ?? 0) + Number(r.exp_qty_total ?? 0);
    const hasShipping = billedShipping > 0 && chargedUnits > 0;
    return {
      sku: r.sku,
      name: r.name ?? null,
      units30: Number(r.total_qty ?? 0),
      revenue: Number(r.total_revenue ?? 0) || 0,
      avgShippingPrice: hasShipping ? billedShipping / chargedUnits : null,
    };
  });
}
