// CP-010 — Dashboard and Analysis customer-visible sales revenue/units must come
// from ONE backend-owned canonical sales-metrics owner, so the two screens can
// never define revenue independently and drift again (DJ saw $128,975 vs
// $121,097 for the same client/range).
//
// This repo's guards are static source-pins (no live DB in CI), so we pin the
// architecture that *guarantees* parity rather than executing SQL:
//   1. One owner (getClientPortalSalesTotals) computed set-based (no LIMIT).
//   2. Both /dashboard and /analysis consume it — neither reduces rows for money.
//   3. The owner's revenue definition matches the per-SKU line_revenue, so the
//      Analysis table rows roll up to the same canonical total.
//   4. Financial redaction lives in the owner.
//   5. Frontend renders backend totals + carries clientId in both query keys.
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
const analysisFlat = flat(analysis);
// Split across two sub-routers now: /dashboard lives in dashboard.ts, /analysis
// in analysis.ts. Concatenate both so the parity pins resolve in one string.
const route = read('src/routes/client-portal/dashboard.ts') + '\n' + read('src/routes/client-portal/analysis.ts');
const routeFlat = flat(route);
const dashboardReadModel = read('src/lib/client-portal/read-models/dashboard.ts');
const dashboardReadModelFlat = flat(dashboardReadModel);
const analysisPage = read('portal-client/src/pages/Analysis.tsx');
const analysisPageFlat = flat(analysisPage);
const hooks = read('portal-client/src/lib/hooks.ts');
const api = read('portal-client/src/lib/api.ts');
const apiFlat = flat(api);
const pkg = JSON.parse(read('package.json'));

// ── 1. One canonical owner, set-based (no capped row reduction) ──
assert(
  analysis.includes('export async function getClientPortalSalesMetrics'),
  'analysis.ts exports the canonical full-window sales-metrics owner',
);
assert(
  analysis.includes('export async function getClientPortalDailyRevenue'),
  'analysis.ts exports getClientPortalDailyRevenue (per-day companion, same filters)',
);
assert(
  analysisFlat.includes('count(distinct o.id)::int as orders'),
  'the owner counts orders set-based (count distinct), not by a capped fetch',
);

// ── 2. Revenue definition = line-item product revenue, matching per-SKU rows ──
// The per-SKU breakdown computes line_revenue = sum(unit_price * qty); the owner
// sums the same unit_price × quantity — so Analysis rows roll up to the KPI.
assert(
  analysisFlat.includes('sum(unit_price * qty)::numeric as line_revenue'),
  'per-SKU rows define revenue as sum(unit_price * qty) (line-item product revenue)',
);
assert(
  (analysisFlat.match(/coalesce\(oi\.unit_price, 0\)::numeric \* greatest\(0, coalesce\(oi\.quantity, 0\)\)/g) || []).length >= 1 &&
    analysisFlat.includes('period_revenue') && analysisFlat.includes('daily: rows.map'),
  'the canonical total + daily revenue both use the same unit_price × quantity definition (rows roll up to KPI)',
);

// ── 3. Financial redaction is owned by the backend owner, not the UI ──
assert(
  analysisFlat.includes('revenue: canViewFinancials ? Number(first?.period_revenue) || 0 : 0') &&
    analysisFlat.includes('revenue: canViewFinancials ? Number(row.revenue) || 0 : 0'),
  'the owner zeroes revenue when canViewFinancials is false (redaction in the owner)',
);
assert(
  routeFlat.includes("total_revenue: canViewFinancials ? row.total_revenue : '0'"),
  '/analysis redacts per-SKU revenue for non-financial users (consistent with the KPI)',
);

// ── 4. /dashboard KPIs come from the owner — never from the .limit(1000) rows ──
assert(
  routeFlat.includes('getClientPortalDashboardSummary') &&
    dashboardReadModelFlat.includes('getSkuBreakdownFromOrderItems(salesQuery)'),
  '/dashboard delegates to a read model backed by the canonical Analysis owner',
);
assert(
  dashboardReadModelFlat.includes('revenue: analysis.totalRevenue') &&
    dashboardReadModelFlat.includes('units: analysis.totalUnits'),
  '/dashboard renders the owner totals as its Revenue/Units KPIs',
);
assert(
  !/revenue\s*=\s*scope\.canViewFinancials[\s\S]*?rows\.reduce/.test(route) &&
    !/rows\.reduce\(\(sum, row\) => sum \+ Number\(row\.orderTotal/.test(route),
  '/dashboard no longer reduces the capped rows into an authoritative revenue KPI',
);
assert(
  dashboardReadModelFlat.includes('includeCancelled: false'),
  '/dashboard applies the same non-cancelled policy the owner/Analysis use',
);

// ── 5. /analysis returns the backend-owned canonical totals ──
assert(
  routeFlat.includes('totalRevenue: result.totalRevenue') &&
    routeFlat.includes('totalUnits: result.totalUnits'),
  '/analysis returns backend-owned totalRevenue + totalUnits',
);

// ── 6. Frontend renders backend totals — no row reduction for the KPI ──
assert(
  analysisPageFlat.includes('Number(analysis.data?.totalUnits ?? 0)') &&
    analysisPageFlat.includes('Number(analysis.data?.totalRevenue ?? 0)'),
  'Analysis page renders backend totalRevenue/totalUnits KPIs',
);
assert(
  !/rows\.reduce\(\(n, r\) => n \+ num\(r\.total_revenue\)/.test(analysisPageFlat) &&
    !/rows\.reduce\(\(n, r\) => n \+ num\(r\.total_qty\)/.test(analysisPageFlat),
  'Analysis page no longer reduces SKU rows into the authoritative Revenue/Units KPI',
);

// ── 7. Selected client/store carried in BOTH query keys + requests ──
assert(
  hooks.includes("['analysis', dateRange.dateFrom, dateRange.dateTo, clientId ?? 'scope']") &&
    hooks.includes('portalApi.analysis(t, dateRange, clientId)'),
  'useAnalysis includes clientId in its query key + request (parity with useDashboard)',
);
assert(
  /analysis: \(token: string, range: PortalDateRange, clientId\?: number\)/.test(api),
  'api.analysis accepts and forwards clientId',
);
assert(
  apiFlat.includes('function dashboardRangeParams(range: PortalDateRange)') &&
    apiFlat.includes('const range = dashboardRangeParams(rangeInput);') &&
    apiFlat.includes('...dashboardRangeParams(range),'),
  'Dashboard and Analysis send dateFrom/dateTo from the same explicit PortalDateRange helper',
);

// ── 8. Wired into the suite ──
assert(
  pkg.scripts?.['test:client-portal-analytics-parity'] ===
    'node scripts/client-portal-analytics-parity-guard.mjs',
  'package exposes test:client-portal-analytics-parity',
);

if (failed) process.exit(1);
console.log('\nclient portal analytics parity guard passed.');
