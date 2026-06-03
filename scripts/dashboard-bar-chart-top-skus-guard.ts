// CP-002 guard: the Dashboard "Orders over time" card is a cumulative
// orders/units BAR chart (not an area/line chart, not a raw additive stack),
// and Top SKUs is a table with SKU / Unit Count Last 30 Days / Avg Shipping
// Price whose avg shipping does not double-count multi-SKU orders.
//
// Runs the real aggregation code (imported, no DB needed) for the data math,
// then asserts the portal-client UI wiring via source inspection. Legacy web/
// is intentionally untouched, so this guard only looks at portal-client/.
import fs from 'node:fs';
import path from 'node:path';
import { topSkuRows, dailyOrderUnitsRows } from '../src/lib/client-portal/dashboard-aggregate';

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

// ── Data math: a multi-SKU order must not bill its full shipping to every SKU ──
{
  const multiSku = topSkuRows(
    [{ orderDate: '2026-06-01T00:00:00Z', shippingAmount: '10.00', items: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 4 }] }],
    true,
  );
  const a = multiSku.find((r) => r.sku === 'A');
  const b = multiSku.find((r) => r.sku === 'B');
  assert(!!a && !!b, 'topSkuRows returns a row per SKU in a multi-SKU order');
  // $10 shipping over 5 units = $2/unit; each SKU's per-unit avg is $2.
  assert(a?.avgShippingPrice === 2, 'SKU A avg shipping is the per-unit $2 (qty-share allocation)');
  assert(b?.avgShippingPrice === 2, 'SKU B avg shipping is the per-unit $2 (qty-share allocation)');
  // Total allocated shipping across SKUs equals the ONE order's shipping ($10),
  // not $10 counted once per SKU ($20).
  const totalAllocated = (a!.avgShippingPrice ?? 0) * a!.units30 + (b!.avgShippingPrice ?? 0) * b!.units30;
  assert(totalAllocated === 10, 'multi-SKU shipping sums to the order total ($10), not double-counted ($20)');
}

// ── No shipping data → null (rendered as "—"), not $0.00 ──
{
  const noShip = topSkuRows([{ orderDate: '2026-06-01T00:00:00Z', shippingAmount: '0', items: [{ sku: 'C', quantity: 3 }] }], true);
  assert(noShip[0]?.avgShippingPrice === null, 'SKU with no shipping charge reports null avg shipping (shown as —)');
}

// ── Financial visibility: avg shipping withheld when canViewFinancials is false ──
{
  const redacted = topSkuRows([{ orderDate: '2026-06-01T00:00:00Z', shippingAmount: '10.00', items: [{ sku: 'D', quantity: 2 }] }], false);
  assert(redacted[0]?.avgShippingPrice === null, 'avg shipping is null when caller cannot view financials');
}

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

// ── UI: Top SKUs is a table with the required columns ──
{
  const dashboard = read('portal-client/src/pages/Dashboard.tsx');
  assert(/<table[\s>]/.test(dashboard), 'Top SKUs renders a <table>');
  assert(dashboard.includes('Unit Count Last 30 Days'), 'Top SKUs table has a "Unit Count Last 30 Days" column');
  assert(dashboard.includes('Avg Shipping Price'), 'Top SKUs table has an "Avg Shipping Price" column');
  assert(dashboard.includes('avgShippingPrice == null') && dashboard.includes("'—'"), 'avg shipping renders — when null instead of $0.00');
}

// ── Contract + wiring ──
{
  const api = read('portal-client/src/lib/api.ts');
  assert(api.includes('avgShippingPrice'), 'DashboardSummary.bySku exposes avgShippingPrice');
  assert(/daily:\s*Array<\{\s*day:\s*string;\s*orders:\s*number;\s*units:\s*number/.test(api), 'DashboardSummary exposes a daily orders/units series');

  const route = read('src/routes/client-portal.ts');
  assert(route.includes('dailyOrderUnitsRows') && route.includes('topSkuRows'), 'client-portal route uses the shared dashboard aggregations');
  assert(route.includes('daily: dailyOrderUnitsRows(rows)'), '/dashboard response includes the daily orders/units series');

  const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
  assert(
    pkg.scripts?.['test:dashboard-bar-chart-top-skus'] === 'tsx scripts/dashboard-bar-chart-top-skus-guard.ts',
    'package.json exposes test:dashboard-bar-chart-top-skus',
  );
}

if (failed) process.exit(1);
console.log('\nCP-002 dashboard bar-chart + Top-SKUs guard passed.');
