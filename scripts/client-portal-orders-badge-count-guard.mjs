// Client Portal Orders sidebar badge must count the same visible Awaiting
// shipment rows as the Orders page tab. The badge should not silently use a
// narrower "active/live" query that hides rows shown in the table.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const readModel = read('src/lib/client-portal/read-models/orders.ts');
const hooks = read('portal-client/src/lib/hooks.ts');
const sidebar = read('portal-client/src/components/layout/Sidebar.tsx');
const bottomNav = read('portal-client/src/components/layout/BottomNav.tsx');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

function sliceFunction(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  if (start === -1) return '';
  const next = src.indexOf('\nexport async function ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

const listBlock = sliceFunction(readModel, 'listPortalOrders');
const countBlock = sliceFunction(readModel, 'awaitingActiveOrderCount');

assert(listBlock.length > 0, 'listPortalOrders exists');
assert(countBlock.length > 0, 'awaitingActiveOrderCount exists');

// CP-069: ONE exported predicate (orderStatusFilterPredicate) decides the Awaiting tab AND the
// badge — PrepShip's effective-lifecycle pending bucket (portalOrderFulfillmentBucketPredicateSql,
// rendered on the inner effective CASE) narrowed by the portal's visibleAwaitingOrdersPredicate.
// A raw order_status equality is no longer allowed to decide either.
const filterFn = readModel.slice(
  readModel.indexOf('export function orderStatusFilterPredicate('),
  readModel.indexOf('export async function listPortalOrders('),
);
assert(filterFn.length > 0, 'orderStatusFilterPredicate exists in the Orders read-model');
assert(
  filterFn.includes('portalOrderFulfillmentBucketPredicateSql(ORDER_FILTER_BUCKET[status])') &&
    filterFn.includes("status === 'awaiting_shipment' ? visibleAwaitingOrdersPredicate() : undefined"),
  'orderStatusFilterPredicate = PrepShip bucket predicate + visibleAwaitingOrdersPredicate for the Awaiting tab',
);
assert(
  /awaiting_shipment:\s*'pending'/.test(readModel) && /shipped:\s*'shipped'/.test(readModel) && /cancelled:\s*'cancelled'/.test(readModel),
  "the tab ids map onto the pending / shipped / cancelled buckets ('awaiting_shipment' = pending)",
);
assert(listBlock.includes('orderStatusFilterPredicate(status)'), 'Orders tabs filter through orderStatusFilterPredicate');
assert(
  countBlock.includes('orderScopePredicate(scope, filters)') &&
    countBlock.includes('activeClientPredicate()') &&
    countBlock.includes("orderStatusFilterPredicate('awaiting_shipment')"),
  'sidebar badge count uses the SAME shared awaiting predicate as the Orders tab',
);
assert(
  !/eq\(orders\.orderStatus,/.test(readModel),
  'no raw orders.order_status equality decides a tab or the badge (PrepShip effective lifecycle owns it)',
);

for (const forbidden of [
  'liveAwaitingSince',
  'gte(orders.orderDate',
  'externallyFulfilled',
  'jsonb_array_length',
  'active_shipment',
]) {
  assert(!countBlock.includes(forbidden), `sidebar badge count does not apply extra filter ${forbidden}`);
}

assert(
  /useAwaitingCount\(\)[\s\S]*?portalApi\.awaitingCount\(t,\s*clientId\)/.test(hooks),
  'useAwaitingCount sends the active client filter to the badge endpoint',
);
assert(
  hooks.includes('export function useOrders') &&
    hooks.includes('const qc = useQueryClient()') &&
    hooks.includes("qc.setQueryData(portalQueryKey(userId, ['awaiting-count', merged.clientId ?? 'scope'])") &&
    hooks.includes("merged.status !== 'awaiting_shipment'") &&
    hooks.includes('query.data.pagination.total'),
  'Awaiting Orders list seeds the sidebar badge cache from its backend pagination total',
);
assert(
  sidebar.includes('badge={item.to === \'/orders\' ? awaitingCount : undefined}') &&
    bottomNav.includes("badge={item.to === '/orders' ? awaiting : undefined}") &&
    sidebar.includes("badgeUnavailable={item.to === '/orders' && awaitingQuery.isError}") &&
    bottomNav.includes("badgeUnavailable={item.to === '/orders' && awaitingQuery.isError}") &&
    !sidebar.includes('useAwaitingCount().data?.count ?? 0') &&
    !bottomNav.includes('useAwaitingCount().data?.count ?? 0'),
  'desktop sidebar and mobile bottom nav render the Orders count or an explicit unavailable state',
);
assert(
  pkg.scripts?.['test:client-portal-orders-badge-count'] ===
    'node scripts/client-portal-orders-badge-count-guard.mjs',
  'package.json exposes test:client-portal-orders-badge-count',
);

if (failed) process.exit(1);
console.log('\nClient portal Orders badge-count guard passed.');
