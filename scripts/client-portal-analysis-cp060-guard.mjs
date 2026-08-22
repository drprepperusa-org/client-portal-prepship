// CP-060 guard — per-shipment shipping classification stays single-sourced and
// the SKU drawer read model never regresses to newest-label classification.
//
// Pins:
//   1. src/lib/shipping-class.ts holds EXACTLY the 13 canonical expedited
//      services (mirror of prepship-v4 REPORTING_EXPEDITED_SERVICES, PS-418).
//   2. That file is the ONLY definition of EXPEDITED_SERVICES in src/.
//   3. sku-orders.ts imports the shared list and contains no newest-label
//      classifier (`order by s.id desc` was the pre-CP-060 bug).
//   4. routes/analysis.ts consumes the shared list.
//   5. The client contract exposes the per-class fields + money state and the
//      retired std-only generic names stay dead.
//   6. The route DTO maps the money state and no longer reads the retired
//      std-only source column.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}

function read(path) {
  return readFileSync(path, 'utf8');
}

// Strip line + block comments so commented-out code can't satisfy or trip us.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CANONICAL_EXPEDITED = [
  'ups_2nd_day_air', 'ups_2nd_day_air_am',
  'ups_next_day_air', 'ups_next_day_air_saver', 'ups_next_day_air_early_am',
  'ups_3_day_select',
  'usps_priority_mail_express',
  'fedex_2day', 'fedex_2day_am',
  'fedex_express_saver',
  'fedex_priority_overnight', 'fedex_standard_overnight', 'fedex_first_overnight',
];

// 1. Shared module holds exactly the canonical list.
const shippingClass = stripComments(read('src/lib/shipping-class.ts'));
const arrayMatch = shippingClass.match(/EXPEDITED_SERVICES = \[([\s\S]*?)\]/);
check(Boolean(arrayMatch), 'shipping-class.ts defines EXPEDITED_SERVICES');
if (arrayMatch) {
  const listed = [...arrayMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  check(
    JSON.stringify([...listed].sort()) === JSON.stringify([...CANONICAL_EXPEDITED].sort()),
    `shared list matches the 13 canonical PS-418 services (got ${listed.length})`,
  );
}

// 2. Single definition across src/.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}
const definitionFiles = walk('src').filter((path) =>
  /EXPEDITED_SERVICES = \[/.test(stripComments(read(path))),
);
check(
  definitionFiles.length === 1 && definitionFiles[0].replace(/\\/g, '/') === 'src/lib/shipping-class.ts',
  `exactly one EXPEDITED_SERVICES definition, in shipping-class.ts (found: ${definitionFiles.join(', ') || 'none'})`,
);

// 3. sku-orders consumes the shared list and has no newest-label classifier.
const skuOrders = stripComments(read('src/services/sku-orders.ts'));
check(
  skuOrders.includes("from '../lib/shipping-class'"),
  'sku-orders imports the shared classification list',
);
check(
  !/order by s\.id desc/i.test(skuOrders),
  'sku-orders contains no newest-label (`order by s.id desc`) classifier',
);
// The correction (Hermes 2026-08-21). The first cut summed the ORDER TOTAL over
// billing_line_items by order_id while summing the class split over shipments,
// so money on a line pointing at a voided or foreign shipment landed in the
// total, in neither class, and still reported 'attributed'. Both halves must now
// come from the canonical per-shipment resolver, which is also what the order
// detail Shipping row sums — so the drawer total cannot disagree with it.
check(
  skuOrders.includes('shipmentCustomerShippingRateSql') &&
    skuOrders.includes("from '../lib/client-portal/customer-shipping-rate'"),
  'sku-orders takes its shipping money from the canonical per-shipment resolver',
);
check(
  skuOrders.includes('shipmentIsCustomerShippingEligibleSql()'),
  'sku-orders selects eligible shipments through the shared eligibility predicate',
);
check(
  /labels\.customer_money\s+as money_total/.test(skuOrders),
  'the customer_billed total comes from the eligible-shipment resolver, not an order-grain billing sum',
);
check(
  (skuOrders.match(/from billing_line_items/gi) || []).length === 1 &&
    /\) inv on true/.test(skuOrders),
  'the only billing_line_items read is the reconciliation lateral (inv), not a second display total',
);

// Hermes CP-060 return, 2026-08-22. The drawer reads only eligible-shipment
// money, but Billing charges every 'shipping' line by order_id. When the invoice
// exceeds what the labels resolve to, the difference is money the customer IS
// charged; it may not vanish behind a clean 'attributed'.
check(
  /where b\.order_id = o\.id and b\.line_type = 'shipping'/.test(skuOrders),
  'sku-orders measures the invoiced shipping sum using the Billing definition',
);
check(
  skuOrders.includes("then 'billing_mismatch'") &&
    /money_invoiced, 0\) - coalesce\(r\.money_total, 0\)\) > 0\.005/.test(skuOrders),
  'sku-orders reports billing_mismatch when Billing charges more than the eligible labels resolve to',
);
check(
  skuOrders.indexOf("then 'billing_mismatch'") < skuOrders.indexOf("then 'external_label'"),
  'billing_mismatch outranks the shipment-shape states (charged money is not "label voided")',
);
check(
  skuOrders.includes('as shipping_reconciled'),
  'a mismatch row carries the eligible-label figure alongside the invoiced one',
);
check(
  !/attributable and money_(std|exp) > 0/.test(skuOrders),
  'the summary admits class money on the same non-zero rule the rows use (no silent denominator split)',
);
check(
  (skuOrders.match(/attributable and money_(std|exp) <> 0/g) || []).length >= 2,
  'row and average admissibility use the same predicate',
);

