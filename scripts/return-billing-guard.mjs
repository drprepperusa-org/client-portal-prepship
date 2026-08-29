// CP-031 — Return postage + return processing fee must flow through the Billing
// SOT. Statically pins the billing_config schema, the additive migration, the
// portal's return-aware READ models, and the customer-safety gate that keeps
// unverified return_postage money off customer surfaces — so return billing
// can't silently drift or regress. STATIC ONLY — no db / live / generation.
//
// ── RE-ANCHORED BY CP-059A ───────────────────────────────────────────────────
// This guard used to open src/services/billing.ts and assert what the PORTAL'S
// OWN generator emitted. CP-059A retired that writer and DELETED the file, so
// those assertions had no file to read: the guard threw at its first read(),
// before a single check ran. It did not "start failing" — it stopped executing.
//
// The generator rules it pinned did not disappear, they CHANGED OWNER. PrepShip
// (repo prepship-v4) is now the sole owner of billing_line_items generation, the
// return money policy and the customer shipping rate policy, and pins these
// there:
//   • emitting return_postage / return_processing_fee lines at all
//   • the return source filter (isReturn = true, voided = false)
//   • the "only when returnProcessingFee > 0" gate
//   • return postage markup + the return below-trigger override math
//   • the delete-then-regenerate window, the batched allRows INSERT, and the
//     ship_date coalesce that makes a rerun idempotent
//   • the generator's own tenant-scope predicate (billingOrderScopePredicate)
//   • the return line descriptions and the carrier-free shape of the written row
//
// None of those can be honestly asserted against this repository any more, and
// re-stating them here against a file PrepShip owns would be a guard that lies.
// They are replaced by §3, whose retirement checks prove the strongest claim
// this repo can still make: the portal cannot generate return billing at all.
// Every rule that is still the PORTAL's — the schema/migration contract, the
// read models, the customer-safety gate, the read-path tenant scope — is kept
// and pointed at the file that actually owns it today.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
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

/**
 * Comment-stripped view, used by every §3 retirement scan.
 *
 * Retirement checks are "this does not exist" checks, and they cut both ways:
 * prose describing the retired generator must never SATISFY one, and prose
 * quoting the retired generator (this file's own subject matter is quoted all
 * over src/ comments) must never FAIL one.
 *
 * Order matters, and the obvious order is wrong — stripping block comments first
 * lets a `/*` living inside a LINE comment swallow the code below it. Line
 * comments go first; the `[^:]` guard keeps `https://` from reading as one.
 * (Same lesson, same reason, as ps-cp-059a-writer-retirement-guard.ts.)
 */
