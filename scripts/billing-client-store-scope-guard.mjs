import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS ${message}`);
}

function assert(condition, message) {
  if (condition) pass(message);
  else fail(message);
}

const routeSource = read('src/routes/billing.ts');
// billingSummary/billingDetails (with their scope-predicate call sites) moved
// to services/billing-summaries.ts (C4); assert over both so coverage follows.
const serviceSource = read('src/services/billing-read-support.ts') + '\n' + read('src/services/billing-summaries.ts');
const reportingSource = read('src/services/reporting-metrics.ts');
const packageJson = JSON.parse(read('package.json'));

assert(
  routeSource.includes('getClientStoreScope') && routeSource.includes('type ClientStoreScope'),
  'billing imports client/store scope helpers',
);
assert(
  routeSource.includes('billingScopeFromContext') &&
    routeSource.includes("c.get('clientIds'") &&
    routeSource.includes("c.get('storeIds'"),
  'billing builds scope from auth context',
);
assert(
  routeSource.includes('billingClientScopePredicate') &&
    serviceSource.includes('billingClientScopePredicate') &&
    reportingSource.includes('billingMetricsScopePredicate'),
  'billing route, service, and metrics define client scope predicates',
);
assert(
  routeSource.includes('const configScope = billingScopeFromContext(c)') &&
    routeSource.includes('billingClientScopePredicate(configScope)'),
  'billing config applies client/store scope',
);
assert(
  routeSource.includes('withBillingScope(c,') &&
    routeSource.includes('billingSummary(withBillingScope') &&
    routeSource.includes('billingDetails(withBillingScope'),
  'billing summary and details pass auth scope into service',
);
assert(
  routeSource.includes('invoiceScope') &&
    routeSource.includes('billingClientScopePredicate(invoiceScope)'),
  'billing invoice applies client/store scope before rendering',
);
assert(
  routeSource.includes('const totalQty = baseQty + addlQty') &&
    routeSource.includes('<th class="num">Qty</th>') &&
    !routeSource.includes('<th class="num">Base Qty</th>') &&
    routeSource.includes('${addlQty > 0 ? fmt(additionalAmt) :') &&
    !routeSource.includes('${addlQty > 0 ? `${addlQty} (${fmt(additionalAmt)})`'),
  'billing invoice renders total quantity and addl-unit fee without quantity parentheses',
);
assert(
  routeSource.includes('packagePriceScope') &&
    (routeSource.includes('billingClientScopePredicate(packagePriceScope)') ||
      routeSource.includes('billingClientIdScopePredicate(packagePriceScope)')),
  'billing package prices applies client/store scope',
);
assert(
  serviceSource.includes('scopeClientIds?: number[]') &&
    serviceSource.includes('scopeStoreIds?: number[]') &&
    serviceSource.includes('scopeRestricted?: boolean'),
  'billing service accepts client/store scope input',
);
assert(
  serviceSource.includes('billingLineItemScopePredicate(input)') &&
    serviceSource.includes('billingClientScopePredicate(input)') &&
    reportingSource.includes('scopeClientIds') &&
    reportingSource.includes('scopeStoreIds'),
  'billing summary/details/read-model reads apply client/store scope',
);
// CP-059A — CP-019 is now satisfied by RETIREMENT, not by scoping.
//
// This previously pinned tenant scope on three parts of generateLineItems: its
// destructive billing_line_items delete, its source query, and its config query. The
// risk it guarded was that an omitted clientId on a DESTRUCTIVE period rebuild could
// wipe every tenant's billing rows.
//
// That generator is gone. PrepShip is the sole owner of billing_line_items generation,
// so the Client Portal has no destructive billing path left to scope. Asserting the
// path CANNOT EXIST is strictly stronger than asserting it was scoped correctly — a
// scoped destructive writer is still a second authority over one money table.
//
// Read-path scope coverage is unchanged and still asserted above.
const generatorHome = path.join(root, 'src/services/billing.ts');
assert(
  !fs.existsSync(generatorHome),
  'CP-059A: src/services/billing.ts must not exist — it owned generateLineItems, and a'
    + ' file by that name invites a generator to be re-added to the portal',
);

assert(
  packageJson.scripts?.['test:billing-client-scope'] ===
    'node scripts/billing-client-store-scope-guard.mjs',
  'package exposes billing client/store scope guard',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