// The row-level parity claim that was false for multi-SKU orders must not
// return. Checking that the CORRECT phrases are present is not enough — a
// contradictory sentence added elsewhere leaves them intact (that exact mutation
// survived this guard in the Hermes re-audit). Strip the historical retraction,
// then reject affirmative parity language anywhere in what remains.
const matrix = read('docs/source-of-truth-matrix.md');
const matrixClaims = matrix.replace(
  /An earlier draft of this section[\s\S]*?corrected here \(Hermes[^)]*\)\./,
  '',
);
const affirmativeParityClaims = [
  /same number by construction/i,
  /equals the (canonical )?order[- ](detail|shipping|amount)/i,
  /(drawer|row)[^.]{0,60}(equals|equal to|identical to)[^.]{0,40}order[- ]detail/i,
  /row[- ]level (equality|parity)\s+(holds|is guaranteed|applies)/i,
];
const offending = affirmativeParityClaims.filter((re) => re.test(matrixClaims));
check(
  offending.length === 0,
  `the SOT matrix makes no affirmative row-level parity claim (offending patterns: ${offending.length})`,
);
check(
  matrix.includes('proportional allocation') && matrix.includes('claimed row-level equality'),
  'the SOT matrix documents allocation semantics and records the retraction',
);
check(
  matrix.includes('billing_mismatch'),
  'the SOT matrix documents the billing_mismatch state and its two figures',
);

// Prose can drift; the fixture cannot. Scenario 17 is the authoritative proof of
// proportional allocation, so pin its existence rather than relying on wording.
const cp060Suite = read('scripts/integration/client-portal-analysis-cp060.integration.ts');
check(
  cp060Suite.includes('NO single SKU row equals the full order amount'),
  'a DB-backed scenario proves no single SKU row equals the order amount',
);
check(
  cp060Suite.includes('allocations across all SKU rows reconcile to the canonical order amount'),
  'and that the allocations reconcile in aggregate',
);

