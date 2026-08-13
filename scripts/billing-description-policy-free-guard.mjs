// CP-036 follow-through, re-anchored for CP-059A — billing_line_items
// descriptions are policy-free.
//
// THE RULE (unchanged)
//
// billing_line_items.description is AUDIT-ONLY: the client-portal invoice
// read-models aggregate rows by line_type into totals and never SELECT the
// description. Even though it cannot reach a client surface, per CP-031/CP-036
// no billing description may EMBED internal markup / override PRICING POLICY
// (e.g. a "below-$X override $Y" trigger note or a "P% + $F" markup note).
// CP-031/CP-036 normalized the RETURN lines (return postage / return processing
// fee); this guard extended the same rule to the OUTBOUND shipping line and
// locked every description going forward.
//
// WHY THE ANCHORS MOVED (CP-059A)
//
// Until CP-059A this guard read src/services/billing.ts, pulled every
// `description:` template literal out of generateLineItems, and asserted the
// policy wording was absent from each one. CP-059A DELETED that file. The portal
// retired its billing writer entirely and PrepShip (repo prepship-v4) is now the
// SOLE owner of billing_line_items generation. So there is no portal-side
// description literal left to inspect — not because the rule was relaxed, but
// because the code that composed those strings left this repository.
//
// The rule therefore SPLITS, and this guard keeps the half the portal still owns:
//
//   * AUTHORING the wording — RETIRED HERE. "Which words may appear in a billing
//     description" now lives in PrepShip, beside the generator that writes the
//     column; PrepShip pins the return-line and outbound-shipping-line wording
//     there. Sections 1 and 2 replace the old per-literal scan with assertions
//     that the portal has NO local generator and composes NO billing description
//     at all. That is a STRONGER statement than "the literals we found are
//     clean": the portal cannot violate a wording rule it never writes, and the
//     old scan would silently pass on zero literals once its file vanished.
//   * The surrounding CONTRACT — KEPT, repointed at the real files that still
//     hold it in this repo: the row-identity uniqueness key that forced
//     descriptions to be per-shipment-unique (src/db/schema/billing.ts), the one
//     surviving reader of the column (src/services/billing-summaries.ts), the
//     client-facing invoice read-model that still never selects it
//     (src/lib/client-portal/read-models/invoice-details.ts), and the proxy that
//     hands generation to the new owner (src/routes/client-portal/billing.ts).
//
// STATIC ONLY — no db / live / generation.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => (exists(rel) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');

let failed = false;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS ${msg}`);
  } else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}

/**
 * Comments removed before every source-text check below.
 *
 * This guard is unusually exposed to prose: its whole subject is wording that
 * doc comments legitimately QUOTE (this very file quotes "below-$X override $Y").
 * The pre-CP-059A version handled that by scoping its scan to backtick-delimited
 * description literals; now that it scans surviving billing code instead, comment
 * stripping is what keeps a comment describing the banned wording from being read
 * as the banned wording — and keeps a comment about a deleted writer from
 * satisfying a "no writer here" assertion.
 *
 * ORDER MATTERS: line comments FIRST. Stripping block comments first eats this
 * repo's proxy route — a LINE comment there mentions a route path containing a
 * block-comment opener, the block pattern latches onto it and runs to the next
 * block-comment terminator far below, and the file reaches the assertions with
 * most of its code missing (documented at length in
 * ps-cp-059a-writer-retirement-guard.ts). Removing line comments first consumes
 * that opener. The `[^:]` guard keeps `https://` from being read as a comment.
 */
function strip(source) {
  return source.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

// Recursively collect active server sources under a repo-relative directory
// (tests and fixtures excluded — they may stage banned wording deliberately).
function walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = path.join(rel, ent.name);
    if (ent.isDirectory()) {
      if (/^(node_modules|__tests__|__fixtures__)$/.test(ent.name)) continue;
      out.push(...walk(child));
    } else if (ent.isFile() && /\.tsx?$/.test(ent.name) && !/\.(test|spec)\.tsx?$/.test(ent.name)) {
      out.push(child.replace(/\\/g, '/'));
    }
  }
  return out;
}

// The billing surface that SURVIVED the writer retirement: every active server
// source that still touches billing_line_items. This replaces the single
// src/services/billing.ts anchor. Scoping the scans to these files (rather than
// all of src) is deliberate — an unrelated module may legitimately carry a
// `description:` string literal (services/workflows/action-registry.ts does), and
// a repo-wide ban would fail on code that has nothing to do with billing money.
const BILLING_SOURCES = walk('src')
  .map((rel) => ({ rel, code: strip(read(rel)) }))
  .filter(({ code }) => /\bbillingLineItems\b|\bbilling_line_items\b/.test(code));

