import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// Portal order search must span every status ("search bar not working" card):
// the global top-bar search lands on the All tab, Orders adopts ?tab=/?q=,
// an in-tab miss offers the cross-status escape, and the server predicate
// keeps matching the identifiers clients actually paste (order #, recipient,
// SKU/item, tracking number).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const ordersPage = read('portal-client/src/pages/Orders.tsx');
const topbar = read('portal-client/src/components/layout/Topbar.tsx');
const api = readActiveClientPortalApiSource();
const predicates = read('src/lib/client-portal/predicates.ts');
const readModel = read('src/lib/client-portal/read-models/orders.ts');
const packageJson = JSON.parse(read('package.json'));

assert(
  ordersPage.includes("{ id: 'all', label: 'All' }"),
  'Orders exposes an All tab so search can span every status',
);
assert(
  ordersPage.includes("params.get('q')") && ordersPage.includes("params.get('tab')") && ordersPage.includes('if (isTab(urlTab)) setTab(urlTab);'),
  'Orders adopts both ?q= and a validated ?tab= from the URL',
);
assert(
  ordersPage.includes("setTab('all')") && ordersPage.includes('Search all orders'),
  'an in-tab search miss offers the cross-status "Search all orders" escape',
);
assert(
  topbar.includes('&tab=all'),
  'global top-bar search navigates to the All tab, never the default Awaiting cage',
);
assert(
  api.includes("status: opts.status && opts.status !== 'all' ? opts.status : undefined"),
  "api client maps the 'all' tab to no status filter",
);
assert(
  readModel.includes("status === 'awaiting_shipment' ? visibleAwaitingOrdersPredicate() : undefined"),
  'awaiting-only visibility rules stay scoped to the awaiting tab (All must show shipped/cancelled)',
);
for (const [token, label] of [
  ['ilike(orders.orderNumber, pattern)', 'order number'],
  ['ilike(orders.shipToName, pattern)', 'recipient name'],
  ['order_search_item.sku ilike', 'item SKU'],
  ['order_search_shipment.tracking_number ilike', 'tracking number'],
]) {
  assert(predicates.includes(token), `server search predicate matches ${label}`);
}
assert(
  packageJson.scripts?.['test:client-portal-orders-search'] ===
    'node scripts/client-portal-orders-search-guard.mjs',
  'package exposes test:client-portal-orders-search',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nclient portal orders search guard passed.');