// Hermes CP-060 second return: a positive-only delta test misses a NEGATIVE
// abnormal line (invoice lower than the label sum, drawer overstating the bill)
// and misses two abnormal lines that cancel. Presence of abnormal lineage must
// classify on its own.
check(
  /money_odd_lines, 0\) > 0/.test(skuOrders),
  'abnormal-lineage presence classifies a mismatch on its own, not only a positive money delta',
);
check(
  cp060Suite.includes('a negative abnormal line is a mismatch too') &&
    cp060Suite.includes('a zero net delta does not make abnormal lineage acceptable'),
  'DB-backed scenarios cover the negative and net-cancelling abnormal-line cases',
);
check(
  cp060Suite.includes('pre-billing stays attributed, not mismatch'),
  'and the ordinary pre-billing window is pinned as NOT a mismatch',
);
check(
  cp060Suite.includes('the reconciliation figure is money too, and is redacted'),
  'and a billing_mismatch row is proven redacted without financial permission',
);
check(
  !/unattributed|money_attributed|partial_unattributed/.test(skuOrders),
  'sku-orders carries no residual/unattributed money vocabulary',
);
check(
  /money_total is null\s*then 'pending'/.test(skuOrders) && !/then 'unbilled'/.test(skuOrders),
  "sku-orders reports 'pending' (not 'unbilled') when the resolver has no answer yet",
);

// The eligibility rule decides which shipments carry customer money. Exactly one
// definition, same discipline as EXPEDITED_SERVICES above — a copy in the drawer
// would silently keep the old rule if PS-4xx adds an exclusion upstream.
const eligibilityFiles = walk('src').filter((file) =>
  /coalesce\([^)]*isReturn[^)]*\)\s*=\s*false/.test(stripComments(read(file))),
);
check(
  eligibilityFiles.length === 1 &&
    eligibilityFiles[0].split('\\').join('/') === 'src/lib/client-portal/customer-shipping-rate.ts',
  `exactly one customer-shipping eligibility predicate, in customer-shipping-rate.ts (found: ${eligibilityFiles.join(', ') || 'none'})`,
);

// The contract's money-state vocabulary must match the read model's exactly.
const analysisContract = stripComments(read('src/lib/client-portal/contracts/analysis.ts'));
for (const state of ['attributed', 'billing_mismatch', 'pending', 'external_label', 'voided_only']) {
  check(analysisContract.includes(`'${state}'`), `contract declares the ${state} money state`);
}
check(
  !/partial_unattributed|unattributed_legacy|'unbilled'/.test(analysisContract),
  'contract retires the residual money states',
);
check(
  skuOrders.includes('shipping_money_state'),
  'sku-orders emits an explicit shipping_money_state',
);

// 4. The analysis route consumes the shared list.
const analysisRoute = stripComments(read('src/routes/analysis.ts'));
check(
  analysisRoute.includes("from '../lib/shipping-class'"),
  'routes/analysis.ts consumes the shared classification list',
);

// 5. Contract shape.
const contract = stripComments(read('src/lib/client-portal/contracts/analysis.ts'));
for (const field of ['shippingMoneyState', 'shippingStandard', 'shippingExpedited', 'shippingTotal', 'avgShippingStandard', 'avgShippingExpedited']) {
  check(contract.includes(field), `contract exposes ${field}`);
}
for (const retired of ['shippingCharge', 'avgShippingCharge']) {
  check(!contract.includes(retired), `contract no longer exposes retired ${retired}`);
}

// 6. Route DTO mapping.
const portalRoute = stripComments(read('src/routes/client-portal/analysis.ts'));
check(
  portalRoute.includes('shipping_money_state'),
  'portal analysis route maps shipping_money_state into the DTO',
);
check(
  !portalRoute.includes('standard_shipping_cost'),
  'portal analysis route no longer reads the retired std-only source column',
);

if (failures > 0) {
  console.error(`\n✖ CP-060 guard: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\nPASS CP-060 per-shipment shipping classification guard');
