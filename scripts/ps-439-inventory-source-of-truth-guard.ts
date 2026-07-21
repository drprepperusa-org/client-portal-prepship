import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeClientStorageBilling } from '../src/services/billing-storage';

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.SUPABASE_URL = 'https://example.test';
process.env.SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.SUPABASE_JWT_SECRET = 'test';
process.env.NODE_ENV = 'test';
const { inventoryLedgerQuantity } = await import('../src/services/inventory-stock-math');

const read = (path: string) => readFileSync(path, 'utf8');

assert.equal(inventoryLedgerQuantity([{ qty: 2 }, { qty: -5 }]), -3);
assert.equal(inventoryLedgerQuantity([{ qty: 2 }, { qty: -5 }, { qty: 6 }]), 3);

const storage = computeClientStorageBilling({
  monthlyRatePerCuFt: 0.31,
  periodStart: '2026-01-01T00:00:00Z',
  periodEnd: '2026-02-01T00:00:00Z',
  skus: [{
    inventoryId: 1,
    sku: 'CP-PS439',
    cuFtPerUnit: 1,
    movements: [
      { qty: -2, effectiveAt: '2026-01-01T00:00:00Z' },
      { qty: 3, effectiveAt: '2026-01-11T00:00:00Z' },
    ],
  }],
});
assert.equal(storage.daysInPeriod, 31);
assert.equal(storage.totalCuFtDays, 21);
assert.equal(storage.proofs[0]?.hadNegativeBalance, true);

const migration = read('drizzle/0048_inventory_quantity_sot.sql');
const schema = read('src/db/schema/inventory.ts');
const owner = read('src/services/inventory-movement.ts');
const readModel = read('src/lib/client-portal/read-models/inventory.ts');
const dto = read('src/lib/client-portal/dto.ts');
const contract = read('src/lib/client-portal/contracts/inventory.ts');
const page = read('portal-client/src/pages/Inventory.tsx');
const receive = read('src/routes/client-portal/inventory.ts');
const inboundReceive = read('src/routes/client-portal/inbound.ts');
const receiveModal = read('portal-client/src/components/inbound/ReceiveInventoryModal.tsx');
const fulfillment = read('src/services/fulfillment-deductions.ts');
const adminRoute = read('src/routes/admin.ts');
const billing = read('src/services/billing.ts');
const returns = [
  read('src/routes/client-portal/returns/actions.ts'),
  read('src/services/returns.ts'),
  read('src/services/return-label-purchase-intents.ts'),
].join('\n');

assert.match(migration, /PS439_INVENTORY_CUTOVER_BLOCKED/);
assert.match(migration, /inventory_ledger_no_update_delete/);
assert.match(migration, /inventory_ledger_nonzero_qty_chk/);
assert.match(migration, /billing_line_items_finalized_immutable/);
assert.match(migration, /billing_li_storage_period_unique_idx/);
assert.doesNotMatch(schema, /stockQty:/);
assert.match(owner, /onConflictDoNothing\(\)/);
assert.match(owner, /INVENTORY_IDEMPOTENCY_CONFLICT/);
assert.doesNotMatch(owner, /update\(inventory\)[\s\S]{0,200}stockQty/);
assert.match(readModel, /inventoryQuantitySql/);
assert.doesNotMatch(readModel, /stockQty|effectiveStock|computeEffectiveStock/);
assert.match(dto, /row\.inventoryQuantity/);
assert.doesNotMatch(contract, /stockQty|effectiveStock/);
assert.match(page, /s\.inventoryQuantity/);
assert.doesNotMatch(page, /stockQty|effectiveStock|classifyStockStatus/);
assert.match(receive, /applyMovements/);
assert.match(receive, /idempotencyKey:/);
assert.match(receive, /A valid idempotency key is required/);
assert.match(receiveModal, /submissionIdentity/);
assert.match(receiveModal, /idempotencyKey: identity\.key/);
assert.match(inboundReceive, /db\.transaction\(async \(tx\)/);
assert.match(inboundReceive, /applyInventoryMovementInTransaction\(tx/);
assert.match(fulfillment, /Per user override unlock shipped data on 2026-07-21/);
assert.match(fulfillment, /isInventoryAutoDeductEnabled/);
assert.match(fulfillment, /applyInventoryMovementInTransaction/);
assert.match(adminRoute, /PS439_IMMUTABLE_HISTORY/);
assert.doesNotMatch(adminRoute, /truncate table inventory_ledger/i);
assert.match(billing, /eq\(billingLineItems\.invoiced, false\)/);
assert.match(billing, /computeClientStorageBilling/);
assert.match(billing, /coalesce\(l\.effective_at, l\.created_at\)/);
assert.doesNotMatch(billing, /if \(!billableRows\.length\)/);
assert.doesNotMatch(returns, /applyInventoryMovement|inventoryLedger|from ['"].*inventory['"]/);

console.log('PASS CP PS-439 inventory source-of-truth guard');
