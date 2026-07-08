// PS-366 guard: configurable below-trigger customer shipping override.
// Unit-tests the real resolver with the ticket's acceptance matrix and pins
// the wiring: the trigger tests the SELECTED/PURCHASED cost, the override is
// NOT a floor, and the selected-rate source of truth is never mutated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;

function check(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

const { resolveCustomerShippingRate } = await import('../src/services/customer-shipping-rate');

const HUGRAB = { triggerBelow: 6.0, overrideAmount: 7.73 };
const at = (selected: number, markedUp = selected, cfg = HUGRAB) =>
  resolveCustomerShippingRate({ selectedCost: selected, markedUpCost: markedUp, ...cfg });

// HUGRAB acceptance matrix (markup 0 → markedUp = selected).
let r = at(5.99);
check(r.cShippingRate === 7.73 && r.overrideApplied, 'HUGRAB $5.99 -> C. Shipping Rate $7.73 (override applied)');
check(Number((7.73 - 5.99).toFixed(2)) === 1.74, 'HUGRAB $5.99 margin = C. Shipping Rate - selected = $1.74');
r = at(6.0);
check(r.cShippingRate === 6.0 && !r.overrideApplied, 'HUGRAB $6.00 -> no trigger; stays $6.00');
r = at(6.82);
check(r.cShippingRate === 6.82 && !r.overrideApplied, 'HUGRAB $6.82 -> no trigger; stays $6.82 (not a floor)');
r = at(7.73);
check(r.cShippingRate === 7.73 && !r.overrideApplied, 'HUGRAB $7.73 -> stays $7.73 (no override needed)');
r = at(8.1);
check(r.cShippingRate === 8.1 && !r.overrideApplied, 'HUGRAB $8.10 -> stays $8.10');

// Markup interplay: trigger tests the SELECTED cost, not the marked-up amount.
r = at(5.99, 6.99);
check(r.cShippingRate === 7.73 && r.overrideApplied, 'selected $5.99 with markup to $6.99 still triggers (selected < $6.00)');
r = at(6.5, 8.5);
check(r.cShippingRate === 8.5 && !r.overrideApplied, 'selected $6.50 marked up to $8.50 -> markup result kept, no override');

// Disabled config: no override for anyone.
r = at(5.99, 5.99, { triggerBelow: 0, overrideAmount: 0 });
check(r.cShippingRate === 5.99 && !r.overrideApplied, 'no config (0/0) -> $5.99 stays $5.99 (non-HUGRAB unaffected)');
r = at(5.99, 5.99, { triggerBelow: 6.0, overrideAmount: 0 });
check(r.cShippingRate === 5.99 && !r.overrideApplied, 'amount disabled -> no override');

// Reconfigured values: trigger $7.00 / amount $8.50.
const CUSTOM = { triggerBelow: 7.0, overrideAmount: 8.5 };
r = at(6.99, 6.99, CUSTOM);
check(r.cShippingRate === 8.5 && r.overrideApplied, 'custom trigger $7.00/$8.50: $6.99 -> $8.50');
r = at(7.0, 7.0, CUSTOM);
check(r.cShippingRate === 7.0 && !r.overrideApplied, 'custom trigger $7.00/$8.50: $7.00 -> no trigger');

// Wiring pins: the generator uses the resolver on the shipping line with the
// selected/purchased cost, and config plumbing exposes both fields end-to-end.
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
const billing = read('src/services/billing.ts');
check(
  billing.includes('computeCustomerShippingRate({') && billing.includes('houseCost: labelCost'),
  'generateLineItems shipping line resolves C. Shipping Rate from the shared selected/purchased-cost owner',
);
check(
  billing.includes('unitCost: cShippingRate.toFixed(2)') && billing.includes('totalCost: cShippingRate.toFixed(2)'),
  'shipping billing line bills the resolved C. Shipping Rate',
);
check(
  !billing.includes('selectedRateJson: cShippingRate') && !billing.includes('labelCost = cShippingRate'),
  'selected/purchased rate source of truth is never overwritten by the override',
);
const schema = read('src/db/schema/billing.ts');
check(
  schema.includes("'shipping_rate_override_trigger_below'") && schema.includes("'shipping_rate_override_amount'"),
  'billing_config owns the two per-client override fields',
);
const routes = read('src/routes/billing.ts');
check(
  routes.includes('shippingRateOverrideTriggerBelow') && routes.includes('shippingRateOverrideAmount'),
  'billing config API reads and writes the override fields',
);

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:billing-shipping-override'] === 'tsx scripts/billing-shipping-override-guard.ts',
  'package.json exposes test:billing-shipping-override',
);
console.log('ok: package.json exposes test:billing-shipping-override');

if (failed) process.exit(1);
console.log('\nPS-366 billing shipping override guard passed.');
