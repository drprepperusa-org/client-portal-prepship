// Guard: Returns scope checks must be self-contained.
//
// Regression: POST /api/client-portal/returns/:id/label selected only from the
// returns table, but returnScopePredicate reused orderScopePredicate(), which
// references the unaliased orders table. In queries without an outer orders
// join, Postgres errored before return-label creation could run.
import fs from 'node:fs';
import path from 'node:path';
import { readSourceTree } from './lib/source-tree.mjs';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const route = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const pkg = JSON.parse(read('package.json'));

const fnStart = route.indexOf('function returnScopePredicate(');
const fnEnd = route.indexOf('function returnSearchPredicate', fnStart);
const returnScopePredicate =
  fnStart >= 0 && fnEnd > fnStart ? route.slice(fnStart, fnEnd) : '';

assert(returnScopePredicate.length > 0, 'returns route defines returnScopePredicate');
assert(
  !/orderScopePredicate\s*\(/.test(returnScopePredicate),
  'returnScopePredicate does not reuse orderScopePredicate inside the scoped_order subquery',
);
assert(
  /scoped_order\.client_id/.test(returnScopePredicate),
  'returnScopePredicate applies client scope to the scoped_order alias',
);
assert(
  /scoped_order\.store_id/.test(returnScopePredicate),
  'returnScopePredicate applies store scope to the scoped_order alias',
);
assert(
  /select 1 from \$\{orders\} scoped_order/.test(returnScopePredicate),
  'returnScopePredicate keeps the returns-to-orders EXISTS scope boundary',
);
assert(
  /app\.post\('\/returns\/:id\{\[0-9\]\+\}\/label'/.test(route) &&
    /returnScopePredicate\(scope\)/.test(route),
  'return label retry remains scoped through returnScopePredicate',
);
assert(
  pkg.scripts?.['test:client-portal-returns-scope'] ===
    'node scripts/client-portal-returns-scope-guard.mjs',
  'package exposes test:client-portal-returns-scope',
);

if (failed) process.exit(1);
console.log('\nclient portal returns scope guard passed.');
