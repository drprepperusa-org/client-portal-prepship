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

export interface SkuOrderRow {
  order_id: number;
  order_number: string;
  order_date: string | null;
  order_status: string;
  ship_to_name: string | null;
  qty: number;
  unit_price: string | null;
  item_name: string | null;
  shippingCharge: string | null;
}

export interface SkuOrdersResult {
  sku: string;
  name: string | null;
  totalUnits: number;
  avgShippingCharge: string;
  averageUnitsPerDay: number;
  dailySales: Array<{ day: string; units: number }>;
  orders: SkuOrderRow[];
}
