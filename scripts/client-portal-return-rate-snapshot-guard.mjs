import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const schema = read('src/db/schema/returns.ts');
const migration = read('drizzle/0044_return_customer_shipping_rate.sql');
const service = read('src/services/returns.ts');
const dto = read('src/routes/client-portal/returns/dto.ts');
const reads = read('src/routes/client-portal/returns/reads.ts');
// CP-059A deleted src/services/billing.ts — the portal's second, independent
// billing writer. This guard read that file at load time, so the delete made the
// whole guard throw ENOENT before a single check ran. It is not replaced by a
// like-for-like file: the writer is gone for good and PrepShip owns generation.
// What survived the delete, and what the final check therefore anchors to, is
// (a) the read helpers extracted verbatim into billing-read-support.ts and
// (b) billing-summaries.ts, the portal's only remaining return-billing surface.
const readSupport = read('src/services/billing-read-support.ts');
const summaries = read('src/services/billing-summaries.ts');

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
// ---------------------------------------------------------------------------
// CP-059A — the GENERATOR half of this guard moved to PrepShip.
//
// The check that stood here read src/services/billing.ts and pinned how
// generateLineItems() PRICED a return line: that it projected the snapshot with
// validatedReturnCustomerShippingRateSql(), that it read the frozen value via
// toNum(r.returnCustomerShippingRate) rather than deriving a new one, that it
// failed closed with 'canonical customer snapshot missing' when the snapshot was
// absent, and that it never fell back to resolveReturnPostageRate().
//
// Every one of those is RETURN MONEY POLICY — a statement about what a writer is
// allowed to put into billing_line_items. CP-059A retired the portal's writer and
// made PrepShip (repo prepship-v4) the sole owner of billing_line_items
// generation and return money policy; the live operator workflow now reaches it
// through the proxy at POST /billing/generate in src/routes/client-portal/billing.ts.
// So the four rules above are still enforced — in PrepShip's generator and its
// guards, which is where the code they describe now lives. Re-stating them here
// could only do one of two harmful things: read a file that no longer exists, or
// tempt someone to satisfy the guard by re-implementing return pricing locally,
// which is precisely what the retirement exists to prevent.
//
// The coverage is not dropped, it is re-aimed at the portal-side obligations that
// outlive the writer. Those are real code in this repo and are asserted below:
// the writer is structurally gone, the file that inherited its helpers cannot
// become a writer, and the surviving return-billing read reports persisted money
// instead of deciding any.
// ---------------------------------------------------------------------------

check(
  'the portal retains no local billing generator to price a return line (policy moved to PrepShip)',
  !fs.existsSync('src/services/billing.ts'),
);

// The extracted helpers are the one place a generator could plausibly regrow,
// since they are literally the retired writer's own read helpers. Pinning that
// this file cannot reach the database at all keeps the retirement structural
// rather than a naming convention.
check(
  'the extracted read support carries billing.ts read helpers but no return money policy',
  !/from '\.\.\/db\/client'/.test(readSupport) &&
    !/db\.(?:insert|update|delete)\(/.test(readSupport) &&
    !/generateLineItems\s*\(/.test(readSupport) &&
    !/returnCustomerShippingRate/.test(readSupport) &&
    !/resolveReturnPostageRate|resolveReturnCustomerPrice|computeCustomerReturnPrice/.test(readSupport),
);

// The "consumes only the tuple-validated alias, never a locally derived rate"
// rule DOES still bind the portal — its subject just changed from the generator
// to the read model that replaced it. billing-summaries.ts is the portal's only
// remaining return-billing surface, it goes through the same customer-safe
// projection module that exports validatedReturnCustomerShippingRateSql, and it
// consumes toNum from its new home in billing-read-support.ts (the helper moved
// with the extraction; the call site moved from snapshot math to persisted
// totals). It reports return money by summing PERSISTED return_postage /
// return_processing_fee rows, so the portal never re-derives a return rate.
check(
  'the surviving return-billing read totals persisted line money and derives no rate',
  /import \{ customerSafeBillingLineSql \} from '\.\.\/lib\/client-portal\/customer-shipping-rate'/.test(summaries) &&
    /import \{[^}]*\btoNum\b[^}]*\} from '\.\/billing-read-support'/.test(summaries) &&
    // CP-059: summed by the shared registry now, so the legacy aliases and the bare
    // 'return' line cannot drop out of the bucket while their money stays in grand_total.
    /lower\(b\.line_type\) in \(\$\{returnPostageLineTypes\}\)[\s\S]{0,60}b\.total_cost/.test(summaries) &&
    /lower\(b\.line_type\) in \(\$\{returnProcessingLineTypes\}\)[\s\S]{0,60}b\.total_cost/.test(summaries) &&
    /const returnPostageTotal = toNum\(r\.return_postage_total\)/.test(summaries) &&
    !/returnCustomerShippingRate|return_customer_shipping_rate/.test(summaries) &&
    !/resolveReturnPostageRate|resolveReturnCustomerPrice/.test(summaries),
);

if (failed) process.exit(1);
console.log('\nClient Portal return-rate snapshot guard passed.');
