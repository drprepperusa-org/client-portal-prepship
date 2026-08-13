// PS-366/PS-437 cutover guard: HUGRAB and every other customer override are
// decided by PrepShip. Client Portal receives only the frozen customer amount.
//
// CP-059A re-anchor: this guard used to read `src/services/billing.ts` to prove the
// portal's own generator applied no outbound override. That file is DELETED, so the
// read threw ENOENT before a single assertion ran. The rule was not dropped — see the
// block above the outbound-override section below for where it now lives and what is
// asserted here in its place.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

/**
 * Comment-stripped view, used by the source-scanning assertions below.
 *
 * WHY: after CP-059A the surviving billing files carry long prose about the retired
 * writer and the policy it used to apply. A bare `doesNotMatch` over raw text would
 * fail the moment someone documents the retirement by name, and — worse in the other
 * direction — prose describing a delegated policy must never be able to satisfy a
 * check about live code.
 *
 * ORDER MATTERS: line comments are stripped FIRST. The proxy route contains a line
 * comment holding a route path with `/*` in it; stripping block comments first latches
 * onto that and eats the rest of the file. The `[^:]` guard keeps `https://` from being
 * read as a comment. (Same failure and same fix as ps-cp-059a-writer-retirement-guard.)
 */
function stripComments(source: string): string {
  return source
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every active server source file, excluding tests, fixtures and guard scripts. */
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

const adapter = read('src/services/prepship-customer-shipping-money.ts');
const returnsService = read('src/services/returns.ts');
const safeResponseType = adapter.slice(
  adapter.indexOf('export type CustomerSafeShippingMoney'),
  adapter.indexOf('export type CustomerSafeShippingMoney') + 360,
);

// ── The return-money delegation boundary — unchanged by CP-059A ──────────────
// These five assertions never pinned generator behaviour. They pin the PrepShip
// adapter and the return workflow, both of which still live in this repo, so they
// stay anchored exactly where they were.
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

// ── CP-059A: the outbound override assertion, re-anchored ────────────────────
//
// WHAT IT USED TO SAY
//   assert.doesNotMatch(read('src/services/billing.ts'), OVERRIDE_POLICY)
// i.e. the portal's own `generateLineItems` never read billing_config's
// shipping_rate_override_* columns to decide an outbound shipping line's money.
//
// WHY THE ANCHOR MOVED
//   That was an assertion about GENERATOR behaviour, and the generator is gone:
//   CP-059A deleted src/services/billing.ts and made PrepShip (repo prepship-v4)
//   the sole owner of billing_line_items generation and of customer shipping rate
//   policy. The override rule did not disappear — it is now PrepShip's generator's
//   rule to keep, and PrepShip pins it there. Pointing this guard at a deleted file
//   asserted nothing; it just crashed.
//
// WHAT IS ASSERTED INSTEAD — the portal-side half that is still ours to hold:
//   1. the retirement is structural: no local generator file exists to apply an
//      override in the first place;
//   2. the billing surfaces that SURVIVED the retirement apply no override policy;
//   3. repo-wide, the override config is only ever STORED, never consumed — the set
//      of files naming it is pinned, so a new consumer cannot appear quietly;
//   4. the live operator path leaves the portal, so the outbound money decision is
//      demonstrably made upstream rather than here.
const OVERRIDE_POLICY = /shippingRateOverrideTriggerBelow|shippingRateOverrideAmount/;

// 1. Structural retirement. Deleted, not emptied — a file by that name is an
// invitation to add a generator (and its override branch) back to the portal.
assert.equal(exists('src/services/billing.ts'), false,
  'the portal must own no local billing generator to apply an outbound override');

// 2. The surfaces that inherited the retired writer's code are the likeliest place
// for policy to creep back, so each is named rather than covered only in bulk.
// billing-read-support.ts holds helpers extracted VERBATIM from the deleted writer;
// billing-summaries.ts and the read models render generated rows; the proxy replaces
// the writer's entry point; billing-auto-generate.ts is the parked worker target.
const SURVIVING_BILLING_SURFACES = [
  'src/services/billing-read-support.ts',
  'src/services/billing-summaries.ts',
  'src/services/billing-auto-generate.ts',
  'src/routes/client-portal/billing.ts',
  'src/lib/client-portal/read-models/invoice-details.ts',
];
for (const rel of SURVIVING_BILLING_SURFACES) {
  assert.equal(exists(rel), true, `${rel} must exist for this guard to mean anything`);
  assert.doesNotMatch(stripComments(read(rel)), OVERRIDE_POLICY,
    `${rel} must own no outbound override policy — PrepShip decides it`);
}

// 3. Repo-wide classification. The portal still STORES the override config for
// PrepShip to read (schema column, config upsert, admin settings CRUD); storing a
// number is not deciding with it. Pinning the exact set means any new file that
// touches the override has to be added here deliberately, which is the review moment
// this guard exists to create.
const OVERRIDE_CONFIG_STORAGE = [
  'src/db/schema/billing.ts', // column definitions
  'src/routes/billing.ts', // admin settings read/write of the config values
  'src/services/billing-config.ts', // billing_config upsert (extracted from the writer)
];
const overrideReferences = activeServerSources()
  .filter((rel) => OVERRIDE_POLICY.test(stripComments(read(rel))))
  .sort();
assert.deepEqual(overrideReferences, [...OVERRIDE_CONFIG_STORAGE].sort(),
  `only config storage may name the outbound override; found: ${overrideReferences.join(', ') || 'none'}`);

// 4. The live operator workflow forwards to PrepShip instead of computing here, so
// the override decision provably happens where the rule moved to.
const proxy = stripComments(read('src/routes/client-portal/billing.ts'));
assert.match(proxy, /app\.post\(\s*['"]\/billing\/generate['"]/,
  'the operator generate path must remain a route in this repo');
assert.match(proxy, /fetch\(\s*`\$\{baseUrl\}\/billing\/generate`/,
  'the operator generate path must forward to PrepShip, the owner of override policy');
assert.doesNotMatch(proxy, /\bgenerateLineItems\b/,
  'the proxy must not fall back to a local generator');

console.log('PS-366/PS-437 override delegation guard passed.');
