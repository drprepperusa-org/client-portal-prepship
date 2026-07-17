// PS-366/PS-437 cutover guard: HUGRAB and every other customer override are
// decided by PrepShip. Client Portal receives only the frozen customer amount.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const adapter = read('src/services/prepship-customer-shipping-money.ts');
const returnsService = read('src/services/returns.ts');
const billing = read('src/services/billing.ts');
const safeResponseType = adapter.slice(
  adapter.indexOf('export type CustomerSafeShippingMoney'),
  adapter.indexOf('export type CustomerSafeShippingMoney') + 360,
);

assert.match(adapter, /\/client-portal\/customer-shipping-money\/freeze/,
  'return workflow calls the scoped PrepShip freeze boundary');
assert.match(adapter, /cShippingRateAmount/,
  'adapter accepts the customer-safe amount');
assert.doesNotMatch(safeResponseType, /selectedRateCost|shippingMarginAmount|shippingMarginPct/,
  'adapter response cannot receive internal cost or margin');
assert.match(returnsService, /freezePrepShipCustomerShippingMoney\(/,
  'return label creation delegates pricing to PrepShip');
assert.doesNotMatch(returnsService, /resolveReturnPostageRate|resolveReturnCustomerPrice|computeCustomerReturnPrice/,
  'return service owns no local pricing formula');
assert.doesNotMatch(billing, /shippingRateOverrideTriggerBelow|shippingRateOverrideAmount/,
  'Client Portal billing owns no outbound override policy');

console.log('PS-366/PS-437 override delegation guard passed.');
