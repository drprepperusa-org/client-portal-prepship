import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const schema = read('src/db/schema/returns.ts');
const migration = read('drizzle/0044_return_customer_shipping_rate.sql');
const service = read('src/services/returns.ts');
const dto = read('src/routes/client-portal/returns/dto.ts');
const reads = read('src/routes/client-portal/returns/reads.ts');
const billing = read('src/services/billing.ts');

let failed = false;
function check(message, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failed = true;
}

check(
  'schema owns an intent-named nullable customer return rate snapshot',
  /returnCustomerShippingRate:\s*numeric\('return_customer_shipping_rate',\s*\{ precision: 12, scale: 2 \}\)/.test(schema),
);
check(
  'migration is additive and backfills only missing linked-return snapshots',
  /ADD COLUMN IF NOT EXISTS "return_customer_shipping_rate" numeric\(12, 2\)/.test(migration) &&
    /JOIN shipments s ON s\.id = r\.return_shipment_id/.test(migration) &&
    /r\.return_customer_shipping_rate IS NULL/.test(migration),
);
check(
  'cheapest-label finalize computes once and freezes the exact returned rate',
  /const returnCustomerShippingRate = await resolveReturnCustomerPrice\(rawCost, clientId\)/.test(service) &&
    /returnCustomerShippingRate:\s*returnCustomerShippingRate\.toFixed\(2\)/.test(service) &&
    /returnCustomerShippingRate,\s*\n\s*trackingNumber: created\.trackingNumber/.test(service),
);
check(
  'snapshot pricing fails closed instead of freezing raw house cost on a policy read error',
  /refusing to freeze an unpriced snapshot/.test(service) &&
    !/quoting raw house cost/.test(service),
);
check(
  'Client Portal reads the snapshot directly and never projects raw shipment cost',
  /row\.ret\.returnCustomerShippingRate/.test(dto) &&
    !/resolveReturnCustomerPrice|internalReturnLabelCost/.test(dto) &&
    !/internalReturnLabelCost/.test(reads),
);
check(
  'return billing consumes the same snapshot before its legacy-orphan fallback',
  /returnCustomerShippingRate:\s*returns\.returnCustomerShippingRate/.test(billing) &&
    /r\.returnCustomerShippingRate != null[\s\S]{0,120}toNum\(r\.returnCustomerShippingRate\)/.test(billing),
);

if (failed) process.exit(1);
console.log('\nClient Portal return-rate snapshot guard passed.');
