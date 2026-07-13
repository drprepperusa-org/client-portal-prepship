import type { DashboardDailyMetric, DashboardSummary } from '@/lib/api';

export type PeekKey = 'open' | 'shipped' | 'units';

export interface KpiPeekData {
  days: number;
  openOrders: number;
  units: number;
  period?: DashboardSummary['period'];
  daily: DashboardSummary['daily'];
  bySku: Array<{ sku: string; units30: number; avgShippingPrice: number | null }>;
}

export interface ChartPoint extends DashboardDailyMetric {
  day: string; // YYYY-MM-DD
  label: string; // MM-DD
}
