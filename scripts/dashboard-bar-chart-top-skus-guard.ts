// CP-002 + CP-021 guard: the Dashboard "Orders over time" card is a cumulative
// orders/units BAR chart (not an area/line chart, not a raw additive stack), and
// Top SKUs is a table (SKU / Unit Count Last 30 Days / Avg Shipping Price) whose
// numbers come from the CANONICAL backend Analysis SKU query — NOT from folding
// + sorting a capped orders array in the frontend (the removed topSkuRows path).
//
// Runs the real per-day aggregation code (imported, no DB needed) for the chart
// math, then asserts the portal-client UI wiring + the backend-owned Top-SKUs
// SOT via source inspection. Legacy web/ is intentionally untouched, so this
// guard only looks at portal-client/.
import fs from 'node:fs';
import path from 'node:path';
import { dailyOrderUnitsRows } from '../src/lib/client-portal/dashboard-aggregate';

const root = process.cwd();
let failed = false;
function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── Daily series carries BOTH order count and unit count, and is not additive ──
{
  const daily = dailyOrderUnitsRows([
    { orderDate: '2026-06-01T08:00:00Z', shippingAmount: '0', items: [{ sku: 'A', quantity: 12 }] },
    { orderDate: '2026-06-01T20:00:00Z', shippingAmount: '0', items: [{ sku: 'B', quantity: 13 }] },
  ]);
  assert(daily.length === 1, 'orders on the same day collapse to one bucket');
  assert(daily[0].orders === 2, 'daily order count is the number of orders (2)');
  assert(daily[0].units === 25, 'daily unit count sums shippable quantities (25), independent of order count');
  // The cumulative bar height must be the unit count (25), never orders+units (27).
  const additive = daily[0].orders + daily[0].units;
  assert(daily[0].units === 25 && additive === 27, 'cumulative unit height (25) is distinct from the additive orders+units (27)');
}

// ── Discount/promo lines (negative unit price) are excluded from the day units ──
{
  const promoDaily = dailyOrderUnitsRows([
    { orderDate: '2026-06-02T00:00:00Z', shippingAmount: '0', items: [
      { sku: 'A', quantity: 3, unitPrice: 9.99 },
      { sku: 'WELCOME10', quantity: 1, unitPrice: -10 },
    ] },
  ]);
  assert(promoDaily[0]?.units === 3, 'daily units exclude negative-price discount lines (3, not 4)');
}

// ── CP-021: Top-SKUs comes from the canonical backend read-model, NOT a capped
//    frontend orders-array fold/sort/slice ──
{
  // The dead frontend folder (topSkuRows) that ranked SKUs + allocated Avg
  // Shipping Price from a capped orders array is GONE from the shared module.
  const aggregate = read('src/lib/client-portal/dashboard-aggregate.ts');
  assert(!/export function topSkuRows/.test(aggregate), 'the capped-array Top-SKUs folder (topSkuRows) is removed from dashboard-aggregate');

  // A shared backend read-model exists and is a thin projection over the SAME
  // Analysis SKU owner (getSkuBreakdownFromOrderItems), so parity is structural.
  const readModel = read('src/lib/client-portal/read-models/dashboard.ts');
  assert(/export async function dashboardTopSkus/.test(readModel), 'a shared backend read-model dashboardTopSkus exists');
  assert(readModel.includes('getSkuBreakdownFromOrderItems'), 'dashboardTopSkus reuses the canonical Analysis SKU query (getSkuBreakdownFromOrderItems)');

  // The /dashboard route sources bySku from the read-model — not from topSkuRows.
  const route = read('src/routes/client-portal/dashboard.ts').replace(/\s+/g, ' ');
  assert(route.includes('dashboardTopSkus('), '/dashboard sources Top-SKUs from the canonical read-model');
  assert(!route.includes('topSkuRows('), '/dashboard no longer folds the capped rows into a Top-SKUs ranking');
  // The capped rows array must only feed the non-ranking per-day bar chart.
  assert(route.includes('daily: dailyOrderUnitsRows(rows)'), '/dashboard still builds the per-day orders/units bar series');
  assert(/const rows = await db\.select\(\)\.from\(orders\)\.where\(where\)\.limit\(1000\)/.test(route), 'the capped orders array is bounded (limit 1000) and used for the visual chart only');
}

