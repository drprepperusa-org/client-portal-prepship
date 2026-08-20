// PS-437 boundary guard: exact selected cost goes to the shared row, PrepShip
// freezes the tuple, and Client Portal stores/renders only the safe amount.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFrozenCustomerShippingMoney } from '../src/lib/customer-shipping-money-snapshot';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const service = read('src/services/returns.ts');
const adapter = read('src/services/prepship-customer-shipping-money.ts');
const action = read('src/routes/client-portal/returns/actions.ts');
// CP-059A deleted src/services/billing.ts along with the portal's billing writer,
// so `read('src/services/billing.ts')` would now throw before a single assertion
// ran. The two assertions that used it are re-anchored at the bottom of this file.
// These are the surviving files that inherited the retired writer's readable half —
// the places a second return-pricing owner could plausibly grow back.
const readSupport = read('src/services/billing-read-support.ts');
const summaries = read('src/services/billing-summaries.ts');
const sqlProjection = read('src/lib/client-portal/customer-shipping-rate.ts');
const matrix = read('docs/source-of-truth-matrix.md');
const safeResponseType = adapter.slice(
  adapter.indexOf('export type CustomerSafeShippingMoney'),
  adapter.indexOf('export type CustomerSafeShippingMoney') + 360,
);

const valid = readFrozenCustomerShippingMoney({
  selectedRateCost: 5.7,
  cShippingRateAmount: 6.77,
  shippingMarginAmount: 1.07,
  shippingMarginPct: 15.8,
  customerRateSource: 'hugrab_shipping_rate_override',
  rateCostSource: 'label_final_cost',
  customerShippingMoneyPolicyVersion: 'ps-437-v1',
});
assert.equal(valid?.cShippingRateAmount, 6.77);
assert.equal(readFrozenCustomerShippingMoney({ selectedRateCost: 5.7 }), null,
  'partial tuples fail closed');
assert.equal(readFrozenCustomerShippingMoney({ ...valid, shippingMarginPct: 'invalid' }), null,
  'malformed optional percentages fail closed');
assert.equal(readFrozenCustomerShippingMoney({
  ...valid,
  shippingMarginAmount: 9,
}), null, 'inconsistent margin tuples fail closed');
assert.equal(readFrozenCustomerShippingMoney({
  ...valid,
  customerRateSource: 'house_next_best_customer_rate',
  customerShippingMoneyPolicyVersion: 'ps-508-v1',
  billingDescriptionSuffix: ' (house rate)',
}), null, 'the return/replacement reader does not opt into ps-508 outbound tuples');
assert.equal(readFrozenCustomerShippingMoney({
  ...valid,
  customerRateSource: 'carrier_markup_customer_shipping_rate',
  rateCostSource: 'shipstation_sync_receipt_cost',
  customerShippingMoneyPolicyVersion: 'ps-509-v1',
  customerShippingMoneyCaptureSource: 'shipstation_sync_ingestion',
}), null, 'the return/replacement reader does not opt into ps-509 sync-ingress tuples');

assert.match(service, /selectedRateCost:\s*costStr/,
  'return shipment persists exact provider total');
