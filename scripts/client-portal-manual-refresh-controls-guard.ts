import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function reject(source: string, pattern: RegExp, message: string): void {
  assert(!pattern.test(source), message);
}

const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const orders = read('portal-client/src/pages/Orders.tsx');
const billing = read('portal-client/src/pages/Billing.tsx');
const topbar = read('portal-client/src/components/layout/Topbar.tsx');
const portalContext = read('portal-client/src/lib/portalContext.tsx');

assert(
  packageJson.scripts?.['test:client-portal-manual-refresh-controls'] ===
    'tsx scripts/client-portal-manual-refresh-controls-guard.ts',
  'package.json must expose test:client-portal-manual-refresh-controls',
);

reject(
  orders,
  /\bFill rates\b|\bhandleFillRates\b|\bbackfillRates\b|\bbackfillStatus\b|\bBackfillJob\b/,
  'Orders must not expose the manual Fill rates/backfill control.',
);
reject(
  orders,
  /\bhandleSync\b|Syncing all pages|>\s*Sync\s*</,
  'Orders must not expose the manual Sync control.',
);

reject(
  billing,
  /const \[refreshing, setRefreshing\]|async function refresh\(\)|>\s*Refresh\s*<\/Button>/,
  'Billing must not expose a separate manual Refresh control; Update Billing owns regeneration and read invalidation.',
);

reject(
  topbar,
  /\bRefreshCw\b|aria-label="Refresh data"|Refresh data|\bdoRefresh\b|\brefreshing\b/,
  'Topbar must not expose the manual refresh button beside notifications.',
);
reject(
  topbar,
  /\brefreshAll\b/,
  'Topbar must not call the removed global refresh helper.',
);
reject(
  portalContext,
  /\brefreshAll\b/,
  'Portal filter context must not expose a global manual refresh helper.',
);

if (failures.length > 0) {
  console.error('Client portal manual refresh controls guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Client portal manual refresh controls guard passed.');
