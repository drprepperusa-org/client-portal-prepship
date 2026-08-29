// CP-041/PS-437 retirement guard: Client Portal no longer mirrors PrepShip's
// customer-shipping formula. It may read only a frozen, policy-versioned tuple.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { orders } from '../src/db/schema/orders';
import { shipments } from '../src/db/schema/shipments';
import {
  customerSafeBillingLineSql,
  orderCustomerShippingRateSql,
  projectedCustomerShippingRateSql,
  shipmentCustomerShippingRateSql,
  validatedReturnCustomerShippingRateSql,
} from '../src/lib/client-portal/customer-shipping-rate';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

/**
 * Comment-stripped view, used by every assertion that scans portal SOURCE for a
 * formula. Both failure directions are real here: the files that retired the
 * pricing mirror describe it at length, so a "must not appear" sweep would trip
 * on a sentence about a deleted helper, and a "must appear" check could be
 * satisfied by a commented-out call.
 *
 * Line comments are removed FIRST. Stripping block comments first lets a `/*`
 * sitting inside a line comment latch onto the next block terminator far below
 * and swallow real code, which is how a source-text guard in this repo once
 * passed against a file it had mostly erased. The `[^:]` guard keeps `https://`
 * from being read as a comment.
 */
function stripComments(source: string): string {
  return source
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every active portal server source. Excludes tests, fixtures and guard scripts. */
function activeServerSources(dir = 'src', acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (fs.statSync(path.join(root, rel)).isDirectory()) {
      if (/node_modules|__tests__|__fixtures__/.test(entry)) continue;
      activeServerSources(rel, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      acc.push(rel);
    }
  }
  return acc;
}

const projection = read('src/lib/client-portal/customer-shipping-rate.ts');
const snapshot = read('src/lib/customer-shipping-money-snapshot.ts');

assert.equal(exists('src/services/customer-shipping-rate.ts'), false,
  'the duplicate Client Portal pricing owner must stay deleted');

// ── CP-059A: the two anchors that read src/services/billing.ts ───────────────
//
// This guard used to open src/services/billing.ts and assert (a) that the
// generator sourced its `shipping` line money from
// readFrozenCustomerShippingMoney(s.selectedRateJson), and (b) that the same
// file never called computeCustomerShippingRate / resolveCustomerShippingRate /
// resolveReturnPostageRate.
//
// (a) pinned GENERATOR behaviour: which number a billing writer stamps onto a
// `shipping` line it is minting. CP-059A deleted that writer — src/services/
// billing.ts is gone, not emptied — so the anchor had no file to read, and the
// rule itself is no longer the portal's to enforce. PrepShip (repo prepship-v4)
// is now the sole owner of billing_line_items generation and of customer
// shipping rate policy, and pins the money source of the shipping line there,
// with the writer. Re-asserting it here would claim authority the portal gave up.
//
// What replaces (a) is the RETIREMENT itself: there is no local generator left
// in the portal that could price a shipping line at all. That is structural, so
// it is asserted structurally.
assert.equal(exists('src/services/billing.ts'), false,
  'CP-059A: the file that owned the portal generator must stay deleted — with no ' +
  'local writer, no portal code can mint customer-shipping money into a billing line');

// (b) is NOT retired. "The portal must not calculate customer shipping money" is
// a portal rule, not a generator rule, and it outlived the file it was written
// against. Anchoring it to one now-deleted file was always the weak part: the
// mirror can be reintroduced in any service or read model. The same identifiers
// are therefore swept across all active portal server code instead of one file —
// wider than before, so the deletion cannot be used to smuggle the formula back
// in next door.
const FORMULA_OWNED_BY_PREPSHIP =
  /computeCustomerShippingRate|resolveCustomerShippingRate|resolveReturnPostageRate/;
for (const file of activeServerSources()) {
  assert.doesNotMatch(stripComments(read(file)), FORMULA_OWNED_BY_PREPSHIP,
    `${file} calculates customer shipping money — that policy belongs to PrepShip`);
}

// The "consume PrepShip's frozen tuple, never derive it" half of anchor (a) still
// has a live portal owner, so it is repointed rather than dropped. The return
// workflow is the remaining place where portal TypeScript reads customer shipping
// money out of a shipment, and it must keep reading the frozen snapshot.
const returnsService = stripComments(read('src/services/returns.ts'));
assert.match(returnsService, /readFrozenCustomerShippingMoney\(shipment\.selectedRateJson\)/,
  'the surviving portal consumer must read PrepShip frozen money, not derive it');
assert.match(returnsService, /from '\.\.\/lib\/customer-shipping-money-snapshot'/,
  'it must reach that money through the validation-only snapshot reader');

assert.match(projection, /shipments\.selectedRateJson/,
  'portal SQL reads the shared shipment snapshot');
assert.doesNotMatch(projection, /billingConfig|orderOverrides|shippingMarkup|overrideAmount/,
  'portal SQL has no pricing-policy mirror');
assert.match(snapshot, /customerShippingMoneyPolicyVersion/,
  'snapshot reader requires explicit policy provenance');
assert.doesNotMatch(snapshot, /\b(?:labelCost|otherCost|shipmentCost|houseCost|rawCost)\b/,
  'snapshot reader never promotes raw or legacy shipment-cost aliases');

// PS-508/PS-509 consumer cutover: compile the SQL, rather than accepting source
// comments as proof, and pin each version to the provenance PrepShip freezes.
const dialect = new PgDialect();
const outboundProjection = dialect.sqlToQuery(projectedCustomerShippingRateSql()).sql;
const returnProjection = dialect.sqlToQuery(validatedReturnCustomerShippingRateSql()).sql;
const returnBillingGate = dialect.sqlToQuery(customerSafeBillingLineSql({
  lineType: sql.raw('bli.line_type'),
  shipmentId: sql.raw('bli.shipment_id'),
  totalCost: sql.raw('bli.total_cost'),
})).sql;
const orderProjection = dialect.sqlToQuery(orderCustomerShippingRateSql()).sql;
const embeddedOrderQuery = drizzle.mock({ casing: 'snake_case' })
  .select({ customerShippingRate: orderCustomerShippingRateSql() })
  .from(orders)
  .toSQL()
  .sql;
const embeddedShipmentQuery = drizzle.mock({ casing: 'snake_case' })
  .select({ customerShippingRate: shipmentCustomerShippingRateSql() })
  .from(shipments)
  .toSQL()
  .sql;
const ps508Contract = new RegExp([
  "customerRateSource' in \\(\\s*",
  "'realized_customer_shipping_rate',\\s*",
  "'hugrab_shipping_rate_override',\\s*",
  "'house_next_best_customer_rate'\\s*\\)",
  "[\\s\\S]*customerShippingMoneyPolicyVersion' = 'ps-508-v1'",
  // Suffix parity with Billing's decision owner (Hermes PS-508 re-audit): a ps-508 tuple
  // without billingDescriptionSuffix is HELD by Billing and must not read as settled here.
  "[\\s\\S]*billingDescriptionSuffix'\\) = 'string'",
  "[\\s\\S]*not \\([\\s\\S]*\\? 'customerShippingMoneyCaptureSource'",
].join(''));
const ps509Contract = new RegExp([
  "customerRateSource' in \\(\\s*",
  "'carrier_markup_customer_shipping_rate',\\s*",
  "'hugrab_shipping_rate_override'\\s*\\)",
  "[\\s\\S]*rateCostSource' = 'shipstation_sync_receipt_cost'",
  "[\\s\\S]*customerShippingMoneyPolicyVersion' = 'ps-509-v1'",
  // Same suffix parity for the sync-ingress lane — the writer always emits it, but the
  // PORTAL contract must fail closed on a malformed tuple exactly as Billing does.
  "[\\s\\S]*billingDescriptionSuffix'\\) = 'string'",
  "[\\s\\S]*\\? 'customerShippingMoneyCaptureSource'",
  "[\\s\\S]*customerShippingMoneyCaptureSource'",
  "[\\s\\S]*= 'shipstation_sync_ingestion'",
].join(''));
const workflowFence = new RegExp([
  'coalesce\\("shipments"\\."isReturn", false\\) = true',
  '[\\s\\S]*ps-437-v1',
  '[\\s\\S]*coalesce\\("shipments"\\."isReturn", false\\) = false',
  '[\\s\\S]*ps-508-v1',
  '[\\s\\S]*ps-509-v1',
].join(''));

// Hermes PS-508 round-3 (P4): the non-return branch must NOT accept ps-437. Its only
// non-return writer is the replacement freeze, whose tables do not exist in production yet,
// so a bare version check would surface suffix-less tuples with no relational lane proof.
// The return arm (before the isReturn=false marker) keeps ps-437 — slice past it first.
{
  const falseMarker = 'coalesce("shipments"."isReturn", false) = false';
  const outboundBranch = outboundProjection.slice(outboundProjection.indexOf(falseMarker));
  assert.ok(outboundBranch.length > 0, 'outbound projection carries the isReturn=false branch');
  assert.doesNotMatch(
    outboundBranch,
    /ps-437-v1/,
    'the non-return branch must not accept ps-437 without relational replacement-lane proof',
  );
}
assert.match(
  outboundProjection,
  ps508Contract,
  'ps-508 requires purchase-path provenance and no sync capture key',
);
assert.match(
  outboundProjection,
  ps509Contract,
  'ps-509 requires sync-ingress formula, receipt-cost, and capture provenance',
);
assert.match(
  outboundProjection,
  workflowFence,
  'return shipments stay ps-437-only while ordinary outbound opts into newer versions',
);

for (const [name, compiled] of [
  ['return display projection', returnProjection],
  ['return billing-line gate', returnBillingGate],
] as const) {
  assert.match(compiled, /customerShippingMoneyPolicyVersion' = 'ps-437-v1'/,
    `${name} retains the return ps-437 contract`);
  assert.doesNotMatch(compiled, /ps-508-v1|ps-509-v1/,
    `${name} must not opt return money into outbound contracts`);
}

assert.match(
  orderProjection,
  /and coalesce\("shipments"\."isReturn", false\) = false/,
  'order-grain customer shipping excludes return postage shipments',
);
assert.match(
  embeddedOrderQuery,
  /where "order_id" = "orders"\."id"/,
  'the order-grain subquery keeps its outer orders.id correlation when embedded',
);
assert.doesNotMatch(
  embeddedOrderQuery,
  /where "order_id" = "id"/,
  'Drizzle must not collapse the correlation into shipment.order_id = shipment.id',
);
assert.match(
  embeddedShipmentQuery,
  /bli\.shipment_id = "shipments"\."id"/,
  'the billing-line subquery keeps its outer shipment correlation when embedded',
);
assert.doesNotMatch(
  embeddedShipmentQuery,
  /bli\.shipment_id = "id"/,
  'Drizzle must not collapse the billing lookup into billing_line.shipment_id = billing_line.id',
);

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert.equal(
  pkg.scripts?.['test:cp-041-customer-shipping-rate-parity'],
  'tsx scripts/cp-041-customer-shipping-rate-parity-guard.ts',
);

console.log('CP-041/PS-437 source-of-truth cutover guard passed.');