function stripComments(source) {
  return source
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every active server source file. Excludes tests, fixtures and guard scripts. */
function activeServerSources(dir = path.join(root, 'src'), acc = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      if (/node_modules|__tests__|__fixtures__/.test(entry)) continue;
      activeServerSources(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      acc.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return acc;
}

const ACTIVE_SOURCES = activeServerSources().map((rel) => [rel, stripComments(read(rel))]);
const offenders = (pattern) => ACTIVE_SOURCES.filter(([, code]) => pattern.test(code)).map(([rel]) => rel);

const summaries = read('src/services/billing-summaries.ts');
const summariesFlat = flat(summaries);
const reporting = read('src/services/reporting-metrics.ts');
const reportingFlat = flat(reporting);
const schema = read('src/db/schema/billing.ts');
const readSupport = read('src/services/billing-read-support.ts');
const customerShippingRate = read('src/lib/client-portal/customer-shipping-rate.ts');
const pkg = JSON.parse(read('package.json'));

// ── 1) billing_config carries the additive return billing fields ────────────
// KEPT AS-IS. These columns are a DATABASE CONTRACT, not generator behaviour:
// PrepShip and the portal share one database, and this drizzle schema is how the
// portal's migrations define billing_config. Dropping the columns here would
// break the table PrepShip's generator reads, so the contract is still this
// repo's to hold. §3 asserts the flip side — the portal declares these columns
// but consumes none of them, because the pricing decisions they feed left.
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
// KEPT AS-IS. A migration already applied to production is history; the writer
// moving to PrepShip does not make this repo's migration ledger someone else's.
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

// ── 3) RETIREMENT — the portal generates no return billing ──────────────────
// REPLACES the old §3–§7 and §9 generator assertions (return line emission, the
// isReturn/voided source filter, the processingFee>0 gate, the frozen-rate read
// inside the generator, the delete-then-regenerate window, allRows batching, the
// ship_date coalesce, the generator's tenant-scope predicate, the return line
// descriptions, and the carrier-free written row shape). Those rules moved to
// PrepShip (repo prepship-v4) with the writer and are pinned there.
//
// The portal's remaining obligation is negative and structural: it must be
// unable to become a second authority on return money. That is what is asserted
// here, and unlike the old assertions it survives any refactor PrepShip makes.
assert(
  !exists('src/services/billing.ts'),
  'the portal retains no local billing generator — src/services/billing.ts is deleted, not stubbed (return line generation lives in PrepShip)',
);
{
  const hits = offenders(/\bgenerateLineItems\b/);
  assert(
    hits.length === 0,
    `no active portal source defines, imports or calls generateLineItems${hits.length ? ` (found: ${hits.join(', ')})` : ''}`,
  );
}
{
  // The precise CP-031 retirement statement: no portal code CONSTRUCTS a return
  // billing row. If a generator ever comes back it must mint these line types,
  // so this catches reintroduction even under a new function name.
  const hits = offenders(/lineType:\s*['"]return_(postage|processing_fee)['"]/);
  assert(
    hits.length === 0,
    `no active portal source emits a return_postage / return_processing_fee line${hits.length ? ` (found: ${hits.join(', ')})` : ''}`,
  );
}
{
  // Insert/update only. The one surviving billing_line_items DELETE is the
  // isTest purge in src/routes/admin.ts, classified and constrained by
  // ps-cp-059a-writer-retirement-guard.ts; it creates no billing money and is
  // deliberately not re-litigated here.
  const orm = offenders(/(?:db|tx|trx)\s*\.\s*(?:insert|update)\s*\(\s*billingLineItems\s*\)/);
  const raw = offenders(/(?:insert\s+into|update)\s+(?:public\.)?billing_line_items/i);
  const hits = [...new Set([...orm, ...raw])];
  assert(
    hits.length === 0,
    `no active portal source inserts or updates billing_line_items — PrepShip writes every billing row${hits.length ? ` (found: ${hits.join(', ')})` : ''}`,
  );
}
{
  // The return money POLICY inputs (§1's columns) must be declared and unread.
  // src/db/schema/billing.ts is the column DECLARATION — the DB contract this
  // repo still owns — so it is the one allowed mention. Any other reader would
  // mean the portal had started deciding return pricing again, which is the
  // exact defect the markup/override assertions used to catch inside the
  // generator.
  const policyConfig =
    /\breturn(?:ProcessingFee|PostageMarkupPct|PostageMarkupFlat|ShippingRateOverrideTriggerBelow|ShippingRateOverrideAmount)\b|return_postage_markup_(?:pct|flat)|return_shipping_rate_override_(?:trigger_below|amount)/;
  const hits = offenders(policyConfig).filter((rel) => rel !== 'src/db/schema/billing.ts');
  assert(
    hits.length === 0,
    `the return money policy config is declared but never consumed by portal code — markup / below-trigger override decisions belong to PrepShip${hits.length ? ` (found: ${hits.join(', ')})` : ''}`,
  );
}

// ── 4) The customer-safety rule on return_postage — REPOINTED from the
//       generator to the READ path, where it still lives in this repo. ────────
// The old assertions checked that the generator read PrepShip's frozen
// customer-safe amount instead of deriving postage from house cost or local
// config. The generator is gone, but the PORTAL half of that rule is not: it
// still RENDERS historical return_postage rows, and it must refuse to show any
// whose amount is not provably PrepShip's frozen, policy-versioned money. That
// gate is src/lib/client-portal/customer-shipping-rate.ts, so that is where
// these assertions now point.
// CP-059: repointed from the SPELLING to the DELEGATION. This used to pin the literal
// `<> 'return_postage'`, which meant the gate covered only the modern spelling — the
// producer also emits the legacy `return_label` alias as return postage, so an
// unvalidated legacy line reached customer money without the tuple check its modern
// equivalent has to pass. The gate now reads the shared registry, and this asserts
// that delegation plus the registry's coverage, which is strictly stronger than the
// old literal: it cannot be satisfied by gating one spelling and leaking another.
assert(
  /export function customerSafeBillingLineSql\(/.test(customerShippingRate) &&
    /not \(\$\{isReturnPostageLineTypeSql\(input\.lineType\)\}\)/.test(
      customerShippingRate,
    ) &&
    /isReturnPostageLineTypeSql/.test(customerShippingRate),
  'the customer-safety gate covers every return-postage spelling via the shared registry',
);
assert(
  customerShippingRate.includes("'customerShippingMoneyPolicyVersion' = 'ps-437-v1'") &&
    /round\(\$\{input\.totalCost\}::numeric, 2\)\s*=\s*round\(\$\{frozenCustomerShippingAmountSql\(\)\}, 2\)/.test(
      flat(customerShippingRate).replace(/\s+/g, ' '),
    ),
  'a return_postage line is customer-safe only when PrepShip\'s policy-versioned tuple exists AND the billed amount matches that frozen amount to the cent',
);
assert(
  /export function validatedReturnCustomerShippingRateSql\(/.test(customerShippingRate),
  'the validated return customer-rate projection (PrepShip frozen truth, never house cost) still exists for the return surfaces',
);
assert(
  summaries.includes("import { customerSafeBillingLineSql }") &&
    summariesFlat.includes('and ${customerSafeUnaliasedSummaryLine}') &&
    summariesFlat.includes('and ${customerSafeSummaryLine}'),
  'billingSummary applies the customer-safety gate to BOTH its has-rows probe and its aggregation join',
);
assert(
  reporting.includes('customerSafeBillingLineSql') &&
    reportingFlat.includes('unsafe_return_postage as (') &&
    reportingFlat.includes('and not ${customerSafeMetricsLine}') &&
    reportingFlat.includes('u.client_id is null'),
  'the materialized read-model withholds a client\'s cached metrics while ANY unverified return_postage row is in the window',
);
{
  // The generator owned the "never derive customer postage locally" rule; with
  // it gone, the rule becomes portal-wide — no file may reintroduce a local
  // return-postage pricing owner under any name.
  const hits = offenders(/resolveReturnPostageRate|resolveReturnCustomerPrice|computeCustomerReturnPrice/);
  assert(
    hits.length === 0,
    `the duplicate return-postage pricing owner stays deleted portal-wide${hits.length ? ` (found: ${hits.join(', ')})` : ''}`,
  );
}

// ── 5) CP-019 tenant scope on return billing — REPOINTED from the generator's
//       source query to the read models that now do the scoping. ─────────────
// The retired return source query applied billingOrderScopePredicate. That
// helper lived in the deleted billing.ts and went with it. The tenant-scope
// obligation did not go anywhere: return rows are still read back per tenant,
// through the predicates extracted VERBATIM into billing-read-support.ts.
assert(
  /export function billingLineItemScopePredicate\(/.test(readSupport) &&
    /export function billingClientScopePredicate\(/.test(readSupport),
  'the billing scope predicates survive the writer retirement in src/services/billing-read-support.ts',
);
assert(
  summaries.includes("} from './billing-read-support';") &&
    (summaries.match(/billingLineItemScopePredicate\(input\)/g) ?? []).length >= 2 &&
    (summaries.match(/billingClientScopePredicate\(input\)/g) ?? []).length >= 2,
  'every billing read path (has-rows probe, summary aggregation, zero-volume client list, line detail) is tenant-scoped',
);
{
  const hits = offenders(/\bbillingOrderScopePredicate\b/);
  assert(
    hits.length === 0,
    `the generator-only order-scope predicate left with the writer — no active portal source resurrects it${hits.length ? ` (found: ${hits.join(', ')})` : ''}`,
  );
}

// ── 6) Return line types stay a SEPARATE, explicit category in the read models
//       — REPOINTED from "the generator never reuses lineType 'shipping'". ───
// The collision rule was written where the rows were minted. It now has to hold
// where they are aggregated: if a read model ever lumps return money into the
// outbound shipping bucket, the charge becomes invisible to the client exactly
// as it would have if the generator had mislabelled it.
for (const lt of ['pick_pack', 'additional_unit', 'package_cost', 'shipping', 'storage']) {
  assert(
    summaries.includes(`b.line_type = '${lt}'`) && reporting.includes(`b.line_type = '${lt}'`),
    `outbound lineType '${lt}' is still bucketed on its own in BOTH billing read models`,
  );
}
assert(
  !/line_type in \([^)]*'return_/i.test(summaries) && !/line_type in \([^)]*'return_/i.test(reporting),
  'no read-model bucket folds a return line type in with another line type (returns never disappear into shipping)',
);
assert(
  summariesFlat.includes('shipping: shippingTotal') &&
    summariesFlat.includes('return_postage: returnPostageTotal') &&
    reportingFlat.includes('shipping: shippingTotal') &&
    reportingFlat.includes('return_postage: returnPostageTotal'),
  'byType keeps `shipping` and `return_postage` as distinct keys in both read models',
);

// ── 7) Summary byType includes both return line types, reconciled into grand
//       total (grand total = SUM of ALL line types, so returns fold in). ──────
// KEPT AS-IS — billing-summaries.ts and reporting-metrics.ts are portal files and
// were never part of the writer.
// Live-fallback aggregation (billing-summaries.ts).
// CP-059: these buckets now sum by the SHARED REGISTRY rather than a hand-listed spelling,
// so the legacy aliases (return_label, return_processing) and the bare 'return' line cannot
// fall out of the return buckets while their money stays in grand_total. Asserting the
// delegation is stronger than asserting one spelling: a hand-listed literal reappearing here
// is now itself a failure, checked by scripts/prepship-return-vocabulary-parity.mjs.
assert(
  summaries.includes('${isReturnPostageLineTypeSql(sql`b.line_type`)}') &&
    summaries.includes('${isReturnProcessingLineTypeSql(sql`b.line_type`)}') &&
    summaries.includes('${isReturnLineTypeSql(sql`b.line_type`)}'),
  'billingSummary sums return postage, processing AND the canonical return total by registry',
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
  reporting.includes('${isReturnPostageLineTypeSql(sql`b.line_type`)}') &&
    reporting.includes('${isReturnProcessingLineTypeSql(sql`b.line_type`)}') &&
    reporting.includes('${isReturnLineTypeSql(sql`b.line_type`)}') &&
    reporting.includes('return_postage_total') &&
    reporting.includes('return_processing_total') &&
    reporting.includes('return_total'),
  'billing_summary_metrics materializes postage, processing AND the canonical return_total by registry',
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

// ── 8) The live operator workflow still reaches a canonical generator. ───────
// NEW, and the reason it belongs to THIS guard: every assertion above is about
// return billing that already exists in the table. If the portal both stopped
// generating and stopped forwarding, return billing would quietly stop being
// produced at all and every read model above would keep passing over a table
// that no longer grows. The proxy is the only remaining path from an operator to
// return-line generation, so its survival is part of return billing's coverage.
{
  const proxy = stripComments(read('src/routes/client-portal/billing.ts'));
  assert(
    /app\.post\(\s*['"]\/billing\/generate['"]/.test(proxy) &&
      /fetch\(\s*`\$\{baseUrl\}\/billing\/generate`/.test(proxy) &&
      /PREPSHIP_API_URL/.test(proxy),
    'POST /api/client-portal/billing/generate still forwards to PrepShip, the sole owner of return line generation',
  );
}

// ── 9) package.json exposes the guard next to the other billing guards. ──────
assert(
  pkg.scripts?.['test:return-billing'] === 'node scripts/return-billing-guard.mjs',
  'package exposes test:return-billing',
);

if (failed) process.exit(1);
console.log('\nCP-031 return billing guard passed.');