const billingSourcePaths = BILLING_SOURCES.map(({ rel }) => rel);
assert(
  BILLING_SOURCES.length >= 8,
  `located the surviving billing_line_items surface (${BILLING_SOURCES.length} active server files)`,
);
// Named anchors, so the scans below can never quietly shrink to an empty set the
// way the old `read('src/services/billing.ts')` scan did when its file was deleted.
//
// src/routes/client-portal/billing.ts is deliberately NOT required here: after
// comment stripping it names no billing table at all, because the proxy forwards
// the operator's intent to PrepShip rather than touching billing_line_items. That
// absence is the retirement working, so the proxy is anchored directly by path in
// section 3 instead of via this membership test.
for (const required of [
  'src/db/schema/billing.ts',
  'src/services/billing-summaries.ts',
  'src/services/billing-read-support.ts',
  'src/lib/client-portal/read-models/invoice-details.ts',
]) {
  assert(billingSourcePaths.includes(required), `${required} is in the scanned billing surface`);
}

// ── 1. RETIREMENT — the portal authors no billing description ────────────────
// Replaces: `assert(billing.length > 0, 'src/services/billing.ts exists')` and
// the `descriptions.length >= 6` literal capture. Both required the generator to
// be present. The generator moved to PrepShip with the rest of the writer, so the
// portal-side statement is now its ABSENCE.

assert(
  !exists('src/services/billing.ts'),
  'the portal has no local billing generator to author descriptions (src/services/billing.ts is deleted, not emptied)',
);

// A generator could be re-authored under another name; the exhaustive version of
// this check is ps-cp-059a-writer-retirement-guard.ts. Repeated here, scoped to
// the billing surface, because a returning generateLineItems is precisely what
// would put description authorship back in this repo.
for (const { rel, code } of BILLING_SOURCES) {
  assert(!/\bgenerateLineItems\b/.test(code), `${rel} does not reach a local line-item generator`);
}

// No INSERT or UPDATE means no description VALUE can originate or be amended
// here, which is what makes the wording rule unviolatable portal-side. DELETE is
// intentionally not banned: the classified admin test-data purge removes rows and
// carries no description; ps-cp-059a-writer-retirement-guard.ts holds it to
// delete-only.
for (const { rel, code } of BILLING_SOURCES) {
  assert(
    !/(?:db|tx|trx)\s*\.\s*(?:insert|update)\s*\(\s*billingLineItems\s*\)/.test(code),
    `${rel} performs no ORM insert/update of billing_line_items (no description can be written)`,
  );
  assert(
    !/(?:insert\s+into|update)\s+(?:public\.)?billing_line_items/i.test(code),
    `${rel} performs no raw-SQL insert/update of billing_line_items`,
  );
}

