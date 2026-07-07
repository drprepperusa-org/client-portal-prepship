// CP-038 — client-portal shipping re-source wiring guard (STATIC).
//
// Pins that the client-portal analytics read the CANONICAL billed shipping
// (shippingBasis: 'customer_billed') from billing_line_items, never the inline-markup
// house basis, while operator/legacy consumers keep the default. A future edit cannot
// silently revert the client to the inline re-derivation, nor re-expose the internal
// allocation keys (shipAlloc/shipUnits) or a cost-named drawer key.
//
// STATIC ONLY — no db / live.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) =>
  fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
const assert = (cond, msg) => {
  if (cond) console.log(`PASS ${msg}`);
  else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
};

const analysis = read('src/routes/analysis.ts');
const skuOrders = read('src/services/sku-orders.ts');
const cpAnalysis = read('src/routes/client-portal/analysis.ts');
const dashRm = read('src/lib/client-portal/read-models/dashboard.ts');
const baseDash = read('src/routes/dashboard.ts');

// 1. Both shared helpers accept a shippingBasis and, for customer_billed, sum the
//    canonical billing_line_items shipping line.
assert(/shippingBasis/.test(analysis), 'getSkuBreakdownFromOrderItems accepts shippingBasis');
assert(/shippingBasis/.test(skuOrders), 'getSkuOrdersForSku accepts shippingBasis');
assert(
  /billing_line_items[\s\S]{0,160}line_type\s*=\s*'shipping'/.test(analysis),
  'analysis customer_billed sums billing_line_items shipping',
);
assert(
  /billing_line_items[\s\S]{0,160}line_type\s*=\s*'shipping'/.test(skuOrders),
  'sku-orders customer_billed sums billing_line_items shipping',
);

// 2. Client consumers pass customer_billed (SKU table + SKU drawer in the route;
//    Dashboard read-model).
assert(
  (cpAnalysis.match(/shippingBasis:\s*'customer_billed'/g) || []).length >= 2,
  'client-portal analysis route passes customer_billed to both helpers',
);
assert(
  /shippingBasis:\s*'customer_billed'/.test(dashRm),
  'client dashboard read-model passes customer_billed',
);

// 3. Base/legacy consumers keep the default (do NOT force customer_billed).
assert(
  !/shippingBasis:\s*'customer_billed'/.test(baseDash),
  'base dashboard route keeps the default (house_markup) basis',
);

// 4. Client boundary exposes a charge-named drawer key, not a cost-named one.
assert(
  /shippingCharge/.test(cpAnalysis) && /avgShippingCharge/.test(cpAnalysis),
  'sku-orders boundary exposes shippingCharge / avgShippingCharge',
);

// 5. The client Dashboard read-model no longer carries the internal allocation vocab.
assert(
  !/shipAlloc/.test(dashRm) && !/shipUnits/.test(dashRm),
  'dashboard read-model dropped shipAlloc/shipUnits',
);

// package.json wiring (also auto-discovered by scripts/run-guards.mjs).
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:client-portal-shipping-resource'] ===
    'node scripts/client-portal-shipping-resource-guard.mjs',
  'package.json exposes test:client-portal-shipping-resource',
);

if (failed) process.exit(1);
console.log('\nCP-038 client-portal shipping re-source guard passed.');
