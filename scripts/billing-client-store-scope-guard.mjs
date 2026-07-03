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
const serviceSource = read('src/services/billing.ts') + '\n' + read('src/services/billing-summaries.ts');
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
// CP-019: generateLineItems (the destructive generate → DELETE → recreate path)
// must apply tenant scope to its config query, its source query, AND its
// billing_line_items delete — not just the read path in billing-summaries.ts.
// The check above passes even if generateLineItems is unscoped, so pin the
// generate/delete path explicitly here.
const generateSource = read('src/services/billing.ts');
const delStart = generateSource.indexOf('db.delete(billingLineItems)');
const deleteBlock = delStart >= 0 ? generateSource.slice(delStart, delStart + 600) : '';
assert(
  deleteBlock.includes('billingLineItemScopePredicate(input)'),
  'CP-019: the destructive billing_line_items delete is tenant-scoped (an omitted clientId cannot wipe every tenant)',
);
assert(
  generateSource.includes('export function billingOrderScopePredicate') &&
    generateSource.includes('billingOrderScopePredicate(input)'),
  'CP-019: generateLineItems source query applies order-level tenant scope',
);
const configBlock = /const configs = await db\.execute[\s\S]*?order by c\.name asc/.exec(generateSource)?.[0] ?? '';
assert(
  configBlock.includes('billingClientScopePredicate(input)'),
  'CP-019: generateLineItems config query applies client/store scope',
);

assert(
  packageJson.scripts?.['test:billing-client-scope'] ===
    'node scripts/billing-client-store-scope-guard.mjs',
  'package exposes billing client/store scope guard',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