// The direct successor to the old per-literal scan: rather than checking that each
// composed description is clean, assert the portal composes NONE. `description:`
// bound to a string or template literal is the shape the retired generator used
// (`description: \`Box (${name})\``); the two legitimate occurrences left are the
// column declaration (`description: text().notNull()`) and the read projection
// (`description: billingLineItems.description`), neither of which is a literal.
for (const { rel, code } of BILLING_SOURCES) {
  assert(
    !/description\s*:\s*[`'"]/.test(code),
    `${rel} composes no billing description string (PrepShip authors the wording)`,
  );
}

// ── 2. The banned policy wording still cannot re-enter ───────────────────────
// The token list is KEPT VERBATIM — it is the substance of CP-031/CP-036, not
// scaffolding for the deleted generator. Its target moved: with no description
// literals left to scan, it now guards the surviving billing code so a future edit
// cannot smuggle the wording back in on the READ side (e.g. by decorating a row's
// stored description before rendering it, or reviving a local fee calculation).
// Matched as literal substrings against comment-stripped source, so legitimate
// money in billing code (the storage line's "× $X/cuft") is unaffected.
const FORBIDDEN = [
  'below-$', // override-trigger note   (was: "Shipping (below-$6.00 override $7.73)")
  'override $', // override-amount note
  '% + $', // markup percent + flat note (was: "Shipping (10% + $0.50)")
  '${pct}', // raw markup-percent interpolation
  '${flat', // raw markup-flat interpolation
];

for (const { rel, code } of BILLING_SOURCES) {
  for (const token of FORBIDDEN) {
    assert(!code.includes(token), `${rel} carries no billing pricing-policy wording (no "${token}")`);
  }
}

// ── 3. KEPT / REPOINTED — the contract the portal still holds ────────────────

// Replaces the targeted "the outbound shipping line uses a policy-free
// '· shipping · shipment #<id>' description" assertion.
//
// WHY IT MOVED: that assertion pinned the generator's chosen STRING FORM. The
// form existed to satisfy a constraint — descriptions participate in the row
// identity key, so an outbound shipping line had to be unique per shipment. The
// form is PrepShip's business now; the CONSTRAINT that made the form necessary is
// still DECLARED IN THIS REPO's schema, so the guard pins the constraint here and
// leaves the wording to the writer's owner. If this key were dropped, PrepShip's
// per-shipment-unique wording would stop being required by the portal's schema.
const schema = strip(read('src/db/schema/billing.ts'));
assert(schema.length > 0, 'src/db/schema/billing.ts exists');
assert(
  /unique\('billing_li_unique'\)\.on\(\s*t\.orderId,\s*t\.lineType,\s*t\.description\s*\)/.test(schema),
  'billing_line_items still keys row identity on (order_id, line_type, description) — the reason descriptions must be per-shipment-unique',
);
assert(
  /description:\s*text\(\)\.notNull\(\)/.test(schema),
  'the audit-only description column is still declared NOT NULL (PrepShip must supply it)',
);

// The one surviving portal READER of the column. It still exists, so it stays
// pointed at the real file: billingDetails SELECTs the stored description for the
// operator detail view and only PARSES it (the packageName "Box (...)" fallback).
// Reading is allowed; re-deriving is what would re-introduce policy wording, and
// section 1's literal ban above covers this file too.
const summaries = strip(read('src/services/billing-summaries.ts'));
assert(summaries.length > 0, 'src/services/billing-summaries.ts exists');
assert(
  /description:\s*billingLineItems\.description/.test(summaries),
  'billing-summaries.ts still SELECTs the audit-only description column (read model, not writer)',
);
assert(
  /row\.description\.match\(/.test(summaries),
  'billingDetails only PARSES the stored description for its packageName fallback — it never composes one',
);

// The CP-036 containment fact, promoted from this guard's header prose to an
// assertion. It used to be safe to leave as prose because the generator's output
// was pinned line-by-line just above; with the write side gone, the portal's
// remaining half of CP-036 is that the client-facing invoice read-model still
// aggregates by line_type into totals and never selects the description at all.
// (client-portal-returns-canonical-fields-guard.mjs asserts the same containment
// across every client-portal read-model and route; this is the billing anchor.)
const invoiceReadModel = strip(read('src/lib/client-portal/read-models/invoice-details.ts'));
assert(invoiceReadModel.length > 0, 'src/lib/client-portal/read-models/invoice-details.ts exists');
assert(
  !/\bdescription\b/.test(invoiceReadModel),
  'the client-facing invoice read-model selects no billing description column',
);
assert(
  /b\.line_type/.test(invoiceReadModel),
  'client invoices are still aggregated by line_type into backend-owned totals',
);

// Where the retired half of this rule now lives, expressed as code rather than a
// comment: the live operator workflow still exists, and it forwards generation —
// and with it description authorship — to PrepShip.
const proxy = strip(read('src/routes/client-portal/billing.ts'));
assert(proxy.length > 0, 'src/routes/client-portal/billing.ts exists');
assert(
  /app\.post\(\s*['"]\/billing\/generate['"]/.test(proxy) && /PREPSHIP_API_URL/.test(proxy),
  'POST /billing/generate proxies to PrepShip, the owner of the description wording rule',
);
assert(
  /fetch\(\s*`\$\{baseUrl\}\/billing\/generate`/.test(proxy),
  'the proxy forwards to the canonical PrepShip /billing/generate',
);

// package.json wiring (also auto-discovered by scripts/run-guards.mjs).
const pkg = JSON.parse(read('package.json'));
assert(
  pkg.scripts?.['test:billing-description-policy-free'] ===
    'node scripts/billing-description-policy-free-guard.mjs',
  'package.json exposes test:billing-description-policy-free',
);

if (failed) process.exit(1);
console.log('\nbilling description policy-free guard passed.');
