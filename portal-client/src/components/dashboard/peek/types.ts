export type PeekKey = 'open' | 'shipped' | 'units' | 'revenue';

export interface KpiPeekData {
  days: number;
  openOrders: number;
  units: number;
  revenue: number;
  counts: Array<{ day: string; awaiting: number; shipped: number; cancelled: number; total: number }>;
  daily: Array<{ day: string; orders: number; units: number }>;
  dailyRevenue: Array<{ day: string; revenue: number }>;
  bySku: Array<{ sku: string; units30: number; revenue: number; avgShippingPrice: number | null }>;
}

export interface ChartPoint {
  day: string; // YYYY-MM-DD
  label: string; // MM-DD
  value: number;
}
