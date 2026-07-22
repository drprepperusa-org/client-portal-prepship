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
  'cheapest-label finalize delegates once and freezes the exact returned rate',
  /const returnCustomerShippingRate = await resolveReturnCustomerRateForShipment\(/.test(service) &&
    /freezePrepShipCustomerShippingMoney\(/.test(service) &&
    /returnCustomerShippingRate:\s*returnCustomerShippingRate\.toFixed\(2\)/.test(service) &&
    /returnCustomerShippingRate,\s*\n\s*trackingNumber: created\.trackingNumber/.test(service),
);
check(
  'snapshot pricing fails closed instead of freezing raw house cost on a policy read error',
  /PrepShip customer shipping money API/.test(read('src/services/prepship-customer-shipping-money.ts')) &&
    !/quoting raw house cost|resolveReturnCustomerPrice/.test(service),
);
check(
  'Client Portal reads only a tuple-validated snapshot and never projects raw shipment cost',
  /row\.validatedReturnCustomerShippingRate/.test(dto) &&
    /validatedReturnCustomerShippingRateSql/.test(reads) &&
    !/resolveReturnCustomerPrice|internalReturnLabelCost/.test(dto) &&
    !/internalReturnLabelCost/.test(reads),
);
check(
  'return billing consumes only the tuple-validated compatibility alias',
  /returnCustomerShippingRate:\s*validatedReturnCustomerShippingRateSql\(\)/.test(billing) &&
    /r\.returnCustomerShippingRate != null[\s\S]{0,120}toNum\(r\.returnCustomerShippingRate\)/.test(billing) &&
    /canonical customer snapshot missing/.test(billing) &&
    !/resolveReturnPostageRate/.test(billing),
);

if (failed) process.exit(1);
console.log('\nClient Portal return-rate snapshot guard passed.');
