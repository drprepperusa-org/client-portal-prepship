import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-013 / PS-378 - Inventory stock status (LOW/OUT/IN) and the Low/Out
// filter must be backend-owned from effectiveStock, not raw inventory.stockQty.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = false;
function check(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const dto = await import('../src/lib/client-portal/dto');
const { inventoryStockStatusMeta } = await import('../portal-client/src/lib/inventory-status');
const mk = (effectiveStock: number, reorderLevel: number, stockQty = effectiveStock): any =>
  dto.toPortalInventoryDto({
    id: 1,
    clientId: 1,
    sku: 'A',
    name: 'A',
    stockQty,
    effectiveStock,
    reorderLevel,
    active: true,
  } as any);

// Backend derives status from effectiveStock so the portal mirrors PrepShip's
// displayed stock SOT instead of raw cached inventory.stockQty:
//   out = effectiveStock <= 0 ; low = reorderLevel > 0 and effectiveStock <= reorderLevel
let r = mk(0, 5);
check(r.stockStatus === 'out' && r.isOut === true, 'CP-013/PS-378: effectiveStock<=0 -> out');
r = mk(-3, 0);
check(r.stockStatus === 'out', 'CP-013/PS-378: negative effectiveStock -> out even without a reorder level');
r = mk(4, 10);
check(r.stockStatus === 'low' && r.isLow === true && r.isOut === false, 'CP-013/PS-378: effectiveStock<=reorder (reorder>0) -> low');
r = mk(10, 10);
check(r.stockStatus === 'low', 'CP-013/PS-378: effectiveStock == reorder -> low');
r = mk(20, 10);
check(r.stockStatus === 'in' && r.isLow === false && r.isOut === false, 'CP-013/PS-378: effectiveStock>reorder -> in');
r = mk(5, 0);
check(r.stockStatus === 'in', 'CP-013/PS-378: positive effectiveStock with no reorder threshold -> in (not low)');
r = mk(0, 0, 20);
check(r.stockStatus === 'out', 'PS-378: status follows effectiveStock even when raw stockQty is positive');

// CP-053: presentation is an exhaustive mapping of the backend enum. Broken
// runtime data must be visibly unavailable, never silently presented as In.
check(inventoryStockStatusMeta('out').label === 'OUT', 'CP-053: out renders OUT');
check(inventoryStockStatusMeta('low').label === 'LOW', 'CP-053: low renders LOW');
check(inventoryStockStatusMeta('in').label === 'IN', 'CP-053: in renders IN');
check(inventoryStockStatusMeta(undefined).label === 'UNAVAILABLE', 'CP-053: missing status renders UNAVAILABLE, never IN');
check(inventoryStockStatusMeta('broken').label === 'UNAVAILABLE', 'CP-053: invalid status renders UNAVAILABLE, never IN');

// Status matches the read-model filter (out OR low = the rows lowStock returns).
const readModel = read('src/lib/client-portal/read-models/inventory.ts');
check(
  readModel.includes('computeEffectiveStockForIds') && readModel.includes('effectiveStock'),
  'CP-013/PS-378: read-model lowStock filter uses backend effectiveStock like the DTO status',
);
check(
  readModel.includes('inventoryScopePredicate(scope, { clientId, storeId })'),
  'CP-053: canonical server filter keeps client/store scope unchanged',
);

// Frontend renders the backend enum, derives nothing, filters server-side.
const page = read('portal-client/src/pages/Inventory.tsx');
const api = readActiveClientPortalApiSource();
const inventoryContract = /export interface PortalInventory \{[\s\S]*?\n\}/.exec(api)?.[0] ?? '';
check(
  inventoryContract.includes("stockStatus: 'out' | 'low' | 'in';") && !inventoryContract.includes('stockStatus?'),
  'CP-053: PortalInventory requires the exhaustive backend stockStatus enum',
);
check(page.includes('inventoryStockStatusMeta(s.stockStatus)'), 'CP-013/CP-053: Inventory renders the backend stockStatus enum');
check(!/reorder\s*>\s*0\s*&&\s*stock\s*<=\s*reorder/.test(page), 'CP-013: Inventory no longer derives LOW from stock vs reorder');
check(!page.includes("?? 'in'") && !page.includes('STOCK_STATUS_META.in'), 'CP-053: Inventory has no default-to-In path');
check(!page.includes('s.isOut') && !/effectiveStock[^\n]*<=\s*0/.test(page), 'CP-053: stock styling does not recompute Out from inventory values');
check(page.includes('lowStock: lowOnly'), 'CP-013: Low/Out filter is requested server-side (spans all pages)');
check(!page.includes('.filter(isLow)'), 'CP-013: Inventory does not filter the loaded page for low/out');

if (failed) process.exit(1);
console.log('\nclient portal inventory status guard passed.');
