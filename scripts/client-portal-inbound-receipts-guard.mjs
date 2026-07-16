import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(file, 'utf8');
const schema = read('src/db/schema/inventory.ts');
const contract = read('src/lib/client-portal/contracts/inbound.ts');
const readModel = read('src/lib/client-portal/read-models/inbound-receipts.ts');
const route = read('src/routes/client-portal/inbound.ts');
const inventoryRoute = read('src/routes/client-portal/inventory.ts');
const inventoryService = read('src/services/inventory.ts');
const capabilities = read('src/lib/client-portal/capabilities.ts');
const accessContract = read('src/lib/client-portal/contracts/access.ts');
const api = read('portal-client/src/lib/api/domains/inbound.ts');
const hooks = read('portal-client/src/components/inbound/useInboundReceipts.ts');
const columns = read('portal-client/src/components/inbound/columns.tsx');
const page = read('portal-client/src/pages/Inbound.tsx');
const receiveModal = read('portal-client/src/components/inbound/ReceiveInventoryModal.tsx');
const matrix = read('docs/source-of-truth-matrix.md');
const scripts = JSON.parse(read('package.json')).scripts ?? {};

assert.match(
  schema,
  /effectiveAt:\s*timestamp\('effective_at'/,
  'CP maps PrepShip inventory_ledger.effective_at without a migration',
);
for (const field of ['inventoryId', 'receivedUnits', 'receivedAt']) {
  assert.ok(contract.includes(field), `PortalInboundReceipt owns ${field}`);
}
assert.match(readModel, /eq\(inventoryLedger\.type, 'receive'\)/, 'read model selects only canonical receive movements');
assert.match(
  readModel,
  /coalesce\(\$\{inventoryLedger\.effectiveAt\}, \$\{inventoryLedger\.createdAt\}\)/,
  'receivedAt uses effective clock then persistence clock',
);
assert.ok(readModel.includes('inventoryScopePredicate(scope)'), 'receipt reads reuse fail-closed inventory tenant scope');
assert.ok(
  readModel.includes('eq(inventory.clientId, clientId)'),
  'global client filter narrows receipt reads explicitly',
);
assert.ok(
  readModel.includes('dateFrom.toISOString()') && readModel.includes('dateTo.toISOString()'),
  'receipt reads apply encoded timestamp boundaries',
);
assert.doesNotMatch(
  readModel,
  /inboundShipments|\.insert\(|\.update\(|\.delete\(/,
  'receipt read model neither copies nor mutates business data',
);
assert.doesNotMatch(readModel, /createdBy/, 'customer receipt DTO does not expose operator identity');
assert.ok(route.includes("app.get('/inbound/receipts'"), 'read-only inbound receipts endpoint exists');
assert.ok(route.includes("recordPortalAudit('portal.inbound.receipts.list'"), 'receipt reads are audited');
assert.ok(api.includes("'/api/client-portal/inbound/receipts'"), 'frontend API calls the receipt endpoint');
assert.ok(
  hooks.includes("['inbound-receipts'") && hooks.includes('dateRange.dateFrom'),
  'receipt query is client/date scoped',
);
assert.ok(page.includes('Received inventory'), 'Inbound renders its received inventory section');
assert.ok(
  columns.includes('receivedUnits') && columns.includes('receivedAt'),
  'Inbound receipt columns render canonical receipt fields',
);
assert.ok(
  capabilities.includes("canReceiveInventory: scope.isGlobal || scope.permissions.includes('settings:write')") &&
    accessContract.includes('canReceiveInventory: boolean'),
  'the backend owns the receive-inventory capability for global admins and scoped operators',
);
assert.ok(inventoryRoute.includes("app.post('/inventory/receive'"), 'the scoped receive-inventory endpoint exists');
assert.ok(
  inventoryRoute.includes('inventoryScopePredicate(scope, { clientId })') &&
    inventoryRoute.includes('eq(inventory.clientId, clientId)'),
  'receive inventory is bounded to both caller scope and the selected client',
);
assert.ok(
  inventoryRoute.indexOf("recordCriticalPortalAudit('portal.inventory.receive.requested'") <
    inventoryRoute.indexOf('await applyMovements('),
  'critical audit persists before the canonical inventory mutation',
);
assert.ok(
  inventoryService.includes('export async function applyMovements') &&
    inventoryService.includes('return db.transaction(async (tx) =>') &&
    inventoryService.includes('stockQty: sql`${inventory.stockQty} + ${move.qty}`'),
  'receive worksheets use one atomic canonical inventory ledger transaction',
);
assert.ok(
  api.includes("'/api/client-portal/inventory/receive'") &&
    page.includes('ReceiveInventoryModal') &&
    receiveModal.includes('portalApi.receiveInventory'),
  'the Inbound worksheet submits through the scoped Client Portal receive API',
);
assert.ok(
  receiveModal.includes("queryClient.invalidateQueries({ queryKey: ['inventory'] })") &&
    receiveModal.includes("queryClient.invalidateQueries({ queryKey: ['inbound-receipts'] })"),
  'successful receiving refreshes canonical stock and receipt history',
);
assert.ok(
  matrix.includes('inventory_ledger.qty') && matrix.includes('inventory_ledger.effective_at'),
  'SOT matrix documents receipt quantity and clock',
);
assert.equal(scripts['test:client-portal-inbound-receipts'], 'node scripts/client-portal-inbound-receipts-guard.mjs');

console.log('PASS Client Portal inbound receipts shadow PrepShip inventory ledger truth');
