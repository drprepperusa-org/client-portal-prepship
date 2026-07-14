import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-021 — Dashboard analytics widgets must use the canonical SOT and honest
// order/shipment labels.
//
// The Dashboard drifted from the Analysis page because its Top-SKUs ranking +
// per-SKU units + Avg Shipping Price were derived from a capped/sampled orders
// array (`orders.limit(1000)`) folded, sorted and sliced in the frontend/route
// (the old topSkuRows path), while Analysis uses set-based SQL over order_items
// with shipment cost allocation. This guard is a static source-pin (no live DB
// in CI): it pins the ARCHITECTURE that guarantees parity + honest labels, so
// the drift shape cannot silently reappear.
//
// Pins:
//   1. A shared canonical Top-SKUs read-model exists and reuses the SAME
//      Analysis SKU query (getSkuBreakdownFromOrderItems) → structural parity.
//   2. /dashboard sources Top-SKUs from that read-model — never from folding /
//      sorting / slicing the capped orders array.
//   3. The capped orders array feeds ONLY the non-ranking per-day bar chart.
//   4. The frontend renders backend-ranked Top-SKUs verbatim — no client-side
//      .sort().slice() of an orders/SKU array for the business ranking.
//   5. Avg Shipping Price is backend-owned (in the read-model), from the same
//      allocated shipment label_cost SOT as Analysis, and financially redacted.
//   6. Honest labels: "Shipped orders" (orders.order_status) vs "Shipments
//      created" (shipments rows). The dead frontend folder is removed.
//   7. Wired into the suite.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// Collapse whitespace so assertions tolerate reformatting / CRLF.
const flat = (s) => s.replace(/\s+/g, ' ');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const analysis = read('src/routes/analysis.ts');
const readModel = read('src/lib/client-portal/read-models/dashboard.ts');
const readModelFlat = flat(readModel);
const route = read('src/routes/client-portal/dashboard.ts');
const routeFlat = flat(route);
const aggregate = read('src/lib/client-portal/dashboard-aggregate.ts');
const dashboardPage = read('portal-client/src/pages/Dashboard.tsx');
const dashboardPageFlat = flat(dashboardPage);
const buildConfig = read('portal-client/src/components/dashboard/peek/buildConfig.tsx');
const layout = read('portal-client/src/lib/dashboardLayout.ts');
const api = readActiveClientPortalApiSource();
const apiFlat = flat(api);
const pkg = JSON.parse(read('package.json'));

// ── 1. Shared canonical Top-SKUs read-model reusing the Analysis SKU query ──
assert(
  /export async function dashboardTopSkus/.test(readModel),
  'a shared backend read-model (dashboardTopSkus) owns the Dashboard Top-SKUs ranking',
);
assert(
  readModel.includes('getSkuBreakdownFromOrderItems'),
  'dashboardTopSkus reuses the CANONICAL Analysis SKU query (getSkuBreakdownFromOrderItems) — parity is structural, not a re-implementation',
);
assert(
  analysis.includes('export async function getSkuBreakdownFromOrderItems'),
  'the canonical Analysis SKU owner (getSkuBreakdownFromOrderItems, set-based over order_items) exists',
);
// The read-model derives units/revenue/avg-shipping from the Analysis row fields
// (total_qty / total_revenue / total_shipping + shipped-unit denominators), so
// there is no second definition of these numbers.
assert(
  readModelFlat.includes('total_qty') &&
    readModelFlat.includes('total_revenue') &&
    readModelFlat.includes('total_shipping'),
  'dashboardTopSkus projects the canonical Analysis row fields (total_qty / total_revenue / total_shipping)',
);

