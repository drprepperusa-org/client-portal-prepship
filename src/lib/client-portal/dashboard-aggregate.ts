// Pure dashboard aggregation helpers. Database read models feed these helpers
// already-grouped daily facts, so this module owns only customer-visible period
// context and carries no database/Hono imports.

/** A promo/discount line carries a negative unit price and is not shippable. */
export function isDiscountLine(item: unknown): boolean {
  if (!item || typeof item !== 'object') return false;
  const row = item as Record<string, unknown>;
  const price = Number(row.unitPrice ?? row.unit_price ?? row.price);
  return Number.isFinite(price) && price < 0;
}

export interface DashboardDailySalesInput {
  day: string;
  orders: number;
  units: number;
}

export interface DashboardDailyStatusInput {
  day: string;
  awaiting: number;
  shipped: number;
  cancelled: number;
  total: number;
}

export interface DashboardDailyShipmentInput {
  day: string;
  shipments: number;
}

/**
 * Backend-owned context for one daily metric.
 *
 * Source input: one full-window set-based daily series. Event clock: the
 * metric's documented order_date or ship_date day. Formula owner: this module.
 * The browser may format these fields but must never recompute them.
 */
export interface DashboardDailyMetric {
  value: number;
  periodTotal: number;
  dailyAverage: number;
  periodSharePercent: number;
  vsDailyAveragePercent: number;
  busiestRank: number;
  periodDayCount: number;
}

export interface DashboardDailyRow {
  day: string;
  orderedOrders: DashboardDailyMetric;
  orderedUnits: DashboardDailyMetric;
  allOrders: DashboardDailyMetric;
  awaitingOrders: DashboardDailyMetric;
  shippedOrders: DashboardDailyMetric;
  cancelledOrders: DashboardDailyMetric;
  shipmentsCreated: DashboardDailyMetric;
  unitsPerOrder: number;
}

export interface DashboardPeriodSummary {
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
}

type BaseDailyRow = {
  day: string;
  orderedOrders: number;
  orderedUnits: number;
  allOrders: number;
  awaitingOrders: number;
  shippedOrders: number;
  cancelledOrders: number;
  shipmentsCreated: number;
};

function finiteCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function metricContext(values: number[], index: number, periodTotal: number): DashboardDailyMetric {
  const value = values[index] ?? 0;
  const periodDayCount = values.length;
  const dailyAverage = periodDayCount > 0 ? periodTotal / periodDayCount : 0;
  return {
    value,
    periodTotal,
    dailyAverage,
    periodSharePercent: periodTotal > 0 ? (value / periodTotal) * 100 : 0,
    vsDailyAveragePercent: dailyAverage > 0 ? ((value - dailyAverage) / dailyAverage) * 100 : 0,
    busiestRank: values.filter((candidate) => candidate > value).length + 1,
    periodDayCount,
  };
}

/**
 * Merge backend daily aggregates into the single Dashboard day DTO. The inputs
 * are already complete, scoped SQL aggregates; this function owns only the
 * period total/average/share/rank formulas exposed to customers.
 */
export function buildDashboardDailyRows(
  salesRows: DashboardDailySalesInput[],
  statusRows: DashboardDailyStatusInput[],
  shipmentRows: DashboardDailyShipmentInput[],
): { daily: DashboardDailyRow[]; period: DashboardPeriodSummary } {
  const days = Array.from(
    new Set([
      ...salesRows.map((row) => row.day),
      ...statusRows.map((row) => row.day),
      ...shipmentRows.map((row) => row.day),
    ]),
  ).sort((a, b) => a.localeCompare(b));
  const salesByDay = new Map(salesRows.map((row) => [row.day, row]));
  const statusByDay = new Map(statusRows.map((row) => [row.day, row]));
  const shipmentsByDay = new Map(shipmentRows.map((row) => [row.day, row]));
  const baseRows: BaseDailyRow[] = days.map((day) => {
    const sales = salesByDay.get(day);
    const status = statusByDay.get(day);
    const shipment = shipmentsByDay.get(day);
    return {
      day,
      orderedOrders: finiteCount(sales?.orders),
      orderedUnits: finiteCount(sales?.units),
      allOrders: finiteCount(status?.total),
      awaitingOrders: finiteCount(status?.awaiting),
      shippedOrders: finiteCount(status?.shipped),
      cancelledOrders: finiteCount(status?.cancelled),
      shipmentsCreated: finiteCount(shipment?.shipments),
    };
  });
  const values = {
    orderedOrders: baseRows.map((row) => row.orderedOrders),
    orderedUnits: baseRows.map((row) => row.orderedUnits),
    allOrders: baseRows.map((row) => row.allOrders),
    awaitingOrders: baseRows.map((row) => row.awaitingOrders),
    shippedOrders: baseRows.map((row) => row.shippedOrders),
    cancelledOrders: baseRows.map((row) => row.cancelledOrders),
    shipmentsCreated: baseRows.map((row) => row.shipmentsCreated),
  };
  const totals = {
    orderedOrders: total(values.orderedOrders),
    orderedUnits: total(values.orderedUnits),
    allOrders: total(values.allOrders),
    awaitingOrders: total(values.awaitingOrders),
    shippedOrders: total(values.shippedOrders),
    cancelledOrders: total(values.cancelledOrders),
    shipmentsCreated: total(values.shipmentsCreated),
  };
  const daily = baseRows.map((row, index): DashboardDailyRow => ({
    day: row.day,
    orderedOrders: metricContext(values.orderedOrders, index, totals.orderedOrders),
    orderedUnits: metricContext(values.orderedUnits, index, totals.orderedUnits),
    allOrders: metricContext(values.allOrders, index, totals.allOrders),
    awaitingOrders: metricContext(values.awaitingOrders, index, totals.awaitingOrders),
    shippedOrders: metricContext(values.shippedOrders, index, totals.shippedOrders),
    cancelledOrders: metricContext(values.cancelledOrders, index, totals.cancelledOrders),
    shipmentsCreated: metricContext(values.shipmentsCreated, index, totals.shipmentsCreated),
    unitsPerOrder: row.orderedOrders > 0 ? row.orderedUnits / row.orderedOrders : 0,
  }));
  return {
    daily,
    period: {
      dayCount: days.length,
      orderedOrderCount: totals.orderedOrders,
      orderedUnitCount: totals.orderedUnits,
      allOrderCount: totals.allOrders,
      awaitingOrderCount: totals.awaitingOrders,
      shippedOrderCount: totals.shippedOrders,
      cancelledOrderCount: totals.cancelledOrders,
      shipmentCount: totals.shipmentsCreated,
      averageShippedOrdersPerDay: days.length > 0 ? totals.shippedOrders / days.length : 0,
      peakShippedOrderCount: values.shippedOrders.length > 0 ? Math.max(...values.shippedOrders) : 0,
    },
  };
}
