import { readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) {
    console.error(`portal query session scope guard failed: ${message}`);
    process.exit(1);
  }
  console.log(`PASS ${message}`);
}

const source = readFileSync('web/src/lib/portalQueries.ts', 'utf8');

assert(source.includes('function portalSessionKey'), 'portal queries derive a session-specific cache key');
assert(source.includes('parsed.sub') && source.includes('appMetadata.clientIds') && source.includes('appMetadata.storeIds'), 'session cache key includes user and client/store scope claims');

const queryHooks = [
  'useDashboardQuery',
  'useDailyCountsQuery',
  'useOrdersQuery',
  'useShipmentsQuery',
  'useInventoryQuery',
  'useBillingQuery',
  'useClientsQuery',
  'useSettingsQuery',
  'useMeQuery',
  'useSyncStatusQuery',
  'useProductsQuery',
  'useAnalysisOverviewQuery',
  'useAnalysisSkuBreakdownQuery',
  'useAnalysisSkuOrdersQuery',
  'useDailyShipmentsQuery',
  'useCarrierAccountsQuery',
];

for (const hook of queryHooks) {
  const start = source.indexOf(`export function ${hook}`);
  assert(start >= 0, `${hook} exists`);
  const next = source.indexOf('\nexport function ', start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert(/queryKey:\s*(?:\[[\s\S]*?portalQueryKeys\.\w+\(token|portalQueryKeys\.\w+\(token)/.test(body), `${hook} query key is scoped by token`);
}
