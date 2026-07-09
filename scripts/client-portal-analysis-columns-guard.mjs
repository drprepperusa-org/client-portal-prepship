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

// ── CP-035: internal financial/ship columns removed from the CUSTOMER view ──
// DJ: customers must not see Std ship / Exp ship / Selling Fees / Profit. These
// are hidden by REMOVAL (not CSS / not a toggle), and there is no React Profit
// derivation. Backend std/exp/selling-fee fields may still exist for admin use.
for (const [header, label] of [
  ["header: 'Std ship'", 'Std ship'],
  ["header: 'Exp ship'", 'Exp ship'],
  ["header: 'Selling Fees'", 'Selling Fees'],
  ["header: 'Profit'", 'Profit'],
]) {
  assert(!analysis.includes(header), `CP-035: Analysis customer table no longer renders a "${label}" column`);
}
for (const key of ["key: 'std'", "key: 'exp'", "key: 'fees'", "key: 'profit'"]) {
  assert(!analysis.includes(key), `CP-035: Analysis customer table has no column with ${key}`);
}

// ── 2026-07-08: DJ removed the "Total Shipping" column from the customer view ──
// CP-047 also removes internal shipping allocation fields from the customer API
// contract, so hiding the column is not the security boundary.
assert(
  !analysis.includes("header: 'Total Shipping'") && !/key:\s*'shipping'/.test(analysis),
  'Analysis customer table no longer renders a "Total Shipping" column',
);
assert(
  !/num\(r\.total_revenue\)\s*-\s*num\(r\.billedShippingTotal\)\s*-\s*num\(r\.total_selling_fee\)/.test(analysis),
  'CP-035: Analysis no longer computes Profit in React (revenue − shipping − selling_fee derivation removed)',
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
