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

// The expedited list is PrepShip's. This guard must not carry a third copy:
// comparing the repo's copy against the guard's own copy proves only that two
// hand-copies agree (Hermes, CP-060, 2026-08-22). Read the pinned contract,
// which records the upstream repo, path, export and blob SHA it came from.
const CONTRACT = JSON.parse(read('contracts/prepship-reporting-expedited-services.json'));
const CANONICAL_EXPEDITED = CONTRACT.services;

// 1. Shared module holds exactly the canonical list.
const shippingClass = stripComments(read('src/lib/shipping-class.ts'));
check(
  !/EXPEDITED_SERVICES\s*=\s*\[/.test(shippingClass),
  'shipping-class.ts does not hand-copy the list; it reads the pinned contract',
);
check(
  shippingClass.includes('EXPEDITED_SERVICES_CONTRACT_PATH'),
  'shipping-class.ts sources the list from the pinned upstream contract',
);
check(
  Array.isArray(CANONICAL_EXPEDITED) && CANONICAL_EXPEDITED.length === 13,
  `the pinned contract carries the 13 canonical PS-418 services (got ${CANONICAL_EXPEDITED.length})`,
);
check(
  Boolean(CONTRACT.upstream && CONTRACT.upstream.blobSha && CONTRACT.upstream.path),
  'the contract records the upstream blob SHA and path it was pinned from',
);
check(
  String(JSON.parse(read('package.json')).scripts['test:prepship-expedited-parity'] || '').includes(
    'prepship-expedited-parity.mjs',
  ),
  'the cross-repo classification parity gate is registered',
);

// 2. Single definition across src/.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}
const redeclared = walk('src').filter((file) =>
  /EXPEDITED_SERVICES\s*=\s*\[/.test(stripComments(read(file))),
);
check(
  redeclared.length === 0,
  `no file in src/ redeclares the expedited list (found: ${redeclared.join(', ') || 'none'})`,
);

// 3. Both analysis paths consume ONE shipping-analysis definition.
//
// AC-4 requires "the Analysis table and SKU drawer use the same backend
// definitions". Two copies that agree today is not that: CP-060 exists because
// an order-grain sum and a per-shipment split drifted while nobody looked, and
// the Dashboard kept serving the pre-CP-060 model through three further audit
// rounds because the table path was never converged. So the definition lives in
// ONE module and both callers import it. These checks follow that delegation
// rather than pinning a spelling in either consumer.
const shared = stripComments(read('src/lib/client-portal/shipping-analysis-sql.ts'));
const skuOrders = stripComments(read('src/services/sku-orders.ts'));
const analysisRoute = stripComments(read('src/routes/analysis.ts'));

check(
  shared.includes("from '../shipping-class'"),
  'the shared module imports the canonical expedited-service list',
);
check(
  shared.includes('shipmentCustomerShippingRateSql') &&
    shared.includes("from './customer-shipping-rate'"),
  'the shared module takes its money from the canonical per-shipment resolver',
);
check(
  shared.includes('shipmentIsCustomerShippingEligibleSql()'),
  'the shared module selects eligible shipments through the shared predicate',
);

// The reconciliation inputs are BASIS-SPECIFIC and live in the shared switch.
// house_markup is internal marked cost; reconciling it against customer
// invoices manufactures a mismatch out of the ordinary gap between what we pay
// and what we charge. The table used to inject inv.* regardless of basis, so the
// same house-basis order could read attributed in the drawer and
// billing_mismatch in the table (Hermes, CP-060, 2026-08-22). Neither consumer
// may name those inputs itself.
check(
  /export function moneyColumnsSql/.test(shared) &&
    shared.includes('labels.house_money') &&
    /as money_invoiced/.test(shared) &&
    /0::int/.test(shared) &&
    /as money_odd_lines/.test(shared),
  'the shared basis switch neutralises customer reconciliation on the house basis',
);
for (const [name, consumer] of [['drawer', skuOrders], ['table', analysisRoute]]) {
  check(
    consumer.includes('moneyColumnsSql('),
    `the ${name} path takes its money columns from the shared basis switch`,
  );
  check(
    !/inv.invoiced_shipping/.test(consumer) && !/inv.unattached_lines/.test(consumer),
    `the ${name} path does not inject reconciliation inputs outside the basis switch`,
  );
}

// Both consumers, same definition.
for (const [name, consumer] of [['drawer', skuOrders], ['table', analysisRoute]]) {
  check(
    consumer.includes("shipping-analysis-sql"),
    `the ${name} path consumes the shared shipping-analysis definition`,
  );
  check(
    consumer.includes('eligibleShipmentMoneyLateralSql()'),
    `the ${name} path takes its money from the shared per-shipment lateral`,
  );
  check(
    consumer.includes('shippingMoneyStateCaseSql()'),
    `the ${name} path reports the shared money-state vocabulary`,
  );
  check(
    !/from billing_line_items/i.test(consumer),
    `the ${name} path keeps no billing_line_items shipping sum of its own`,
  );
  check(
    !/order by s\.id desc/i.test(consumer),
    `the ${name} path has no newest-label classifier (the pre-CP-060 model)`,
  );
}

// Exactly one definition across src/.
const lateralDefs = walk('src').filter((file) =>
  /export function eligibleShipmentMoneyLateralSql/.test(stripComments(read(file))),
);
check(
  lateralDefs.length === 1 &&
    lateralDefs[0].split('\\').join('/') === 'src/lib/client-portal/shipping-analysis-sql.ts',
  `exactly one per-shipment money lateral, in shipping-analysis-sql.ts (found: ${lateralDefs.join(', ') || 'none'})`,
);

// Money-state semantics, all now owned by the shared module.
check(
  !/unattributed|money_attributed|partial_unattributed/.test(shared + skuOrders + analysisRoute),
  'no residual/unattributed money vocabulary survives in either path',
);
check(
  /money_total is null\s*then 'pending'/.test(shared) && !/then 'unbilled'/.test(shared),
  "the shared module reports 'pending' (not 'unbilled') when the resolver has no answer",
);
check(
  /where b\.order_id = o\.id and b\.line_type = 'shipping'/.test(shared),
  'the shared module measures invoiced shipping using the Billing definition',
);
check(
  shared.includes("then 'billing_mismatch'") &&
    /money_invoiced, 0\) - coalesce\(r\.money_total, 0\)\) > 0\.005/.test(shared),
  'billing_mismatch fires when Billing charges more than the eligible labels resolve to',
);
check(
  /money_odd_lines, 0\) > 0/.test(shared),
  'abnormal-lineage presence classifies a mismatch on its own, not only a positive delta',
);
check(
  shared.indexOf("then 'billing_mismatch'") < shared.indexOf("then 'external_label'"),
  'billing_mismatch outranks the shipment-shape states',
);
check(
  (shared.match(/from billing_line_items/gi) || []).length === 1 &&
    /\) inv on true/.test(shared),
  'the only billing_line_items read is the reconciliation lateral',
);

