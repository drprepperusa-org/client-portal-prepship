// Analysis SKU drawer ("Recent orders") must open for scoped client-portal users.
// Bug: the Analysis breakdown resolved inv_sku_id to ONE inventory row per SKU
// (globally, smallest id), which can be a client_id=NULL / other-client row a
// scoped caller cannot open — so /analysis/sku-orders 404'd ("Couldn't load this
// SKU's orders") even though the caller's own orders carry that SKU.
// Two scope-safe fixes are pinned here:
//   A) the breakdown resolves inv_sku_id preferring an in-scope inventory row;
//   B) the sku-orders route falls back to the caller's OWN inventory row for the
//      same SKU when the exact id is out of scope.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const analysis = flat(read('src/routes/analysis.ts'));
const route = flat(read('src/routes/client-portal/analysis.ts'));
const pkg = JSON.parse(read('package.json'));

// ── A) breakdown resolves an openable inv_sku_id (prefers in-scope rows) ──
assert(
  analysis.includes('const scopeClientIds = normalizeScopeIds(q.clientIds)') &&
    analysis.includes('const scopeClientIdsSql ='),
  'breakdown builds the caller client-scope array for inventory resolution',
);
assert(
  analysis.includes('(inv.client_id = any(${scopeClientIdsSql})) desc nulls last'),
  'sku_inventory prefers an in-scope inventory row over a global/other-client row',
);

// ── B) sku-orders route falls back to the caller's own inventory row ──
assert(
  route.includes('let [item] = await db'),
  'sku-orders route can re-resolve the inventory item (let, not const)',
);
assert(
  route.includes('const [ref] = await db') &&
    route.includes('lower(${inventory.sku}) = lower(${ref.sku})'),
  'sku-orders route falls back to the caller-scoped inventory row for the same SKU',
);
assert(
  route.includes('inventoryScopePredicate(scope, { clientId, storeId })'),
  'the fallback lookup stays scope-checked (never widens visibility)',
);

assert(
  pkg.scripts?.['test:client-portal-sku-orders-scope'] ===
    'node scripts/client-portal-sku-orders-scope-guard.mjs',
  'package exposes test:client-portal-sku-orders-scope',
);

if (failed) process.exit(1);
console.log('\nclient portal sku-orders scope guard passed.');
