// CP-041 guard: the outbound Customer Shipping Rate formula has one TS owner,
// billing generation consumes it, and the Client Portal SQL projection is an
// explicitly documented mirror of that owner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;

function check(condition: boolean, message: string) {
  if (condition) {
    console.log(`ok: ${message}`);
  } else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const { computeCustomerShippingRate, resolveCustomerShippingRate } = await import(
  '../src/services/customer-shipping-rate'
);

const matrix = [
  {
    name: 'null when no house cost exists',
    input: { houseCost: 0, markupPct: 10, markupFlat: 1 },
    expected: null,
  },
  {
    name: 'null when billing config is inactive',
    input: { houseCost: 6.5, active: false, markupPct: 0, markupFlat: 0 },
    expected: null,
  },
  {
    name: 'house cost plus pct and flat markup',
    input: { houseCost: 10, markupPct: 10, markupFlat: 1 },
    expected: 12,
  },
  {
    name: 'below-trigger override wins from raw house cost',
    input: {
      houseCost: 5.99,
      markupPct: 10,
      markupFlat: 1,
      overrideTriggerBelow: 6,
      overrideAmount: 7.73,
    },
    expected: 7.73,
    overrideApplied: true,
  },
  {
    name: 'reference mode raises non-baseline house cost to best reference rate',
    input: {
      houseCost: 6.5,
      refUspsRate: 8,
      refUpsRate: 9,
      billingMode: 'reference_rate',
      carrierCode: 'fedex',
      markupPct: 0,
      markupFlat: 0,
    },
    expected: 8,
    usedReferenceRate: true,
  },
  {
    name: 'reference mode never discounts below house cost',
    input: {
      houseCost: 10,
      refUspsRate: 6,
      refUpsRate: 7,
      billingMode: 'ss_ref_rate',
      carrierCode: 'fedex',
      markupPct: 0,
      markupFlat: 0,
    },
    expected: 10,
    usedReferenceRate: true,
  },
  {
    name: 'ShipStation baseline carriers ignore reference-rate uplift',
    input: {
      houseCost: 10,
      refUspsRate: 20,
      refUpsRate: 30,
      billingMode: 'reference_rate',
      carrierCode: 'stamps_com',
      markupPct: 0,
      markupFlat: 0,
    },
    expected: 10,
    usedReferenceRate: false,
  },
] as const;

for (const row of matrix) {
  const actual = computeCustomerShippingRate(row.input);
  check(actual.cShippingRate === row.expected, `${row.name}: rate ${String(row.expected)}`);
  if ('overrideApplied' in row) {
    check(actual.overrideApplied === row.overrideApplied, `${row.name}: override flag`);
  }
  if ('usedReferenceRate' in row) {
    check(actual.usedReferenceRate === row.usedReferenceRate, `${row.name}: reference-rate flag`);
  }
}

const override = resolveCustomerShippingRate({
  selectedCost: 5.99,
  markedUpCost: 6.99,
  triggerBelow: 6,
  overrideAmount: 7.73,
});
check(
  override.cShippingRate === 7.73 && override.overrideApplied,
  'legacy below-trigger helper still applies override from selected cost',
);

const billing = read('src/services/billing.ts');
check(
  billing.includes("from './customer-shipping-rate'"),
  'billing.ts imports the shared Customer Shipping Rate owner',
);
check(
  billing.includes('computeCustomerShippingRate({') && billing.includes('houseCost: labelCost'),
  'generateLineItems shipping line consumes computeCustomerShippingRate with the selected house cost',
);
check(
  !billing.includes('let billedCost = labelCost') &&
    !billing.includes('const referenceCandidates = [toNum(s.refUspsRate), toNum(s.refUpsRate)]') &&
    !billing.includes('const shipCost = billedCost *'),
  'generateLineItems no longer owns inline reference-rate/markup shipping math',
);

const projection = read('src/lib/client-portal/customer-shipping-rate.ts');
check(
  projection.includes('SQL mirror of computeCustomerShippingRate') &&
    projection.includes('src/services/customer-shipping-rate.ts'),
  'projectedCustomerShippingRateSql documents the shared TS owner it mirrors',
);

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert.equal(
  pkg.scripts?.['test:cp-041-customer-shipping-rate-parity'],
  'tsx scripts/cp-041-customer-shipping-rate-parity-guard.ts',
  'package.json exposes test:cp-041-customer-shipping-rate-parity',
);
console.log('ok: package.json exposes test:cp-041-customer-shipping-rate-parity');

if (failed) process.exit(1);
console.log('\nCP-041 customer shipping rate parity guard passed.');
