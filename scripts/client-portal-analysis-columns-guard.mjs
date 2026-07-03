// CP-011 — the active Client Portal Analysis SKU table must NOT expose the
// internal "Ext. Shipped" column (order shipped with no local shipment row).
// It is an operator/debug classification, not a customer-facing metric, and DJ
// asked for it to be removed. This guard pins the removal so it can't creep
// back, while asserting the metrics that MUST remain are still present.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const analysis = read('portal-client/src/pages/Analysis.tsx');

// ── The removal: no Ext. Shipped column, header, key, or "N ext" pill ──
assert(
  !/key:\s*'ext'/.test(analysis),
  "Analysis table has no column with key 'ext' (Ext. Shipped removed)",
);
assert(
  !analysis.includes("header: 'Ext. Shipped'") && !/Ext\.\s*Shipped/.test(analysis),
  'Analysis table no longer renders an "Ext. Shipped" header',
);
assert(
  !/\}\s*ext<\/span>/.test(analysis) && !analysis.includes('{num(r.ext_shipped)} ext'),
  'Analysis table no longer renders the "N ext" external-shipped pill',
);

// ── The metrics that MUST survive the removal (the rest of the table) ──
const required = [
  "header: 'Item Name'",
  "header: 'SKU'",
  "header: 'Client'",
  "header: 'Orders'",
  "header: 'Pending'",
  "header: 'Total Qty'",
  "header: 'Units Trend'",
  "header: 'Avg Sell Price'",
  "header: 'Total Revenue'",
];
for (const header of required) {
  assert(analysis.includes(header), `Analysis table still has ${header}`);
}

if (failed) process.exit(1);
console.log('\nclient portal analysis columns guard passed.');
