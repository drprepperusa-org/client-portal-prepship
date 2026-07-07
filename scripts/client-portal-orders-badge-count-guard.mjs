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

assert(
  listBlock.includes("status === 'awaiting_shipment' ? visibleAwaitingOrdersPredicate() : undefined"),
  'Orders Awaiting tab applies visibleAwaitingOrdersPredicate',
);
assert(
  countBlock.includes('orderScopePredicate(scope, filters)') &&
    countBlock.includes('activeClientPredicate()') &&
    countBlock.includes("eq(orders.orderStatus, 'awaiting_shipment')") &&
    countBlock.includes('visibleAwaitingOrdersPredicate()'),
  'sidebar badge count uses the same base awaiting predicates as the Orders tab',
);

for (const forbidden of [
  'liveAwaitingSince',
  'gte(orders.orderDate',
  'orders.externallyShipped',
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
    hooks.includes("qc.setQueryData(['awaiting-count'") &&
    hooks.includes("merged.status !== 'awaiting_shipment'") &&
    hooks.includes('query.data.pagination.total'),
  'Awaiting Orders list seeds the sidebar badge cache from its backend pagination total',
);
assert(
  sidebar.includes('badge={item.to === \'/orders\' ? awaitingCount : undefined}') &&
    bottomNav.includes("badge={item.to === '/orders' ? awaiting : 0}"),
  'desktop sidebar and mobile bottom nav render the Orders badge from useAwaitingCount',
);
assert(
  pkg.scripts?.['test:client-portal-orders-badge-count'] ===
    'node scripts/client-portal-orders-badge-count-guard.mjs',
  'package.json exposes test:client-portal-orders-badge-count',
);

if (failed) process.exit(1);
console.log('\nClient portal Orders badge-count guard passed.');
