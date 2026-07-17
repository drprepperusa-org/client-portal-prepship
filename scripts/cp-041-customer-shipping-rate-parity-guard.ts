// CP-041/PS-437 retirement guard: Client Portal no longer mirrors PrepShip's
// customer-shipping formula. It may read only a frozen, policy-versioned tuple.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

const billing = read('src/services/billing.ts');
const projection = read('src/lib/client-portal/customer-shipping-rate.ts');
const snapshot = read('src/lib/customer-shipping-money-snapshot.ts');

assert.equal(exists('src/services/customer-shipping-rate.ts'), false,
  'the duplicate Client Portal pricing owner must stay deleted');
assert.match(billing, /readFrozenCustomerShippingMoney\(s\.selectedRateJson\)/,
  'legacy billing consumes PrepShip frozen money');
assert.doesNotMatch(billing, /computeCustomerShippingRate|resolveCustomerShippingRate|resolveReturnPostageRate/,
  'billing must not calculate customer shipping money');
assert.match(projection, /shipments\.selectedRateJson/,
  'portal SQL reads the shared shipment snapshot');
assert.doesNotMatch(projection, /billingConfig|orderOverrides|shippingMarkup|overrideAmount/,
  'portal SQL has no pricing-policy mirror');
assert.match(snapshot, /customerShippingMoneyPolicyVersion/,
  'snapshot reader requires explicit policy provenance');
assert.doesNotMatch(snapshot, /\b(?:labelCost|otherCost|shipmentCost|houseCost|rawCost)\b/,
  'snapshot reader never promotes raw or legacy shipment-cost aliases');

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert.equal(
  pkg.scripts?.['test:cp-041-customer-shipping-rate-parity'],
  'tsx scripts/cp-041-customer-shipping-rate-parity-guard.ts',
);

console.log('CP-041/PS-437 source-of-truth cutover guard passed.');
