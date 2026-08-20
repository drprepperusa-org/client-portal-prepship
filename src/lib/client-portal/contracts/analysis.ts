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

export type ShippingMoneyState =
  | 'attributed'
  | 'partial_unattributed'
  | 'unattributed_legacy'
  | 'unbilled'
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
  /** SKU's share of ALL billed shipping on the order (every class, every label). */
  shippingTotal: string | null;
  /** SKU's share of money attributed to standard-service labels only. */
  shippingStandard: string | null;
  /** SKU's share of money attributed to expedited-service labels only. */
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
