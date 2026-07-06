// Guard: Dashboard/top-bar filtering should use a PrepShip-style date-range
// control (preset rail + calendar surface + Apply/Cancel), backed by explicit
// dateFrom/dateTo values instead of a bare days dropdown.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.error(`FAIL: missing ${rel}`);
    failed = true;
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

const pkg = JSON.parse(read('package.json'));
const topbar = read('portal-client/src/components/layout/Topbar.tsx');
const dateFilter = read('portal-client/src/components/layout/DateRangeFilter.tsx');
const portalContext = read('portal-client/src/lib/portalContext.tsx');
const hooks = read('portal-client/src/lib/hooks.ts');
const api = read('portal-client/src/lib/api.ts');

assert(pkg.scripts?.['test:dashboard-date-range-filter'] === 'node scripts/dashboard-date-range-filter-guard.mjs', 'package.json exposes test:dashboard-date-range-filter');

assert(topbar.includes('<DateRangeFilter'), 'Topbar renders the dashboard-style DateRangeFilter');
assert(!/const RANGES\s*=/.test(topbar) && !/RANGES\.map/.test(topbar), 'Topbar no longer owns a tiny days-only range dropdown');

for (const text of ['Today', 'Yesterday', 'Last 7 days', 'Last 15 days', 'Last 30 days', 'This month', 'Last month', 'Last 90 days', 'Year to date']) {
  assert(dateFilter.includes(text), `DateRangeFilter includes preset "${text}"`);
}
for (const text of ['FROM', 'TO', 'Cancel', 'Apply']) {
  assert(dateFilter.includes(text), `DateRangeFilter includes "${text}" affordance`);
}
assert(dateFilter.includes('<CalendarMonth'), 'DateRangeFilter renders the existing calendar month grid');
assert(dateFilter.includes('rangeLabel(dateRange.dateFrom, dateRange.dateTo)'), 'DateRangeFilter trigger shows the explicit date range');
assert(dateFilter.includes('presetRange(preset.id)'), 'DateRangeFilter computes a real date range for each preset');

assert(/dateRange:\s*PortalDateRange/.test(portalContext), 'Portal filter context exposes an explicit dateRange');
assert(/setDateRange:\s*\(range: PortalDateRange\) => void/.test(portalContext), 'Portal filter context exposes setDateRange');
assert(/const days = daysBetweenInclusive\(dateRange\.dateFrom,\s*dateRange\.dateTo\)/.test(portalContext), 'Portal context derives days from the explicit range');

assert(/const \{ dateRange, clientId \} = usePortalFilters\(\);/.test(hooks), 'Dashboard hooks read dateRange from portal filters');
assert(/portalApi\.dashboard\(t,\s*dateRange,\s*clientId\)/.test(hooks), 'useDashboard sends the explicit dateRange');
assert(/portalApi\.dailyCounts\(t,\s*dateRange,\s*clientId\)/.test(hooks), 'useDailyCounts sends the explicit dateRange');
assert(/portalApi\.dailyShipments\(t,\s*dateRange,\s*clientId\)/.test(hooks), 'useDailyShipments sends the explicit dateRange');

assert(/export interface PortalDateRange/.test(api), 'portal API exports PortalDateRange');
assert(/function dashboardRangeParams\(range: PortalDateRange\)/.test(api), 'portal API has dashboard timestamp range params');
assert(/function dailyRangeParams\(range: PortalDateRange\)/.test(api), 'portal API has daily-count plain-day range params');
assert(/dashboard:\s*\(token: string, range: PortalDateRange, clientId\?: number\)/.test(api), 'portalApi.dashboard accepts explicit range');
assert(/dailyCounts:\s*\(token: string, range: PortalDateRange, clientId\?: number\)/.test(api), 'portalApi.dailyCounts accepts explicit range');
assert(/dailyShipments:\s*\(token: string, range: PortalDateRange, clientId\?: number\)/.test(api), 'portalApi.dailyShipments accepts explicit range');

if (failed) process.exit(1);
console.log('\nDashboard date-range filter guard passed.');
