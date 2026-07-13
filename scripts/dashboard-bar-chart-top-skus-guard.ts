// CP-002 + CP-021 + CP-049: the Dashboard bar chart and Top SKUs consume the
// complete backend-owned Dashboard read model. The browser may display-cap rows
// but cannot fold, rank, or recompute authoritative facts.
import fs from 'node:fs';
import path from 'node:path';
import { buildDashboardDailyRows } from '../src/lib/client-portal/dashboard-aggregate';

const root = process.cwd();
let failed = false;
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
function assert(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

const summary = buildDashboardDailyRows(
  [{ day: '2026-06-01', orders: 2, units: 25 }],
  [{ day: '2026-06-01', awaiting: 0, shipped: 2, cancelled: 0, total: 2 }],
  [{ day: '2026-06-01', shipments: 2 }],
);
assert(summary.daily[0]?.orderedOrders.value === 2, 'daily ordered-order count comes from the backend aggregate');
assert(summary.daily[0]?.orderedUnits.value === 25, 'daily ordered units remain distinct from order count');
assert(summary.period.orderedUnitCount === 25, 'period unit total is backend-owned');

const aggregate = read('src/lib/client-portal/dashboard-aggregate.ts');
const readModel = read('src/lib/client-portal/read-models/dashboard.ts');
const route = read('src/routes/client-portal/dashboard.ts');
assert(!aggregate.includes('topSkuRows'), 'legacy capped-array Top-SKUs owner is absent');
assert(readModel.includes('getSkuBreakdownFromOrderItems(salesQuery)'), 'Dashboard reuses the canonical Analysis SKU query');
assert(readModel.includes('projectDashboardTopSkus(analysis.rows, 10)'), 'backend projects the canonical ranked rows');
assert(route.includes('getClientPortalDashboardSummary'), 'route delegates to the full-scope Dashboard owner');
assert(!route.includes('limit(1000)') && !route.includes('dailyOrderUnitsRows'), 'route has no capped visual sample');

const dashboard = read('portal-client/src/pages/Dashboard.tsx');
assert(dashboard.includes('(dash.data?.bySku ?? []).slice(0, 8)'), 'UI applies only a display cap to backend-ranked SKUs');
assert(!/bySku[^\n]*\.sort\(/.test(dashboard), 'UI does not rank Top SKUs');
assert(dashboard.includes('row.orderedOrders.value') && dashboard.includes('row.orderedUnits.value'), 'bar chart maps intent-named DTO values');
assert(!dashboard.includes('.reduce('), 'Dashboard performs no authoritative reduction');

const charts = read('portal-client/src/components/charts/Charts.tsx');
assert(charts.includes('export function OrdersUnitsBarChart'), 'Charts exports OrdersUnitsBarChart');
assert(!charts.includes('AreaChart') && !charts.includes('OrdersAreaChart'), 'orders trend remains a bar chart');
assert(charts.includes('stackId="ou"') || charts.includes("stackId='ou'"), 'orders and units share a stack');
assert(charts.includes('unitDelta') && charts.includes('Math.max(0,'), 'visual continuation segment remains non-negative');

assert(dashboard.includes('<DataTable') && dashboard.includes('tableId="dashboard-top-skus"'), 'Top SKUs uses the shared DataTable');
assert(dashboard.includes('Unit Count Last 30 Days'), 'Top SKUs exposes ordered units');
assert(dashboard.includes('Avg Shipping Price'), 'Top SKUs exposes canonical billed shipping average');
assert(dashboard.includes('avgShippingPrice == null'), 'missing shipping average renders a null state');
assert(/Shipped orders \(\$\{days\}d\)/.test(dashboard), 'shipped KPI names the order-status entity');
assert(dashboard.includes('Shipments created'), 'shipment chart names the shipment entity');

const api = read('portal-client/src/lib/api.ts');
for (const field of ['orderedOrders', 'orderedUnits', 'shipmentsCreated', 'periodSharePercent']) {
  assert(api.includes(field), `DashboardSummary exposes ${field}`);
}

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(pkg.scripts?.['test:dashboard-bar-chart-top-skus'] === 'tsx scripts/dashboard-bar-chart-top-skus-guard.ts', 'guard is registered');

if (failed) process.exit(1);
console.log('\nCP-002 + CP-021 + CP-049 Dashboard guard passed.');
