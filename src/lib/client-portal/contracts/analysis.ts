export interface AnalysisSkuRow {
  sku: string;
  name: string | null;
  image_url: string | null;
  inv_sku_id: number | null;
  client_id: number | null;
  client_name: string | null;
  orders: number;
  /** Backend Analysis owner: awaiting-shipment orders containing this SKU, at order-date time. */
  pending: number;
  total_qty: number;
  total_revenue: string;
  daily_qty: number[];
}

export interface AnalysisOrderCombinationItem {
  sku: string;
  name: string | null;
  quantity: number;
  imageUrl: string | null;
}

export interface AnalysisOrderCombination {
  combinationKey: string;
  label: string;
  orderCount: number;
  totalUnits: number;
  items: AnalysisOrderCombinationItem[];
}

export interface AnalysisBreakdown {
  data: AnalysisSkuRow[];
  dateBuckets?: string[];
  totalSkus?: number;
  totalOrders?: number;
  totalRevenue?: number;
  totalUnits?: number;
  orderCombinations?: AnalysisOrderCombination[];
}

/**
 * Why an order's shipping figure is, or is not, a number.
 *
 * Source: PrepShip's frozen billing line per shipment, falling back to its
 * frozen rate snapshot — the same per-shipment resolver the Orders surface and
 * the order-detail charge summary use. Event clock: label/bill time.
 * Owner: PrepShip.
 *
 * `billing_mismatch` means the order carries shipping money the canonical
 * resolver cannot account for. Invoice and billing summaries sum EVERY
 * `line_type = 'shipping'` row by order_id; this figure sums only the canonical
 * eligible shipments. `voidLabelV2` leaves billing rows in place when it voids a
 * shipment, and no constraint ties a line's shipment_id to its own order, so the
 * two can legitimately disagree.
 *
 * It fires on the PRESENCE of an abnormal-lineage line in either direction, not
 * merely on a positive money gap: a negative unattached credit makes the invoice
 * LOWER than the label sum, which would otherwise display a figure higher than
 * the customer is billed. Two abnormal lines can also cancel out and leave the
 * totals equal with the lineage still wrong.
 *
 * In that state `shippingTotal` is the INVOICED amount and `shippingReconciled`
 * is what the labels accounted for.
 *
 * `pending` replaces the former `unbilled`: an eligible label exists but the
 * resolver has no answer yet, exactly the window the Orders DTO reports as
 * `customerShippingRatePending`. Calling it "unbilled" asserted something the
 * order page contradicts. The former `partial_unattributed` /
 * `unattributed_legacy` no longer exist — total and class split come from one
 * row set, so there is no residual to name.
 */
export type ShippingMoneyState =
  | 'attributed'
  | 'billing_mismatch'
  | 'pending'
  | 'external_label'
  | 'voided_only';

export interface SkuOrderRow {
  order_id: number;
  order_number: string;
  order_date: string | null;
  order_status: string;
  ship_to_name: string | null;
  qty: number;
  unit_price: string | null;
  item_name: string | null;
  /**
   * SKU's share of the order's canonical customer shipping money — the same
   * per-shipment value `orderCustomerShippingRateSql()` sums for the order
   * detail Shipping row, so the two cannot disagree. Allocated across the
   * order's units. Source/clock/owner as for ShippingMoneyState.
   */
  shippingTotal: string | null;
  /**
   * On `billing_mismatch` only: what the order's eligible labels resolved to,
   * against which `shippingTotal` (the invoiced figure) can be reconciled.
   * Null in every other state. Same source/clock/owner as shippingTotal.
   */
  shippingReconciled: string | null;
  /** The standard-service part of shippingTotal; standard + expedited = total. */
  shippingStandard: string | null;
  /** The expedited-service part of shippingTotal. */
  shippingExpedited: string | null;
  /** Why money is (or isn't) shown — never a guessed class. */
  shippingMoneyState: ShippingMoneyState;
}

export interface SkuOrdersResult {
  sku: string;
  name: string | null;
  totalUnits: number;
  /** Per-unit average over orders with attributable standard-class money. */
  avgShippingStandard: string;
  /** Per-unit average over orders with attributable expedited-class money. */
  avgShippingExpedited: string;
  averageUnitsPerDay: number;
  dailySales: Array<{ day: string; units: number }>;
  orders: SkuOrderRow[];
}
