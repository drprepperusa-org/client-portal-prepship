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
  assert(/portalApi\.dashboard\(t,\s*days,\s*clientId\)/.test(hooks), 'useDashboard sends clientId to the dashboard request');
  assert(/portalApi\.dailyCounts\(t,\s*days,\s*clientId\)/.test(hooks), 'useDailyCounts sends clientId to the request');
  assert(/portalApi\.dailyShipments\(t,\s*days,\s*clientId\)/.test(hooks), 'useDailyShipments sends clientId to the request');
  assert(/useDailyCounts[\s\S]*?clientId\s*\}\s*=\s*usePortalFilters/.test(hooks), 'useDailyCounts reads clientId from portal filters');
}

// ── API layer accepts + forwards clientId with a scope-safe short-circuit ──
{
  const api = read('portal-client/src/lib/api.ts');
  assert(/dashboard:\s*\(token: string, days = 30, clientId\?: number\)/.test(api), 'portalApi.dashboard accepts clientId');
  assert(/dailyCounts:\s*\(token: string, days = 30, clientId\?: number\)/.test(api), 'portalApi.dailyCounts accepts clientId');
  assert(/dailyShipments:\s*\(token: string, days = 30, clientId\?: number\)/.test(api), 'portalApi.dailyShipments accepts clientId');
  assert(/async function scopedDashboard\(token: string, days: number, clientId\?: number\)/.test(api), 'scopedDashboard threads clientId');
  assert(api.includes('if (clientId !== undefined) return apiGet<DashboardSummary>'), 'scopedDashboard short-circuits to a single scoped request for an explicit client');
  assert(/async function scopedDailyCounts\(token: string, days: number, clientId\?: number\)/.test(api), 'scopedDailyCounts threads clientId');
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
