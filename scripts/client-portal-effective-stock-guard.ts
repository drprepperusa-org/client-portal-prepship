// PS-378 - Client Portal inventory must render the same backend-owned
// effective stock that PrepShip Inventory uses. This guard pins the source of
// truth at a backend stock-math owner and keeps the portal DTO/UI as consumers.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const exists = (relativePath: string) => fs.existsSync(path.join(root, relativePath));

process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/postgres';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret';
process.env.NODE_ENV ??= 'test';

let failed = false;
function check(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

const stockMathPath = 'src/services/inventory-stock-math.ts';
check(exists(stockMathPath), 'PS-378: backend inventory-stock-math owner exists');

if (exists(stockMathPath)) {
  const stockMath = await import('../src/services/inventory-stock-math');
  check(
    typeof stockMath.computeEffectiveStockForIds === 'function',
    'PS-378: backend owner exports computeEffectiveStockForIds',
  );
  check(
    stockMath.inventoryLedgerBalance([
      { type: 'receive', qty: 10 },
      { type: 'adjust', qty: 2 },
      { type: 'ship', orderId: 101, qty: -3 },
      { type: 'ship', orderId: 101, qty: -5 },
      { type: 'ship', orderId: 102, qty: -2 },
    ]) === 5,
    'PS-378: ledger balance dedupes duplicate ship rows by order_id using the most negative qty',
  );
}

const dto = await import('../src/lib/client-portal/dto');
const mismatchRow = dto.toPortalInventoryDto({
  id: 1,
  clientId: 1,
  sku: 'Booster-gel-001',
  name: 'Booster Gel',
  stockQty: 1059,
  effectiveStock: 1013,
  reorderLevel: 1015,
  baseUnitQty: 12,
  active: true,
} as any);
check(mismatchRow.stockQty === 1059, 'PS-378: DTO preserves raw cached stockQty separately');
check(mismatchRow.effectiveStock === 1013, 'PS-378: DTO effectiveStock uses backend effective stock');
check(mismatchRow.totalUnits === 12156, 'PS-378: DTO totalUnits uses effectiveStock * baseUnitQty');
check(mismatchRow.stockStatus === 'low' && mismatchRow.isLow === true, 'PS-378: DTO low/out status uses effectiveStock');

const outRow = dto.toPortalInventoryDto({
  id: 2,
  clientId: 1,
  sku: 'ZERO',
  name: 'Zero',
  stockQty: 9,
  effectiveStock: 0,
  reorderLevel: 0,
  baseUnitQty: 1,
  active: true,
} as any);
check(outRow.stockStatus === 'out' && outRow.isOut === true, 'PS-378: DTO out status follows effectiveStock even when stockQty is positive');

const readModel = read('src/lib/client-portal/read-models/inventory.ts');
check(
  readModel.includes("from '../../../services/inventory-stock-math'") &&
    readModel.includes('computeEffectiveStockForIds'),
  'PS-378: Client Portal inventory read-model delegates to backend effective-stock owner',
);
check(
  !readModel.includes('lowStock ? sql`(${inventory.stockQty} <= 0') &&
    readModel.includes('effectiveStock'),
  'PS-378: Low/Out filtering is based on effectiveStock, not raw stockQty',
);

const page = read('portal-client/src/pages/Inventory.tsx');
const stockColumn = /key:\s*'stock'[\s\S]*?key:\s*'whseShipped30'/.exec(page)?.[0] ?? '';
check(stockColumn.includes('effectiveStock'), 'PS-378: Inventory Stock column renders/sorts effectiveStock');
check(!stockColumn.includes('s.stockQty ?? 0'), 'PS-378: Inventory Stock column no longer displays raw stockQty');

const packageJson = JSON.parse(read('package.json'));
check(
  packageJson.scripts?.['test:client-portal-effective-stock'] ===
    'tsx scripts/client-portal-effective-stock-guard.ts',
  'PS-378: package exposes the effective-stock guard',
);

if (failed) process.exit(1);
console.log('\nclient portal effective-stock guard passed.');
