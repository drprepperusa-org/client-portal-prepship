// Guard: the Dashboard top-bar client switcher must actually filter the
// Dashboard data. The bug was a React Query trap — clientId was in the query
// KEY (so it refetched) but never in the query FUNCTION (so the request was
// identical), making "All clients" → a specific client a visual no-op.
//
// Also pins the top-bar search so a search performed while Orders is already
// open is adopted (the ?q= param is synced into the box, not just read once).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── Hooks pass clientId into the request, not just the cache key ──
{
  const hooks = read('portal-client/src/lib/hooks.ts');
  assert(/portalApi\.dashboard\(t,\s*dateRange,\s*clientId\)/.test(hooks), 'useDashboard sends clientId to the dashboard request');
  assert(/portalApi\.dailyCounts\(t,\s*dateRange,\s*clientId\)/.test(hooks), 'useDailyCounts sends clientId to the request');
  assert(/portalApi\.dailyShipments\(t,\s*dateRange,\s*clientId\)/.test(hooks), 'useDailyShipments sends clientId to the request');
  assert(/useDailyCounts[\s\S]*?clientId\s*\}\s*=\s*usePortalFilters/.test(hooks), 'useDailyCounts reads clientId from portal filters');
  assert(/portalApi\.awaitingCount\(t,\s*clientId\)/.test(hooks), 'useAwaitingCount (Open orders KPI + sidebar badge) sends clientId');
}

// ── API layer accepts + forwards clientId with a scope-safe short-circuit ──
{
  const api = read('portal-client/src/lib/api.ts');
  assert(/dashboard:\s*\(token: string, range: PortalDateRange, clientId\?: number\)/.test(api), 'portalApi.dashboard accepts clientId');
  assert(/dailyCounts:\s*\(token: string, range: PortalDateRange, clientId\?: number\)/.test(api), 'portalApi.dailyCounts accepts clientId');
  assert(/dailyShipments:\s*\(token: string, range: PortalDateRange, clientId\?: number\)/.test(api), 'portalApi.dailyShipments accepts clientId');
  assert(/awaitingCount:\s*\(token: string, clientId\?: number\)/.test(api), 'portalApi.awaitingCount accepts clientId');
  assert(/async function scopedDashboard\(\s*token: string,\s*rangeInput: PortalDateRange,\s*clientId\?: number,?/.test(api), 'scopedDashboard threads clientId');
  const dashboardOwner = api.slice(api.indexOf('async function scopedDashboard'), api.indexOf('async function scopedDailyCounts'));
  assert(dashboardOwner.includes('return apiGet<DashboardSummary>') && !dashboardOwner.includes('Promise.all'), 'scopedDashboard always makes one scoped backend request');
  assert(/async function scopedDailyCounts\(\s*token: string,\s*rangeInput: PortalDateRange,\s*clientId\?: number,?/.test(api), 'scopedDailyCounts threads clientId');
}

// ── Backend honors the explicit client filter for GLOBAL admins too ──
// The original bug: orderScopePredicate/shipmentScopePredicate bailed with
// `return undefined` for unrestricted callers BEFORE applying filters.clientId,
// so the switcher was a no-op for global admins. They must now return the
// explicit (narrowing-only) predicate instead.
{
  // The scope predicates moved from routes/client-portal.ts to
  // lib/client-portal/predicates.ts in the B1 read-model extraction; slice
  // each function body to the next export so the negative assertion can't
  // bleed into a neighboring function.
  const predicates = read('src/lib/client-portal/predicates.ts');
  const fnBody = (name) => {
    const start = predicates.indexOf(`export function ${name}(`);
    if (start === -1) return '';
    const next = predicates.indexOf('\nexport function ', start + 1);
    return predicates.slice(start, next === -1 ? undefined : next);
  };
  for (const fn of ['orderScopePredicate', 'shipmentScopePredicate']) {
    const body = fnBody(fn);
    assert(body.includes('const explicit = and('), `${fn} computes an explicit narrowing predicate`);
    assert(body.includes('if (!scope.isRestricted) return explicit;'), `${fn} applies the explicit filter for unrestricted (global) callers`);
    assert(!body.includes('if (!scope.isRestricted) return undefined;'), `${fn} no longer drops the explicit filter for global admins`);
    assert(body.includes('return and(scopePredicate, explicit);'), `${fn} keeps restricted callers bounded by scope AND the explicit filter`);
  }
}

// ── Orders adopts the ?q= param even when already mounted ──
{
  const orders = read('portal-client/src/pages/Orders.tsx');
  assert(/useEffect\(\(\)\s*=>\s*setQ\(urlQ\),\s*\[urlQ\]\)/.test(orders), 'Orders syncs its search box from the ?q= param on change');
}

// ── Script registered ──
{
  const pkg = JSON.parse(read('package.json'));
  assert(
    pkg.scripts?.['test:dashboard-client-filter'] === 'node scripts/dashboard-client-filter-guard.mjs',
    'package.json exposes test:dashboard-client-filter',
  );
}

if (failed) process.exit(1);
console.log('\nDashboard client-filter + search guard passed.');
