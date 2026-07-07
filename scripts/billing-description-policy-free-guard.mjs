// CP-036 follow-through — billing_line_items descriptions are policy-free.
//
// The billing generator (src/services/billing.ts generateLineItems) writes a
// human-readable `description` onto every billing_line_items row. That column is
// AUDIT-ONLY: the client-portal invoice read-models aggregate rows by line_type
// into totals and never SELECT the description — pinned separately by
// client-portal-returns-canonical-fields-guard.mjs. Even though it cannot reach
// a client surface, per CP-031/CP-036 no billing description may EMBED internal
// markup / override PRICING POLICY (e.g. a "below-$X override $Y" trigger note
// or a "P% + $F" markup note). CP-031/CP-036 already normalized the RETURN lines
// (return postage / return processing fee); this guard extends the same rule to
// the OUTBOUND shipping line and locks every description going forward.
//
// It reads the generator source and asserts every `description:` template
// literal is free of that policy wording, so a future edit cannot re-introduce
// internal pricing policy into the description string.
//
// STATIC ONLY — no db / live / generation.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) =>
  fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
function assert(cond, msg) {
  if (cond) {
    console.log(`PASS ${msg}`);
  } else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}

const billing = read('src/services/billing.ts');
assert(billing.length > 0, 'src/services/billing.ts exists');

// Every `description:` value in the generator is a single-line template literal;
// capture each literal's CONTENT (backtick-delimited) so the check is scoped to
// the description strings themselves and never trips on doc comments (which may
// legitimately DESCRIBE the banned wording).
const descriptions = [...billing.matchAll(/description:\s*`([^`]*)`/g)].map((m) => m[1]);
assert(
  descriptions.length >= 6,
  `captured the generator's billing description literals (${descriptions.length} found)`,
);

// Internal markup / override PRICING-POLICY wording that must never appear in an
// audit-/customer-facing billing description. Matched as literal substrings, so
// legitimate money in a description (e.g. the storage line's "× $X/cuft") is
// unaffected — only the specific policy tokens are banned.
const FORBIDDEN = [
  'below-$', // override-trigger note   (was: "Shipping (below-$6.00 override $7.73)")
  'override $', // override-amount note
  '% + $', // markup percent + flat note (was: "Shipping (10% + $0.50)")
  '${pct}', // raw markup-percent interpolation
  '${flat', // raw markup-flat interpolation
];

for (const desc of descriptions) {
  for (const token of FORBIDDEN) {
    assert(
      !desc.includes(token),
      `billing description is policy-free (no "${token}"): \`${desc}\``,
    );
  }
}

// Targeted: the outbound shipping line is present and normalized to the
// policy-free, per-shipment-unique form (mirrors the CP-031 return-line idiom,
// keeping it unique on the (order_id, line_type, description) key).
const shippingDesc = descriptions.find(
  (d) => /\bshipping\b/i.test(d) && d.includes('shipment #'),
);
assert(
  Boolean(shippingDesc),
  'the outbound shipping line uses a policy-free "· shipping · shipment #<id>" description',
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