// Drawer row output.
check(
  skuOrders.includes('as shipping_reconciled'),
  'a drawer mismatch row carries the eligible-label figure alongside the invoiced one',
);
check(
  !/attributable and money_(std|exp) > 0/.test(skuOrders),
  'the drawer summary admits class money on the same non-zero rule the rows use',
);
check(
  (skuOrders.match(/attributable and money_(std|exp) <> 0/g) || []).length >= 2,
  'drawer row and average admissibility use the same predicate',
);
check(
  skuOrders.includes('shipping_money_state'),
  'sku-orders emits an explicit shipping_money_state',
);

// The row-level parity claim that was false for multi-SKU orders must not return.
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
  `the SOT matrix makes no affirmative row-level parity claim (offending: ${offending.length})`,
);
check(
  matrix.includes('proportional allocation') && matrix.includes('claimed row-level equality'),
  'the SOT matrix documents allocation semantics and records the retraction',
);
check(
  matrix.includes('billing_mismatch'),
  'the SOT matrix documents the billing_mismatch state',
);

// Prose drifts; fixtures do not.
const cp060Suite = read('scripts/integration/client-portal-analysis-cp060.integration.ts');
for (const [phrase, what] of [
  ['NO single SKU row equals the full order amount', 'no single SKU row equals the order amount'],
  ['allocations across all SKU rows reconcile to the canonical order amount', 'allocations reconcile in aggregate'],
  ['a negative abnormal line is a mismatch too', 'the negative abnormal-line case'],
  ['a zero net delta does not make abnormal lineage acceptable', 'the net-cancelling case'],
  ['pre-billing stays attributed, not mismatch', 'the pre-billing exemption'],
  ['the reconciliation figure is money too, and is redacted', 'redaction of a mismatch row'],
]) {
  check(cp060Suite.includes(phrase), `a DB-backed scenario pins ${what}`);
}
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
