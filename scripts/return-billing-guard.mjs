// CP-031 — Return postage + return processing fee must flow through the Billing
// SOT. Statically pins the generator, the billing_config schema, the migration,
// and the summary byType breakdown so return billing can't silently drift or
// regress. Modeled on client-portal-billing-totals-guard.mjs and
// billing-client-store-scope-guard.mjs. STATIC ONLY — no db / live / generation.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

let failed = false;
function assert(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`);
  } else {
    console.error(`FAIL ${message}`);
    failed = true;
  }
}

const billing = read('src/services/billing.ts');
const billingFlat = flat(billing);
const summaries = read('src/services/billing-summaries.ts');
const summariesFlat = flat(summaries);
const reporting = read('src/services/reporting-metrics.ts');
const reportingFlat = flat(reporting);
const schema = read('src/db/schema/billing.ts');
const pkg = JSON.parse(read('package.json'));

// ── 1) billing_config carries the additive return billing fields ────────────
assert(
  schema.includes("returnProcessingFee: numeric('return_processing_fee'"),
  'billing_config.returnProcessingFee (return_processing_fee) column exists',
);
assert(
  schema.includes("returnPostageMarkupPct: numeric('return_postage_markup_pct'") &&
    schema.includes("returnPostageMarkupFlat: numeric('return_postage_markup_flat'"),
  'billing_config carries an explicit RETURN postage markup (pct + flat), separate from outbound shipping markup',
);
assert(
  schema.includes("returnShippingRateOverrideTriggerBelow: numeric('return_shipping_rate_override_trigger_below'") &&
    schema.includes("returnShippingRateOverrideAmount: numeric('return_shipping_rate_override_amount'"),
  'billing_config carries the return-specific min-price hook config (trigger + amount)',
);

// ── 2) Migration is additive-only (ADD COLUMN on billing_config; the summary
//       read-model columns are additive IF NOT EXISTS). No DROP / no rewrite. ──
const migration = read('drizzle/0022_return_billing_config.sql');
assert(
  migration.includes('ALTER TABLE "billing_config" ADD COLUMN "return_processing_fee"') &&
    migration.includes('ALTER TABLE "billing_config" ADD COLUMN "return_postage_markup_pct"') &&
    migration.includes('ALTER TABLE "billing_config" ADD COLUMN "return_shipping_rate_override_trigger_below"'),
  'migration adds the return billing_config columns (ADD COLUMN only)',
);
assert(
  !/\bDROP\b/i.test(migration) && !/\bALTER COLUMN\b/i.test(migration),
  'migration is additive-only — no DROP / no ALTER COLUMN (no destructive change to existing billing semantics)',
);
// Every ALTER TABLE in the migration targets billing_config or the additive
// billing_summary_metrics read-model columns — nothing else is touched.
{
  const alteredTables = [...migration.matchAll(/ALTER TABLE "([^"]+)"/g)].map((m) => m[1]);
  const allowed = new Set(['billing_config', 'billing_summary_metrics']);
  assert(
    alteredTables.length > 0 && alteredTables.every((t) => allowed.has(t)),
    'migration only touches billing_config + billing_summary_metrics (no other tables)',
  );
}

// ── 3) The generator emits return_postage + return_processing_fee for return
//       shipments, with EXPLICIT lineTypes (never the generic `shipping`). ──
assert(
  billing.includes("lineType: 'return_postage'"),
  'generator emits a return_postage line',
);
assert(
  billing.includes("lineType: 'return_processing_fee'"),
  'generator emits a return_processing_fee line',
);
// The return source query selects non-voided return shipments only.
const returnBlockStart = billing.indexOf('CP-031: return postage');
assert(returnBlockStart > 0, 'CP-031 return billing block present in the generator');
// Slice up to the batch-insert comment (end of the return block) so every return
// assertion sees the whole block, not a truncated prefix.
const returnBlockEnd = billing.indexOf('Batch INSERT in chunks of 500', returnBlockStart);
const returnBlock =
  returnBlockStart >= 0
    ? billing.slice(returnBlockStart, returnBlockEnd > returnBlockStart ? returnBlockEnd : returnBlockStart + 6000)
    : '';
const returnBlockFlat = flat(returnBlock);
assert(
  returnBlockFlat.includes('eq(shipments.isReturn, true)'),
  'return source query selects return shipments (shipments.isReturn = true)',
);
assert(
  returnBlockFlat.includes('eq(shipments.voided, false)'),
  'return source query skips voided return labels (voided = false) — voided returns are never billed',
);

// ── 4) return_processing_fee only when configured > 0 ──
assert(
  returnBlockFlat.includes('const processingFee = toNum(cfg.returnProcessingFee);') &&
    returnBlockFlat.includes('if (processingFee > 0)'),
  'return_processing_fee line only emitted when the client config returnProcessingFee > 0',
);

// ── 5) return_postage priced by backend policy w/ a minimum/customer-visible
//       price hook (house cost + return markup, then the min-price override). ──
assert(
  billing.includes('export function resolveReturnPostageRate('),
  'a dedicated return-postage pricing policy (resolveReturnPostageRate) exists',
);
assert(
  returnBlockFlat.includes('const houseCost = (toNum(r.cost) || toNum(r.labelCost)) + toNum(r.otherCost);'),
  'return_postage is priced from the return label HOUSE cost (cost || labelCost, + otherCost)',
);
assert(
  returnBlockFlat.includes('resolveReturnPostageRate({') &&
    returnBlockFlat.includes('markupPct: toNum(cfg.returnPostageMarkupPct)') &&
    returnBlockFlat.includes('markupFlat: toNum(cfg.returnPostageMarkupFlat)'),
  'return_postage applies the RETURN-specific markup (not the outbound shipping markup)',
);
// The min-price hook tests the raw house cost (not the marked-up amount) and
// substitutes the configured override amount below the trigger.
const policyStart = billing.indexOf('export function resolveReturnPostageRate(');
const policyBlock = policyStart >= 0 ? flat(billing.slice(policyStart, policyStart + 1400)) : '';
assert(
  policyBlock.includes('selectedCost: houseCost') && policyBlock.includes('markedUpCost: markedUp'),
  'the min-price hook tests the raw house cost (customer-visible floor), not the marked-up amount',
);
assert(
  returnBlockFlat.includes('const triggerBelow = toNum(cfg.returnShippingRateOverrideTriggerBelow);') &&
    returnBlockFlat.includes('overrideAmount: toNum(cfg.returnShippingRateOverrideAmount)'),
  'the min-price hook reads the return-specific override trigger + amount from config',
);

// ── 6) Idempotency: return lines are collected into `allRows` (the SAME batched
//       INSERT) and their persisted ship_date matches the delete window, so a
//       rerun for the period replaces them cleanly. The block sits AFTER the
//       tenant-scoped DELETE and BEFORE the batch insert. ──
const deleteIdx = billing.indexOf('db.delete(billingLineItems)');
const batchInsertIdx = billing.indexOf('Batch INSERT in chunks of 500');
assert(
  deleteIdx > 0 && returnBlockStart > deleteIdx && batchInsertIdx > returnBlockStart,
  'return lines are generated AFTER the delete window and BEFORE the batch insert (inside the same delete-then-regenerate window)',
);
assert(
  returnBlockFlat.includes('allRows.push({') &&
    !returnBlockFlat.includes('db.insert(billingLineItems)'),
  'return lines join the same batched allRows INSERT (no separate insert path that could dodge the delete window)',
);
assert(
  returnBlockFlat.includes('const labelDate = r.labelShipDate ?? r.shipDate ?? r.orderDate ?? null;'),
  'the return line ship_date falls back through the same coalesce the source query filters on, so a rerun delete always catches it',
);
assert(
  returnBlockFlat.includes('billingOrderScopePredicate(input)'),
  'the return source query applies the SAME CP-019 tenant-scope predicate (billingOrderScopePredicate)',
);
// Return-line descriptions include the return shipment id so multiple returns on
// one order don't collide on the (order_id, line_type, description) unique key.
// The customer-visible copy stays safe and canonical: no internal below-trigger
// / override policy wording can leak into the Billing SOT.
assert(
  returnBlock.includes('description: `Order ${r.orderNumber ?? r.orderId} · return postage · return #${r.shipmentId}`'),
  'return_postage description is customer-safe: Order <orderNumber> · return postage · return #<shipmentId>',
);
assert(
  returnBlock.includes('description: `Order ${r.orderNumber ?? r.orderId} · return processing fee · return #${r.shipmentId}`'),
  'return_processing_fee description is customer-safe: Order <orderNumber> · return processing fee · return #<shipmentId>',
);
assert(
  !/Return postage \(below-\$|description:[\s\S]{0,180}?override/i.test(returnBlock),
  'return billing descriptions do not expose below-trigger / override policy wording',
);
assert(
  billing.includes('return #${r.shipmentId}'),
  'return line descriptions are keyed by the return shipment id (unique per return under the order_id/line_type/description constraint)',
);

// ── 7) Outbound generation + its line types are UNTOUCHED. ──
for (const lt of ['pick_pack', 'additional_unit', 'package_cost', 'shipping', 'storage']) {
  assert(billing.includes(`lineType: '${lt}'`), `outbound lineType '${lt}' still emitted (untouched)`);
}
// Return lines must never reuse the generic outbound `shipping` lineType.
assert(
  !returnBlockFlat.includes("lineType: 'shipping'"),
  'return lines never reuse the outbound `shipping` lineType (no collision with outbound)',
);

// ── 8) Summary byType includes both return line types, reconciled into grand
//       total (grand total = SUM of ALL line types, so returns fold in). ──
// Live-fallback aggregation (billing-summaries.ts).
assert(
  summaries.includes("when b.line_type = 'return_postage' then b.total_cost") &&
    summaries.includes("when b.line_type = 'return_processing_fee' then b.total_cost"),
  'billingSummary live aggregation SUMs return_postage + return_processing_fee',
);
assert(
  summariesFlat.includes('return_postage: returnPostageTotal') &&
    summariesFlat.includes('return_processing_fee: returnProcessingTotal'),
  'billingSummary byType breakdown includes return_postage + return_processing_fee',
);
assert(
  summaries.includes('coalesce(sum(b.total_cost), 0)::text as grand_total'),
  'billingSummary grand_total is SUM(total_cost) over ALL line types — return money reconciles into the grand total (no React math)',
);
// Materialized read-model (reporting-metrics.ts + billing_summary_metrics).
assert(
  reporting.includes("when b.line_type = 'return_postage' then b.total_cost") &&
    reporting.includes("when b.line_type = 'return_processing_fee' then b.total_cost") &&
    reporting.includes('return_postage_total') &&
    reporting.includes('return_processing_total'),
  'billing_summary_metrics refresh materializes return_postage_total + return_processing_total',
);
assert(
  reportingFlat.includes('return_postage: returnPostageTotal') &&
    reportingFlat.includes('return_processing_fee: returnProcessingTotal'),
  'the materialized billing summary read-model surfaces both return line types in byType',
);
assert(
  reporting.includes('coalesce(sum(b.total_cost), 0)::numeric(14, 2) as grand_total'),
  'billing_summary_metrics grand_total still SUMs ALL line types (returns already reconciled in)',
);

// ── 9) Client-facing return lines carry no carrier identity (no carrierCode on
//       the return line rows themselves). ──
assert(
  !/lineType: 'return_(postage|processing_fee)'[\s\S]{0,400}?carrierCode/.test(billing),
  'return line rows carry no carrier identity (carrier/service-free)',
);

// ── 10) package.json exposes the guard next to the other billing guards. ──
assert(
  pkg.scripts?.['test:return-billing'] === 'node scripts/return-billing-guard.mjs',
  'package exposes test:return-billing',
);

if (failed) process.exit(1);
console.log('\nCP-031 return billing guard passed.');
