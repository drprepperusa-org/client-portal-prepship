export interface DashboardDailyMetric {
  value: number;
  periodTotal: number;
  dailyAverage: number;
  periodSharePercent: number;
  vsDailyAveragePercent: number;
  busiestRank: number;
  periodDayCount: number;
}

export interface DashboardSummary {
  revenue: number;
  units: number;
  openOrderCount: number;
  bySku: Array<{
    sku: string;
    name?: string | null;
    units30: number;
    revenue: number;
    avgShippingPrice: number | null;
  }>;
  period: {
    dayCount: number;
    orderedOrderCount: number;
    orderedUnitCount: number;
    allOrderCount: number;
    awaitingOrderCount: number;
    shippedOrderCount: number;
    cancelledOrderCount: number;
    shipmentCount: number;
    averageShippedOrdersPerDay: number;
    peakShippedOrderCount: number;
  };
  daily: Array<{
    day: string;
    orderedOrders: DashboardDailyMetric;
    orderedUnits: DashboardDailyMetric;
    allOrders: DashboardDailyMetric;
    awaitingOrders: DashboardDailyMetric;
    shippedOrders: DashboardDailyMetric;
    cancelledOrders: DashboardDailyMetric;
    shipmentsCreated: DashboardDailyMetric;
    unitsPerOrder: number;
  }>;
}

export interface DailyCount {
  day: string;
  awaiting: number;
  shipped: number;
  cancelled: number;
  total: number;
}
