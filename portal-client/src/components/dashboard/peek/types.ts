export type PeekKey = 'open' | 'shipped' | 'units';

export interface KpiPeekData {
  days: number;
  openOrders: number;
  units: number;
  counts: Array<{ day: string; awaiting: number; shipped: number; cancelled: number; total: number }>;
  daily: Array<{ day: string; orders: number; units: number }>;
  bySku: Array<{ sku: string; units30: number; avgShippingPrice: number | null }>;
}

export interface ChartPoint {
  day: string; // YYYY-MM-DD
  label: string; // MM-DD
  value: number;
}
