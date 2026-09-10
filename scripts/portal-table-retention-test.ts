import assert from 'node:assert/strict';
import { loadFixtureModule } from './lib/load-fixture-module';

// Execute the actual hooks with query/React I/O substituted; no browser, database or credentials.
let auth = { userId: 'alpha', accessToken: 'fixture' };
let filters = { clientId: 1, dateRange: { dateFrom: '2026-09-01', dateTo: '2026-09-15' } };
let options: any;
let apiAuth: any;
let placeholder = true;
let countWrites = 0;
const hooks = loadFixtureModule('portal-client/src/lib/hooks.ts', {
  './query-keys': loadFixtureModule('portal-client/src/lib/query-keys.ts', {}),
  './api': { portalApi: new Proxy({}, { get: () => (token: unknown) => { apiAuth = token; return Promise.resolve({ data: [] }); } }) },
  '@/auth': { useAuth: () => auth },
  './portalContext': { usePortalFilters: () => filters },
  react: { useEffect: (fn: () => void) => fn() },
  '@tanstack/react-query': {
    useQuery: (input: unknown) => { options = input; return { isPlaceholderData: placeholder, data: { pagination: { total: 99 } } }; },
    useQueryClient: () => ({ setQueryData: () => { countWrites++; } }),
  },
});
const receipts = loadFixtureModule('portal-client/src/components/inbound/useInboundReceipts.ts', {
  '@/lib/hooks': hooks,
  '@/lib/api': { portalApi: { inboundReceipts: (token: unknown) => { apiAuth = token; return Promise.resolve({ data: [] }); } } },
  '@/lib/portalContext': { usePortalFilters: () => filters },
});
const surfaces = [
  () => hooks.useOrders(), () => hooks.useShipments(), () => hooks.useInventory(),
  () => hooks.useInventoryHistory(), () => hooks.useReturns(),
  () => hooks.useDashboard(), () => hooks.useAnalysis(),
  () => hooks.useInvoicePeriodSummaryRange('2026-09-01', '2026-09-15'),
  () => receipts.useInboundReceipts(),
];
for (const surface of surfaces) {
  auth = { userId: 'alpha', accessToken: 'fixture' }; filters.clientId = 1;
  surface();
  const previous = { meta: options.meta }, data = { data: ['private row'] };
  assert.equal(options.placeholderData(data, previous), data);
  const signal = new AbortController().signal;
  await options.queryFn({ signal });
  assert.equal(apiAuth.signal, signal, 'query cancellation reaches API transport');
  filters.clientId = 2; surface();
  assert.equal(options.placeholderData(data, previous), undefined, 'client switch clears prior display');
  filters.clientId = 1; auth.userId = 'beta'; surface();
  assert.equal(options.placeholderData(data, previous), undefined, 'user switch clears prior display');
  auth = { userId: '', accessToken: '' }; surface();
  assert.equal(options.enabled, false);
  assert.equal(options.placeholderData(data, previous), undefined, 'logout clears prior display');
}
auth = { userId: 'alpha', accessToken: 'fixture' };
hooks.useOrders({ status: 'awaiting_shipment' });
assert.equal(countWrites, 0, 'retained rows must not populate the authoritative sidebar count');
placeholder = false;
hooks.useOrders({ status: 'awaiting_shipment' });
assert.equal(countWrites, 1, 'fresh count still reaches the sidebar');
console.log('PASS table retention: nine surfaces, client/account/logout fences, cancellation, and placeholder count isolation');