// ── CP-021: frontend renders backend Top-SKUs verbatim — no ranking sort/slice
//    of an orders/SKU array for the business ranking ──
{
  const dashboard = read('portal-client/src/pages/Dashboard.tsx');
  // Renders the backend-ranked rows in order; a plain display cap is fine, but
  // there must be no client-side .sort() that re-ranks the Top-SKUs.
  assert(dashboard.includes('dash.data!.bySku.slice(0, 8)') || dashboard.includes('dash.data.bySku.slice(0, 8)'), 'Dashboard renders backend-ranked bySku rows in order (display cap only)');
  assert(!/bySku[^\n]*\.sort\(/.test(dashboard), 'Dashboard does not .sort() the Top-SKUs (backend owns the ranking)');

  const buildConfig = read('portal-client/src/components/dashboard/peek/buildConfig.tsx');
  assert(!/d\.bySku\]\.sort\(/.test(buildConfig) && !/\[\.\.\.d\.bySku\]\.sort\(/.test(buildConfig), 'KPI peek no longer re-ranks bySku with a client-side .sort()');
  assert(buildConfig.includes('d.bySku.slice(0, 5)'), 'KPI peek renders the backend-ranked bySku (slice only)');
}

// ── UI: cumulative BAR chart, not an area/line chart ──
{
  const charts = read('portal-client/src/components/charts/Charts.tsx');
  assert(charts.includes('export function OrdersUnitsBarChart'), 'Charts exports OrdersUnitsBarChart');
  assert(!charts.includes('AreaChart') && !charts.includes('OrdersAreaChart'), 'Charts no longer defines an Area/Orders area chart');
  assert(charts.includes("stackId=\"ou\"") || charts.includes("stackId='ou'"), 'orders/units bars share a stackId (stacked, cumulative)');
  assert(charts.includes('unitDelta') && charts.includes('Math.max(0,'), 'continuation segment uses unitDelta = max(0, units - orders) — cumulative not additive');

  const dashboard = read('portal-client/src/pages/Dashboard.tsx');
  assert(dashboard.includes('OrdersUnitsBarChart') && !dashboard.includes('OrdersAreaChart'), 'Dashboard renders the bar chart, not the area chart');
  assert(dashboard.includes('dash.data?.daily') || dashboard.includes('daily ?? []'), 'chart series is backed by the scoped /dashboard daily response');
  assert(dashboard.includes('Orders count vs. unit count'), 'chart subtitle reflects orders vs. unit metrics');
}

// ── UI: Top SKUs is a table with the required columns + honest "—" rendering ──
{
  const dashboard = read('portal-client/src/pages/Dashboard.tsx');
  assert(/<table[\s>]/.test(dashboard), 'Top SKUs renders a <table>');
  assert(dashboard.includes('Unit Count Last 30 Days'), 'Top SKUs table has a "Unit Count Last 30 Days" column');
  assert(dashboard.includes('Avg Shipping Price'), 'Top SKUs table has an "Avg Shipping Price" column');
  assert(dashboard.includes('avgShippingPrice == null') && dashboard.includes("'—'"), 'avg shipping renders — when null instead of $0.00');
  // CP-038: the internal allocation-math tooltip (shipAlloc ÷ shipUnits = avg) was removed —
  // the value is now the client's billed shipping CHARGE, rendered as a plain cell.
  assert(
    dashboard.includes('money(s.avgShippingPrice)') && !dashboard.includes('money(s.shipAlloc)') && !dashboard.includes('s.shipUnits'),
    'Avg Shipping Price cell renders the plain billed charge (CP-038: no shipAlloc÷shipUnits tooltip)',
  );
}

// ── Honest labels (CP-021): widgets name the entity + table the number is from ──
{
  const dashboard = read('portal-client/src/pages/Dashboard.tsx');
  // "Shipped orders" (orders.order_status) vs "Shipments created" (shipments rows).
  assert(/Shipped orders \(\$\{days\}d\)/.test(dashboard), 'the order-status shipped KPI is labelled "Shipped orders" (names orders.order_status)');
  assert(dashboard.includes('Shipments created'), 'the shipments-table volume chart is labelled "Shipments created" (names the shipments table)');
  assert(!/label=\{`Shipped \(\$\{days\}d\)`\}/.test(dashboard), 'the ambiguous bare "Shipped (Nd)" label is gone');
  assert(!dashboard.includes('title="Shipment volume"') && !dashboard.includes('title={`Shipment volume'), 'the ambiguous "Shipment volume" title is gone');

  const layout = read('portal-client/src/lib/dashboardLayout.ts');
  assert(layout.includes("volumeChart: 'Shipments created'"), 'the customize-panel widget label matches the honest "Shipments created" title');
}

// ── Contract + wiring ──
{
  const api = read('portal-client/src/lib/api.ts');
  assert(api.includes('avgShippingPrice'), 'DashboardSummary.bySku exposes avgShippingPrice');
  assert(api.includes('billedShippingTotal') && api.includes('chargedUnits'), 'DashboardSummary.bySku exposes billedShippingTotal/chargedUnits for the exact multi-client combine (CP-038)');
  assert(/daily:\s*Array<\{\s*day:\s*string;\s*orders:\s*number;\s*units:\s*number/.test(api), 'DashboardSummary exposes a daily orders/units series');

  const route = read('src/routes/client-portal/dashboard.ts').replace(/\s+/g, ' ');
  assert(route.includes('dailyOrderUnitsRows') && route.includes('dashboardTopSkus'), 'client-portal route uses the shared per-day aggregation + the canonical Top-SKUs read-model');

  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert(
    pkg.scripts?.['test:dashboard-bar-chart-top-skus'] === 'tsx scripts/dashboard-bar-chart-top-skus-guard.ts',
    'package.json exposes test:dashboard-bar-chart-top-skus',
  );
}

if (failed) process.exit(1);
console.log('\nCP-002 + CP-021 dashboard bar-chart + canonical Top-SKUs guard passed.');