// ── 2. /dashboard sources Top-SKUs from the read-model, not a capped-array fold ──
assert(
  routeFlat.includes('getClientPortalDashboardSummary('),
  '/dashboard delegates to the canonical full-scope Dashboard read-model',
);
assert(
  !routeFlat.includes('topSkuRows('),
  '/dashboard no longer folds the capped orders array into a Top-SKUs ranking (topSkuRows removed)',
);
// No frontend/route ranking of the capped rows: no `.limit(1000)` sample being
// sorted+sliced for SKUs, and no `.sort(...).slice(0, N)` over an orders array.
assert(
  !/rows\s*[\s\S]{0,80}?\.sort\([\s\S]{0,120}?\.slice\(/.test(route),
  '/dashboard does not .sort(...).slice(...) the capped orders rows into a ranking',
);

// ── 3. The capped orders array feeds ONLY the non-ranking per-day bar chart ──
assert(
  !routeFlat.includes('limit(1000)') && !routeFlat.includes('dailyOrderUnitsRows'),
  'the capped visual sample is removed',
);
assert(
  readModelFlat.includes('buildDashboardDailyRows(') && readModelFlat.includes('getSkuBreakdownFromOrderItems(salesQuery)'),
  'daily orders/units come from complete backend aggregates',
);
assert(
  readModelFlat.includes('bySku: projectDashboardTopSkus(analysis.rows, 10)') && !routeFlat.includes('topSkuRows'),
  '/dashboard returns backend-owned canonical bySku rows',
);

// ── 4. Frontend renders backend-ranked Top-SKUs verbatim (no ranking sort/slice) ──
assert(
  !/bySku[^\n]*\.sort\(/.test(dashboardPage),
  'Dashboard.tsx does not .sort() the Top-SKUs — the backend owns the ranking',
);
assert(
  !/\[\.\.\.d\.bySku\]\.sort\(/.test(buildConfig) && !/d\.bySku\]\.sort\(/.test(buildConfig),
  'the KPI peek no longer re-ranks bySku with a client-side .sort()',
);
assert(
  buildConfig.includes('d.bySku.slice(0, 5)'),
  'the KPI peek renders the backend-ranked bySku (slice only, no re-sort)',
);

// ── 5. Avg Shipping Price is backend-owned + redacted, same SOT as Analysis ──
assert(
  readModel.includes('avgShippingPrice'),
  'Avg Shipping Price is computed in the backend read-model, not the frontend',
);
assert(
  readModelFlat.includes("shippingBasis: 'customer_billed'") &&
    readModelFlat.includes('std_qty_total') && readModelFlat.includes('exp_qty_total'),
  'Avg Shipping Price divides canonical customer-billed shipping by the Analysis charged-unit denominator',
);
assert(
  !/shippingAmount/.test(readModel),
  'the read-model does NOT re-derive Avg Shipping from raw orders.shippingAmount',
);
// The canonical owner zeroes revenue/shipping for non-financial callers, so the
// read-model inherits redaction (avgShippingPrice becomes null when shipping=0).
assert(
  analysis.includes('total_shipping: canViewFinancials ? rest.total_shipping'),
  'the Analysis owner redacts per-SKU shipping for non-financial users (the read-model inherits it)',
);

// ── 6. Honest labels + dead folder removed ──
assert(
  !/export function topSkuRows/.test(aggregate),
  'the dead capped-array Top-SKUs folder (topSkuRows) is deleted from dashboard-aggregate',
);
assert(
  /Shipped orders \(\$\{days\}d\)/.test(dashboardPage),
  'the order-status shipped KPI names the entity: "Shipped orders" (orders.order_status-based)',
);
assert(
  dashboardPageFlat.includes('Shipments created'),
  'the shipments-row volume chart names the entity: "Shipments created" (shipments-table-based)',
);
assert(
  !/label=\{`Shipped \(\$\{days\}d\)`\}/.test(dashboardPage) &&
    !dashboardPage.includes('title="Shipment volume"'),
  'the ambiguous "Shipped (Nd)" / "Shipment volume" labels that hid the SOT are gone',
);
assert(
  layout.includes("volumeChart: 'Shipments created'"),
  'the customize-panel widget label matches the honest "Shipments created" title',
);

// ── 7. Frontend contract carries name + honest tooltips ──
assert(
  /bySku: Array<\{ sku: string; name\?: string \| null; units30: number/.test(apiFlat),
  'DashboardSummary.bySku exposes the canonical fields (incl. name mirroring Analysis)',
);
assert(
  dashboardPage.includes('same SOT as Analysis') || dashboardPage.includes('matches Analysis'),
  'the Top-SKUs tooltips/subtitle state the numbers match the Analysis SOT',
);

// ── 8. Wired into the suite ──
assert(
  pkg.scripts?.['test:client-portal-dashboard-sot'] ===
    'node scripts/client-portal-dashboard-sot-guard.mjs',
  'package exposes test:client-portal-dashboard-sot',
);

if (failed) process.exit(1);
console.log('\nclient portal dashboard SOT guard passed.');
