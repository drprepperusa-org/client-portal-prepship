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
const billing = read('src/services/billing.ts');
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
assert.match(billing, /canonical customer snapshot missing/,
  'missing return truth is reconciled instead of recalculated');
assert.doesNotMatch(billing, /resolveReturnPostageRate|returnPostageMarkup|returnShippingRateOverride/,
  'return billing has no second pricing owner');
assert.match(sqlProjection, /cShippingRateAmount/);
assert.doesNotMatch(sqlProjection, /billingConfig|orderOverrides/);
assert.match(matrix, /customerShippingMoneyPolicyVersion='ps-437-v1'/);
assert.match(matrix, /exposes or bills the compatibility alias only when it agrees to the cent/);

console.log('PS-437 Client Portal unified shipping money guard passed.');
