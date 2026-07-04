// CP-023 — the Inventory "sold" column is warehouse ledger ships, NOT order
// units. Pin the honest rename + the SOT-encoding field name end-to-end, and pin
// that Analysis (ordered units) and Inventory (warehouse-shipped) keep DISTINCT
// field names + labels so neither page can be relabeled to imply they match.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = false;
const assert = (c, m) => {
  if (c) console.log(`PASS ${m}`);
  else {
    console.error(`FAIL ${m}`);
    failed = true;
  }
};

const inv = read('portal-client/src/pages/Inventory.tsx');
assert(!inv.includes("header: 'Sold 30d'"), "Inventory no longer labels the ledger-ship column 'Sold 30d'");
assert(/Whse Shipped 30d|Warehouse Shipped 30d/.test(inv), 'Inventory uses the honest Warehouse-Shipped header');
assert(
  /inventory ledger ship events/i.test(inv) && /Not order\/sales units/i.test(inv),
  'Inventory tooltip names the ledger-ship source and disclaims equivalence with Analysis',
);
assert(inv.includes('warehouseShipped30d'), 'Inventory reads the SOT-encoded field warehouseShipped30d');
assert(
  /<Tooltip\b/.test(inv) && /Tooltip\b.*from '@\/components\/ui\/Display'/.test(inv.replace(/\n/g, ' ')),
  'Inventory imports the UI Tooltip (it had none before)',
);

const dto = read('src/lib/client-portal/dto.ts');
const rm = read('src/lib/client-portal/read-models/inventory.ts');
const api = read('portal-client/src/lib/api.ts');
assert(
  dto.includes('warehouseShipped30d') && !dto.includes('soldLast30Days'),
  'portal DTO field is warehouseShipped30d (old key gone)',
);
assert(
  rm.includes('warehouseShipped30d') && !rm.includes('soldLast30Days'),
  'inventory read-model passes warehouseShipped30d (old input key gone — no silent zero)',
);
assert(
  api.includes('warehouseShipped30d') && !api.includes('soldLast30Days'),
  'PortalInventory type uses warehouseShipped30d (old field gone)',
);

// Cross-page no-match invariant (scoped, not brittle whole-file regex).
const analysis = read('portal-client/src/pages/Analysis.tsx');
assert(
  !analysis.includes('warehouseShipped30d') && !/Warehouse Shipped/.test(analysis),
  'Analysis never adopts the Inventory warehouse-shipped field/label',
);
assert(analysis.includes("header: 'Total Qty'"), 'Analysis ordered-units column keeps its distinct Total Qty label');

const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-inventory-sold-label'] ===
    'node scripts/client-portal-inventory-sold-label-guard.mjs',
  'package exposes test:client-portal-inventory-sold-label',
);

if (failed) process.exit(1);
console.log('\nCP-023 inventory sold-label guard passed.');
