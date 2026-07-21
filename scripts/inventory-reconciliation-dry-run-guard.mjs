import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(root, filePath), 'utf8');
const script = read('scripts/reconcile-inventory-stock.ts');
const admin = read('src/routes/admin.ts');
const packageJson = JSON.parse(read('package.json'));

assert.equal(
  packageJson.scripts?.['inventory:reconcile:dry-run'],
  'tsx scripts/reconcile-inventory-stock.ts',
);
assert.equal(
  packageJson.scripts?.['test:inventory-reconciliation-dry-run'],
  'node scripts/inventory-reconciliation-dry-run-guard.mjs',
);
assert.match(script, /PS439_RECONCILIATION_RETIRED/);
assert.match(script, /audit:ps-439-inventory-discrepancies/);
assert.doesNotMatch(script, /stockQty|effectiveStock|inventory_ledger balance/);
assert.match(admin, /mode: 'report-only'/);
assert.match(admin, /inventory_quantity/);
assert.match(admin, /legacy_identity_gaps/);
assert.match(admin, /APPLY_REMOVED/);
assert.doesNotMatch(admin, /current_stock_qty|effective_stock|rowsToAdjust/);

console.log('PASS PS-439 retired Client Portal stock reconciliation and kept ledger-only diagnostics');