assert.match(service, /freezePrepShipCustomerShippingMoney\(/,
  'return workflow delegates the freeze to PrepShip');
assert.match(service, /returnCustomerShippingRate:\s*returnCustomerShippingRate\.toFixed\(2\)/,
  'safe amount is copied into the compatibility alias');
assert.match(action, /authorization:\s*c\.req\.header\('authorization'\)/,
  'portal bearer scope is forwarded to PrepShip');
assert.match(adapter, /customerShippingMoneyPolicyVersion/,
  'safe response retains policy provenance');
assert.match(adapter, /policyVersion !== 'ps-437-v1'/,
  'the cross-app boundary rejects unknown policy versions');
assert.doesNotMatch(safeResponseType, /selectedRateCost|shippingMargin/,
  'cross-app response excludes internal cost and margin');
assert.match(sqlProjection, /cShippingRateAmount/);
assert.doesNotMatch(sqlProjection, /billingConfig|orderOverrides/);
assert.match(matrix, /customerShippingMoneyPolicyVersion='ps-437-v1'/);
assert.match(matrix, /exposes or bills the compatibility alias only when it agrees to the cent/);

// ── CP-059A: PS-437's WRITE-side return-money assertions moved to PrepShip ────
//
// Two assertions here used to read src/services/billing.ts, which owned
// generateLineItems() — a second, independent generator that deleted and rebuilt
// billing_line_items for a period. That file is DELETED, so both had no file to read.
//
// RETIRED — `assert.match(billing, /canonical customer snapshot missing/)`.
// That string was the GENERATOR's warn-and-skip branch: when a return shipment had no
// canonical customer snapshot, the writer emitted no return_postage line and logged it
// for reconciliation rather than pricing the line from raw cost. Deciding what a
// return_postage line is WORTH is money policy, and money policy left this repo with
// the writer. PrepShip (repo prepship-v4) now owns billing_line_items generation and
// return money policy, and pins the skip-instead-of-recalculate rule on its side.
// Asserting it here would only prove the portal still describes someone else's rule.
//
// RETIRED — `assert.doesNotMatch(billing, /resolveReturnPostageRate|returnPostageMarkup
// |returnShippingRateOverride/)`. That banned the generator from becoming a second
// pricing owner by re-deriving return money from the billing-config markup/override
// columns. The ban is not weakened by removal: with no generator in the portal at all,
// RETIREMENT is strictly stronger than the ban it replaces, because a generator that
// merely avoids those three identifiers is still a second authority over one money
// table. (The columns themselves survive in src/db/schema/billing.ts — the portal still
// has to describe the table PrepShip writes — so the ban is repointed at code, not
// schema.)
//
// Replaced by (a) the structural retirement, (b) the same ban repointed at the files
// that inherited the retired writer's code, and (c) the half of the rule that is still
// genuinely the portal's: it must refuse to SURFACE return money it cannot prove.

// (a) There is no services/billing.ts for a return-pricing owner to be re-added to.
assert.equal(fs.existsSync(path.join(root, 'src/services/billing.ts')), false,
  'the portal retains no local billing generator to own return money policy');

// (b) The retired writer's shared read helpers were extracted verbatim into
// billing-read-support.ts, and billing-summaries.ts consumes them. Those two files are
// the plausible regrowth site for a second pricing owner, so the original ban follows
// the code rather than dying with the file it was written against.
for (const [name, source] of [
  ['src/services/billing-read-support.ts', readSupport],
  ['src/services/billing-summaries.ts', summaries],
] as const) {
  assert.doesNotMatch(
    source,
    /resolveReturnPostageRate|returnPostageMarkup|returnShippingRateOverride/,
    `${name} inherited the retired writer's code and must not price return postage`,
  );
}

// (c) The portal-side half of the retired snapshot rule STILL EXISTS and stays pinned,
// at its real home. customerSafeBillingLineSql is the read-path successor to the
// generator's warn-and-skip: a historical return_postage row reaches a customer only
// when the return alias and the shipment's frozen tuple prove the same amount to the
// cent — otherwise it is withheld as reconciliation work, never re-derived from cost.
assert.match(sqlProjection, /coalesce\(\$\{input\.lineType\}, ''\) <> 'return_postage'/,
  'unproven return_postage lines are withheld, not recalculated');
// A gate no read model calls protects nothing, so the consumer is asserted too.
assert.match(summaries, /import \{ customerSafeBillingLineSql \} from/,
  'billing summaries import the customer-safe return_postage gate');
assert.match(summaries, /and \$\{customerSafeSummaryLine\}/,
  'the billing summary read model applies the gate to its billing_line_items join');
assert.match(summaries, /and \$\{customerSafeUnaliasedSummaryLine\}/,
  'the unaliased summary query applies the gate too');

console.log('PS-437 Client Portal unified shipping money guard passed.');
