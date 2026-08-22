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

// 1. Both shared helpers accept a shippingBasis and, for customer_billed, take
//    their money from the canonical billing_line_items shipping line.
assert(/shippingBasis/.test(analysis), 'getSkuBreakdownFromOrderItems accepts shippingBasis');
assert(/shippingBasis/.test(skuOrders), 'getSkuOrdersForSku accepts shippingBasis');
assert(
  /billing_line_items[\s\S]{0,160}line_type\s*=\s*'shipping'/.test(analysis),
  'analysis customer_billed sums billing_line_items shipping',
);
// CP-060 correction: sku-orders no longer sums billing_line_items itself. It
// delegates to the canonical per-shipment resolver — the same one the Orders
// surface and the order-detail charge summary use — so the drawer figure cannot
// drift from theirs. The requirement is unchanged (customer_billed money comes
// from the canonical shipping billing line); only its owner moved. Following the
// delegation keeps this guard pinned to the real source rather than to a
// spelling in one file.
const customerShippingRate = read('src/lib/client-portal/customer-shipping-rate.ts');
assert(
  /shipmentCustomerShippingRateSql/.test(skuOrders) &&
    /customer-shipping-rate/.test(skuOrders),
  'sku-orders customer_billed money comes from the canonical per-shipment resolver',
);
assert(
  /billing_line_items[\s\S]{0,160}line_type\s*=\s*'shipping'/.test(customerShippingRate),
  'the canonical resolver sums billing_line_items shipping',
);
// CP-060 second correction (Hermes 2026-08-22): sku-orders reads
// billing_line_items again, but ONLY to measure what Billing charges so a
// divergence from the eligible-label sum can be reported as `billing_mismatch`.
// It must never become a second source for the displayed class money. Pin the
// property, not the absence of the table name.
assert(
  (skuOrders.match(/from billing_line_items/gi) || []).length === 1 &&
    /\) inv on true/.test(skuOrders),
  'sku-orders reads billing_line_items exactly once, as the reconciliation lateral',
);
assert(
  /labels\.customer_money\s+as money_total/.test(skuOrders) &&
    /labels\.customer_std\s+as money_std/.test(skuOrders),
  'the displayed customer_billed money still comes from the eligible-shipment resolver',
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

// 4. Client boundary exposes customer-named drawer keys, not cost-named ones.
//    CP-060 replaced the std-only generic shippingCharge/avgShippingCharge with
//    per-class fields; the internal *_cost vocabulary still must not cross.
assert(
  /shippingTotal/.test(cpAnalysis) &&
    /shippingStandard/.test(cpAnalysis) &&
    /shippingExpedited/.test(cpAnalysis),
  'sku-orders boundary exposes shippingTotal / shippingStandard / shippingExpedited',
);
assert(
  !/standard_shipping_cost/.test(cpAnalysis),
  'sku-orders boundary does not leak the internal standard_shipping_cost column name',
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
