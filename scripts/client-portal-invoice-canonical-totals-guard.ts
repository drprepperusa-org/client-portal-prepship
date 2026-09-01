/**
 * CP-066 — the customer invoice's money must come from PrepShip's canonical owner.
 *
 * WHY THIS EXISTS
 * ---------------
 * The portal used to compute its own invoice totals with its own SQL while proxying its ROWS
 * from PrepShip. That made it a second source of truth for money, and it implemented neither of
 * PrepShip's two suppression rules:
 *   - PS-491 duplicate-order-copy suppression
 *   - cancelled-no-charge zeroing
 *
 * Measured on HUGRAB's August 2026 invoice against production (read-only):
 *   raw ledger, no suppression : 581 orders, $7236.51   <- what the portal showed the CUSTOMER
 *   canonical, suppressed      : 580 orders, $7206.01   <- what PrepShip believes is owed
 *   difference                 : 8 cancelled orders ($27.00) + 1 duplicate copy ($3.50) = $30.50
 *
 * The portal was billing a customer for eight cancelled orders and a duplicate copy of order
 * 3629. Both documents were internally consistent; they answered different questions.
 *
 * WHAT THIS GUARD PROVES — by EXECUTION, not by grep
 * --------------------------------------------------
 * The repo's own history is that source-regex guards get satisfied by text (see the PS-517
 * false-green). So the parsing and fail-closed behaviour is exercised for real. Only the last
 * check is source-level, and it asserts an ABSENCE that has no runtime signature.
 *
 * WHAT THIS GUARD DOES NOT PROVE
 * -------------------------------
 * It does not execute the portal's /invoice route against a real database with a seeded
 * cancelled order and a seeded duplicate copy, and compare the rendered document against
 * PrepShip's own invoice for the same client and period. That cross-app executed parity test is
 * the real proof and it does not exist yet. Do not read a green here as "the two invoices agree".
 */
import { readFileSync } from 'node:fs';
import { parseCanonicalBillingTotals } from '../src/lib/client-portal/prepship-billing-details-proxy.js';

let failed = false;
const fail = (m: string, detail = '') => {
  console.error(`FAIL ${m}${detail ? `\n     ${detail}` : ''}`);
  failed = true;
};
const ok = (m: string) => console.log(`  ok   ${m}`);
const check = (m: string, cond: boolean, detail = '') => (cond ? ok(m) : fail(m, detail));

// ── 1. The canonical block parses, verbatim ────────────────────────────────
// These are PrepShip's real numbers for HUGRAB, Aug 2026 — the suppressed ones.
const CANONICAL = {
  orderCount: 580,
  pickPackTotal: 1427.5,
  additionalTotal: 564.5,
  packageTotal: 478.19,
  shippingTotal: 4536.71,
  storageTotal: 199.11,
  adjustmentTotal: 0,
  replacePostageTotal: 0,
  replacePickPackTotal: 0,
  returnTotal: 0,
  returnPostageTotal: 0,
  returnProcessingTotal: 0,
  grandTotal: 7206.01,
};

const parsed = parseCanonicalBillingTotals(CANONICAL);
check('the canonical totals block parses', parsed !== null);
check('every field survives parsing unchanged',
  parsed !== null && (Object.keys(CANONICAL) as Array<keyof typeof CANONICAL>)
    .every((k) => parsed[k] === CANONICAL[k]),
  JSON.stringify(parsed));

// The suppressed total is what must reach the customer, NOT the raw ledger total.
check('the parsed grand total is the SUPPRESSED figure, not the raw ledger figure',
  parsed?.grandTotal === 7206.01 && parsed?.orderCount === 580,
  `grandTotal=${parsed?.grandTotal} orderCount=${parsed?.orderCount}`);

// ── 2. Numeric strings are accepted (Postgres numerics arrive as text) ─────
const asText = parseCanonicalBillingTotals({ ...CANONICAL, grandTotal: '7206.01', orderCount: '580' });
check('numeric strings parse (pg numerics arrive as text)',
  asText?.grandTotal === 7206.01 && asText?.orderCount === 580,
  JSON.stringify(asText));

// ── 3. Absence is tolerated; garbage is NOT ───────────────────────────────
// A deployed PrepShip predating a newly added field must not blank a customer's invoice...
const missingField: Record<string, unknown> = { ...CANONICAL };
delete missingField.returnProcessingTotal;
check('a MISSING field reads as 0 rather than failing the whole invoice',
  parseCanonicalBillingTotals(missingField)?.returnProcessingTotal === 0);

// ...but a field that is present and unparseable is a contract breach, and a silent $0.00 on a
// real invoice is a customer-visible lie about money.
check('a PRESENT but unparseable field yields null (fail closed)',
  parseCanonicalBillingTotals({ ...CANONICAL, grandTotal: 'not-a-number' }) === null);
check('a null totals block yields null', parseCanonicalBillingTotals(null) === null);
check('an array is not a totals block', parseCanonicalBillingTotals([CANONICAL]) === null);

// ── 4. The route must FAIL CLOSED, never fall back to a local aggregation ──
const routeSrc = readFileSync('src/routes/client-portal/invoices.ts', 'utf8');
const stripped = routeSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

check('the invoice route reads the canonical totals from the upstream result',
  /detailResult\.totals/.test(stripped),
  'the invoice must render PrepShip\'s totals, not its own');

check('the invoice route returns 502 when the canonical totals are absent',
  /if\s*\(\s*!canonicalTotals\s*\)/.test(stripped) && /502/.test(stripped),
  'a missing totals block must fail closed, not render $0.00');

// This is the one source-level ABSENCE check: a re-added local aggregation has no runtime
// signature to assert against, because it would simply produce a different (wrong) number.
check('the invoice route does NOT recompute money via billingSummary',
  !/billingSummary/.test(stripped),
  'billingSummary reappeared in the invoice route — that is the second source of truth this '
  + 'guard exists to prevent. If a NON-invoice route in this file needs it, move that route out '
  + 'rather than loosening this check.');

// ── 5. Only DAYS may cross the PrepShip boundary ──────────────────────────
// PrepShip re-runs billingDayRange() on whatever it receives and reads the date part as the LAST
// INCLUDED day. Sending the exclusive instant made the row window a day wider than the totals on
// the same page — which is why an August invoice listed 9/1 rows.
const eventCalls = [...stripped.matchAll(/portalCanonicalInvoiceEvents\([\s\S]*?\}\s*,/g)].map((m) => m[0]);
check('every portalCanonicalInvoiceEvents call site sends DAYS, not instants',
  eventCalls.length >= 3 && eventCalls.every((c) => /dateFrom:\s*range\.fromDay/.test(c) && /dateTo:\s*range\.toDay/.test(c)),
  `${eventCalls.length} call site(s); offending: ${eventCalls.filter((c) => !/range\.toDay/.test(c)).join(' | ').slice(0, 200)}`);

if (failed) {
  console.error('\n✖ client-portal invoice canonical-totals guard FAILED');
  process.exit(1);
}
console.log('\nPASS client-portal invoice canonical totals (money comes from PrepShip\'s owner)');
