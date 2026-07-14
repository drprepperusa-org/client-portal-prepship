import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDashboardDailyRows } from '../src/lib/client-portal/dashboard-aggregate';

const read = (path: string) => readFileSync(path, 'utf8');
const sliceBetween = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex >= 0 ? endIndex : undefined);
};

const highVolume = buildDashboardDailyRows(
  [
    { day: '2026-07-01', orders: 1_200, units: 1_500 },
    { day: '2026-07-02', orders: 401, units: 500 },
  ],
  [
    { day: '2026-07-01', awaiting: 100, shipped: 1_050, cancelled: 50, total: 1_200 },
    { day: '2026-07-02', awaiting: 40, shipped: 350, cancelled: 11, total: 401 },
  ],
  [
    { day: '2026-07-01', shipments: 1_030 },
    { day: '2026-07-02', shipments: 340 },
  ],
);

assert.equal(highVolume.period.orderedOrderCount, 1_601, '>1,000 orders remain complete');
assert.equal(highVolume.period.orderedUnitCount, 2_000, 'ordered units remain complete');
assert.equal(highVolume.period.shippedOrderCount, 1_400, 'shipped status total is backend-owned');
assert.equal(highVolume.period.shipmentCount, 1_370, 'shipment total is backend-owned');
assert.equal(highVolume.daily[0]?.orderedOrders.periodTotal, 1_601, 'daily row carries its backend period total');
assert.equal(highVolume.daily[0]?.orderedOrders.busiestRank, 1, 'backend owns busiest-day rank');
assert.equal(highVolume.daily[1]?.orderedOrders.busiestRank, 2, 'backend ranks every day');
assert.equal(highVolume.daily[0]?.unitsPerOrder, 1.25, 'backend owns units-per-order');

const route = read('src/routes/client-portal/dashboard.ts');
const readModel = read('src/lib/client-portal/read-models/dashboard.ts');
const aggregate = read('src/lib/client-portal/dashboard-aggregate.ts');
const analysis = read('src/routes/analysis.ts');
const api = readActiveClientPortalApiSource();
const dashboardApi = read('portal-client/src/lib/api/domains/dashboard.ts');
const dashboard = read('portal-client/src/pages/Dashboard.tsx');
const modal = read('portal-client/src/components/dashboard/ChartDayModal.tsx');
const peekChart = read('portal-client/src/components/dashboard/peek/PeekChart.tsx');
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

assert.doesNotMatch(route, /limit\(1000\)|dailyOrderUnitsRows/, 'Dashboard route has no capped order sample');
assert.match(route, /getClientPortalDashboardSummary/, 'route delegates to one backend Dashboard owner');
assert.match(readModel, /orderScopePredicate\(scope, \{ clientId, storeId \}\)/, 'order facts use the full backend scope');
assert.match(readModel, /shipmentScopePredicate\(scope, \{ clientId, storeId \}\)/, 'shipment facts use the full backend scope');
assert.match(aggregate, /periodSharePercent/);
assert.match(aggregate, /vsDailyAveragePercent/);
assert.match(aggregate, /busiestRank/);

const salesMetrics = sliceBetween(analysis, 'export async function getClientPortalSalesMetrics', 'export async function getClientPortalSalesTotals');
assert.doesNotMatch(salesMetrics, /\blimit\b/i, 'canonical daily sales aggregation is uncapped');
assert.match(salesMetrics, /generate_series/, 'canonical daily sales covers the complete selected window');
assert.match(salesMetrics, /analysisOrderScopePredicate\(q\)/, 'canonical daily sales applies backend scope');

const scopedDashboard = sliceBetween(dashboardApi, 'function dashboard', 'function dailyCounts');
assert.doesNotMatch(scopedDashboard, /Promise\.all|portalScopeFromToken|\.reduce\(|\.sort\(/, 'browser makes one Dashboard request and performs no business merge');
assert.match(scopedDashboard, /apiGet<DashboardSummary>/, 'browser consumes the backend Dashboard DTO');

for (const hook of ['useDailyCounts', 'useDailyShipments', 'useAwaitingCount']) {
  assert.doesNotMatch(dashboard, new RegExp(`\\b${hook}\\b`), `Dashboard no longer fetches ${hook}`);
}
assert.doesNotMatch(dashboard, /\.reduce\(/, 'Dashboard page performs no authoritative reductions');
assert.doesNotMatch(modal, /dailyRow|countRow|\.reduce\(|\.filter\(/, 'day modal has one backend day owner and no business reductions');
assert.doesNotMatch(peekChart, /\.reduce\(/, 'KPI chart renders backend share/average context');

for (const field of [
  'orderedOrders',
  'orderedUnits',
  'awaitingOrders',
  'shippedOrders',
  'cancelledOrders',
  'shipmentsCreated',
  'periodSharePercent',
  'vsDailyAveragePercent',
  'busiestRank',
]) {
  assert.match(api, new RegExp(field), `Dashboard DTO exposes ${field}`);
}

assert.equal(
  pkg.scripts?.['test:client-portal-dashboard-full-scope'],
  'tsx scripts/client-portal-dashboard-full-scope-guard.ts',
);

console.log('client portal Dashboard full-scope guard passed');
