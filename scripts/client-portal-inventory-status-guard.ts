// CP-013 — Inventory stock status (LOW/OUT/IN) and the Low/Out filter must be
// backend-owned, so the badge and the server-side filter share ONE definition
// and the filter spans the full dataset (not just the loaded page). Enforced at
// runtime against the pure DTO + a static pin on the page.
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
const mk = (stockQty: number, reorderLevel: number): any =>
  dto.toPortalInventoryDto({ id: 1, clientId: 1, sku: 'A', name: 'A', stockQty, reorderLevel, active: true } as any);

// ── Backend derives status the same way the read-model's lowStock predicate does:
//    out = stockQty <= 0 ; low = reorderLevel > 0 and stockQty <= reorderLevel ──
let r = mk(0, 5);
check(r.stockStatus === 'out' && r.isOut === true, 'CP-013: stockQty<=0 → out');
r = mk(-3, 0);
check(r.stockStatus === 'out', 'CP-013: negative stock → out even without a reorder level');
r = mk(4, 10);
check(r.stockStatus === 'low' && r.isLow === true && r.isOut === false, 'CP-013: stock<=reorder (reorder>0) → low');
r = mk(10, 10);
check(r.stockStatus === 'low', 'CP-013: stock == reorder → low');
r = mk(20, 10);
check(r.stockStatus === 'in' && r.isLow === false && r.isOut === false, 'CP-013: stock>reorder → in');
r = mk(5, 0);
check(r.stockStatus === 'in', 'CP-013: in stock with no reorder threshold → in (not low)');

// ── Status matches the read-model filter (out OR low = the rows lowStock returns) ──
const readModel = read('src/lib/client-portal/read-models/inventory.ts');
check(
  /stockQty\}\s*<=\s*0\s*or\s*\(\$\{[^}]*reorderLevel\}\s*>\s*0\s*and\s*\$\{[^}]*stockQty\}\s*<=\s*\$\{[^}]*reorderLevel\}\)/.test(
    readModel.replace(/\s+/g, ' '),
  ) || readModel.includes('reorderLevel} > 0'),
  'CP-013: read-model lowStock filter uses the same out/low predicate the DTO status mirrors',
);

// ── Frontend renders the backend enum, derives nothing, filters server-side ──
const page = read('portal-client/src/pages/Inventory.tsx');
check(page.includes('STOCK_STATUS_META[s.stockStatus'), 'CP-013: Inventory renders the backend stockStatus enum');
check(!/reorder\s*>\s*0\s*&&\s*stock\s*<=\s*reorder/.test(page), 'CP-013: Inventory no longer derives LOW from stock vs reorder');
check(page.includes('lowStock: lowOnly'), 'CP-013: Low/Out filter is requested server-side (spans all pages)');
check(!page.includes('.filter(isLow)'), 'CP-013: Inventory does not filter the loaded page for low/out');

if (failed) process.exit(1);
console.log('\nclient portal inventory status guard passed.');
