import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

const readModel = read('src/lib/client-portal/read-models/inventory.ts');
const predicates = read('src/lib/client-portal/predicates.ts');
const inventoryRoute = read('src/routes/client-portal/inventory.ts');
const dto = read('src/lib/client-portal/dto.ts');
const contract = read('src/lib/client-portal/contracts/inventory.ts');
const page = read('portal-client/src/pages/Inventory.tsx');
const receiveModal = read('portal-client/src/components/inbound/ReceiveInventoryModal.tsx');
const returns = [
  read('src/routes/client-portal/returns/actions.ts'),
  // Split out of actions.ts. They belong in this blob or the negative below silently
  // stops scanning them, and a vacuous negative proves nothing.
  read('src/routes/client-portal/returns/external-label.ts'),
  read('src/routes/client-portal/returns/billing-date.ts'),
  read('src/services/returns.ts'),
  read('src/services/return-label-purchase-intents.ts'),
].join('\n');
const main = read('src/main.ts');
const env = read('src/lib/env.ts');
const portalBilling = read('src/routes/client-portal/billing.ts');
const localBillingRoute = read('src/routes/billing.ts');
const invoiceReadModel = read('src/lib/client-portal/read-models/invoice-details.ts');
const invoiceRoute = read('src/routes/client-portal/invoices.ts');

assert.match(readModel, /inventoryQuantitySql/);
assert.doesNotMatch(readModel, /stockQty|effectiveStock|computeEffectiveStock/);
assert.match(predicates, /inventoryLedgerScopePredicate/);
assert.match(predicates, /coalesce\(\$\{inventoryLedger\.clientId\}, \$\{inventory\.clientId\}\)/);
assert.match(inventoryRoute, /inventoryLedgerScopePredicate/);
assert.match(inventoryRoute, /coalesce\(\$\{inventoryLedger\.effectiveAt\}, \$\{inventoryLedger\.createdAt\}\)/);

for (const source of [dto, contract, page]) {
  assert.doesNotMatch(source, /stockQty|currentStock|effectiveStock|displayStock|totalUnits/);
}
assert.match(dto, /row\.inventoryQuantity/);
assert.match(dto, /classifyStockStatus\(stock, reorder\)/);
assert.match(page, /s\.inventoryQuantity/);
assert.doesNotMatch(page, /classifyStockStatus|Math\.max\(0/);

assert.match(inventoryRoute, /applyMovements/);
assert.match(inventoryRoute, /idempotencyKey:/);
assert.match(receiveModal, /submissionIdentity/);
assert.match(receiveModal, /idempotencyKey: identity\.key/);

assert.doesNotMatch(returns, /applyInventoryMovement|inventoryLedger|from ['"].*inventory['"]/);

assert.match(env, /CLIENT_PORTAL_ONLY_API:\s*booleanFlag\(true\)/);
assert.match(main, /env\.NODE_ENV === 'production' \|\| env\.CLIENT_PORTAL_ONLY_API/);
assert.match(main, /if \(!clientPortalOnly\) \{[\s\S]*app\.route\('\/billing', billingRoute\)/);
assert.doesNotMatch(localBillingRoute, /app\.patch\('\/details\/:orderId/);
assert.doesNotMatch(portalBilling, /generateLineItems\(/);
assert.match(portalBilling, /\$\{baseUrl\}\/billing\/generate/);

assert.doesNotMatch(invoiceReadModel, /heritagePrepFeeRowsForRange|HERITAGE_PREP_FEE_CLIENT_NAME/);
assert.doesNotMatch(invoiceRoute, /heritagePrepFeeRowsForRange|HERITAGE_PREP_FEE_CLIENT_NAME|const sumDetails =/);
assert.match(invoiceRoute, /grandTotal: Number\(row\?\.grandTotal/);

console.log('PASS CP PS-462 inventory and billing shadow-renderer guard');
