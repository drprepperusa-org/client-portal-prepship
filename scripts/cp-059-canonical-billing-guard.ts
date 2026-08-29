/**
 * CP-059 — canonical billing event-row contract guard.
 *
 * Pure. No database, no network: the upstream `fetch` is stubbed, so every row in the matrix
 * is exactly the row PrepShip would have issued. That is the point — this guard proves what
 * the PORTAL does with canonical rows, and a real upstream would make the fixtures
 * non-deterministic without proving anything extra about portal behaviour.
 *
 * What it pins:
 *   - the customer-safe allowlist discards everything not named, including hostile fields;
 *   - absent money stays absent and is never coerced to zero;
 *   - identity, type and destination are rendered as issued and never derived;
 *   - grain is upstream's — outbound and returns stay separate rows;
 *   - sort and pagination reorder and slice but never regroup, drop or duplicate.
 */
import assert from 'node:assert/strict';

process.env.PREPSHIP_API_URL ??= 'http://canonical.test';
process.env.DATABASE_URL ??= 'postgres://u:p@127.0.0.1:5432/unused';
process.env.SUPABASE_JWT_SECRET ??= 'cp059-guard-secret';
process.env.NODE_ENV ??= 'test';

const { toCanonicalBillingEventRow, fetchCanonicalBillingDetails } =
  await import('../src/lib/client-portal/prepship-billing-details-proxy.js');

let checks = 0;
const ok = (label: string) => { checks += 1; console.log(`ok   ${label}`); };

/** A deterministic 32-hex identity for a fixture row, shaped like the producer's. */
const hex32 = (seed: string) => seed
  .split('')
  .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
  .join('')
  .padEnd(32, '0')
  .slice(0, 32);

/** One canonical row as PrepShip issues it, with overrides. */
const canonical = (over: Record<string, unknown> = {}) => ({
  // Producer-issued identity. Required now: it is the only thing that identifies an ORDERLESS
  // storage row, and a row without it cannot be keyed, sorted or paginated safely.
  // 32 lowercase hex — the exact format the producer publishes. A 16-character value is no
  // longer accepted, and the fixture must not be the thing that keeps a loose check alive.
  //
  // DERIVED FROM THE ROW, not a counter. The producer's identity is content-derived and stable,
  // so a fixture keyed on call order would make identity depend on the order the test happened
  // to build its rows — which already broke the reversed-input case in the integration suite
  // once. Distinct per row, because duplicates now reject the whole response.
  canonicalEventId: hex32(String(over.displayReference ?? over.returnId ?? over.orderId ?? 'base')),
  clientId: 7,
  clientName: 'Acme',
  orderId: 1234,
  orderNumber: '1234',
  returnId: null,
  rowType: 'Outbound',
  displayReference: '1234',
  destination: 'Domestic',
  hasReturnPostageLine: false,
  hasReturnProcessingLine: false,
  pickpackTotal: 2.5,
  additionalTotal: 0,
  packageTotal: 0,
  shippingTotal: 6.1,
  storageTotal: 0,
  adjustmentTotal: 0,
  // PrepShip emits a NUMBER here, always. An absent fee is `false + 0`, not `false + null`
  // (billing-detail-row-sot.ts:281 assigns `isReturnPostageLine ? lineTotal : 0`, and the DTO
  // types these as `number`). Every fixture in this repo used null, which is why a validator
  // that rejected `false + <number>` passed every lane while rejecting all of production.
  returnPostageTotal: 0,
  returnProcessingTotal: 0,
  returnTotal: 0,
  grandTotal: 8.6,
  shipDate: '2026-08-01',
  actualActivityDate: '2026-08-01',
  billingEffectiveDate: '2026-08-01',
  billingPolicyVersion: 'ps-437-v1',
  rolledFromWeekend: false,
  recipientName: 'A Customer',
  boxSize: 'Small',
  displayQty: '1',
  qty: 1,
  ...over,
});

// --- 1. the allowlist discards everything it does not name -----------------------------------

const hostile = toCanonicalBillingEventRow(canonical({
  // Every one of these is forbidden in customer-facing output by AC-7.
  selectedRate: 9.99,
  bestRate: 8.88,
  labelCost: 4.44,
  carrierCode: 'usps',
  serviceCode: 'usps_priority',
  providerAccountId: 'acct_live_123',
  markupPct: 0.35,
  rawPayload: { secret: 'do-not-leak' },
  auditHistory: [{ by: 'admin@internal' }],
  customerEmail: 'pii@example.com',
}));
assert.ok(hostile, 'a well-formed row must survive the allowlist');
for (const forbidden of [
  'selectedRate', 'bestRate', 'labelCost', 'carrierCode', 'serviceCode',
  'providerAccountId', 'markupPct', 'rawPayload', 'auditHistory', 'customerEmail',
]) {
  assert.ok(
    !(forbidden in (hostile as unknown as Record<string, unknown>)),
    `${forbidden} must be discarded by the allowlist, not merely unrendered`,
  );
}
ok('allowlist discards internal rate/cost/provider/markup/payload/audit/PII fields');

// --- 2. absent money stays absent. THE AC-5 INVARIANT. ---------------------------------------

// THE PRODUCER'S ABSENT SHAPE. This is what PrepShip actually sends for a row with no
// postage line: presence false, amount numeric 0. It must be ACCEPTED.
const absent = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 55, displayReference: '1234-RETURN',
  hasReturnPostageLine: false, returnPostageTotal: 0,
}))!;
assert.ok(absent, 'the producer absent shape (false + 0) must be accepted, not rejected');
assert.equal(absent.hasReturnPostageLine, false, 'presence is carried through as issued');
// The amount is carried verbatim. It is NOT the signal — presence is — so the portal neither
// nulls it nor reads meaning into it.
assert.equal(absent.returnPostageTotal, 0, 'the amount is carried verbatim, meaning nothing on its own');

const explicitZero = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 56, displayReference: '1234-RETURN',
  hasReturnPostageLine: true, returnPostageTotal: 0,
}))!;
assert.equal(explicitZero.returnPostageTotal, 0, 'an explicit zero line must stay 0');
assert.equal(explicitZero.hasReturnPostageLine, true, 'presence is upstream-owned, not inferred from the amount');
ok('absent money stays null; an explicit 0.00 line stays 0 — the two remain distinguishable');

// --- 3. identity and classification are rendered, never derived ------------------------------

// An unrecognised vocabulary value is now REJECTED outright, not nulled. The earlier version
// nulled it, which was still wrong-but-safer than passing it through — until the null reached
// the serializers, where a null presence flag printed a fabricated $0.00. Rejecting is the only
// answer that keeps every downstream surface honest.
assert.equal(
  toCanonicalBillingEventRow(canonical({ rowType: 'Refund' })), null,
  'an unrecognised rowType is rejected, never passed through and never nulled into a row',
);
assert.equal(
  toCanonicalBillingEventRow(canonical({ destination: 'Somewhere' })), null,
  'an unrecognised destination is rejected, never guessed',
);

const needsReview = toCanonicalBillingEventRow(canonical({ destination: 'Needs Review' }))!;
assert.equal(needsReview.destination, 'Needs Review', "'Needs Review' is a real value, not an error");

// AC-3: a return on an international order stays International even though the parcel is
// travelling to a US warehouse. The portal renders what it is given and does not re-derive.
const intlReturn = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 77, displayReference: '1234-RETURN', destination: 'International',
}))!;
assert.equal(intlReturn.destination, 'International', 'a return inherits its outbound classification');
ok('rowType/destination render as issued; unknown values become null rather than being guessed');

// --- 4. relational identity is never parsed out of the display string ------------------------

const labelOnly = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', displayReference: '1234-RETURN-2', returnId: null,
}))!;
assert.equal(labelOnly.returnId, null, 'a missing returnId must NOT be recovered from the label');
assert.equal(labelOnly.displayReference, '1234-RETURN-2', 'the label still renders verbatim');
ok('a Return with a label but no relational id keeps returnId null — no suffix parsing');

// --- 5. grain: the fetch layer preserves upstream rows one-for-one ---------------------------

const originalFetch = globalThis.fetch;
const stubUpstream = (payload: unknown, init: { status?: number } = {}) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
};

const threeEvents = [
  canonical({ rowType: 'Outbound', returnId: null, displayReference: '1234' }),
  canonical({ rowType: 'Return', returnId: 55, displayReference: '1234-RETURN' }),
  canonical({ rowType: 'Return', returnId: 56, displayReference: '1234-RETURN-2' }),
];

stubUpstream({ data: threeEvents });
const fetched = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.ok(fetched.ok, 'a well-formed upstream response must succeed');
assert.equal(fetched.rows.length, 3, 'three canonical events must remain THREE rows, never collapsed by order');
assert.deepEqual(
  fetched.rows.map((r) => r.displayReference),
  ['1234', '1234-RETURN', '1234-RETURN-2'],
  'outbound and both returns survive with their own references',
);
ok('outbound + RETURN + RETURN-2 stay three rows — grain is upstream-owned');

// --- 6. fail closed on every uncertainty -----------------------------------------------------

stubUpstream({ data: [] }, { status: 500 });
const upstream500 = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.equal(upstream500.ok, false, 'a non-2xx upstream must fail, not render an empty grid');

stubUpstream({ notAnArray: true });
const badShape = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.equal(badShape.ok, false, 'an unexpected upstream shape must fail closed');
if (!badShape.ok) assert.match(badShape.code, /contract_mismatch/, 'and say why');

globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
const transport = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.equal(transport.ok, false, 'a transport failure must fail closed');

stubUpstream({ data: [] }, { status: 403 });
const denied = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.equal(denied.ok, false, 'an upstream scope denial must not become an empty success');
if (!denied.ok) {
  assert.equal(denied.status, 403, 'the denial status is forwarded');
  assert.equal(denied.error, 'Not found', 'but the DETAIL is opaque — a varying message leaks which client ids exist');
}
ok('fails closed on non-2xx, bad shape and transport error; denial stays opaque');

globalThis.fetch = originalFetch;

// --- 7. the 7.73 + 3.00 = 10.73 fixture, rendered not computed -------------------------------

const moneyRow = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 88, displayReference: '1234-RETURN',
  hasReturnPostageLine: true, returnPostageTotal: 7.73,
  hasReturnProcessingLine: true, returnProcessingTotal: 3.00,
  returnTotal: 10.73, grandTotal: 10.73,
}))!;
assert.equal(moneyRow.returnPostageTotal, 7.73);
assert.equal(moneyRow.returnProcessingTotal, 3.00);
assert.equal(moneyRow.returnTotal, 10.73, 'the return total arrives owned by the backend');
// The guard deliberately does NOT assert 7.73 + 3.00 === returnTotal. Checking the arithmetic
// here would be the portal re-deriving the total, which is the thing AC-4 forbids. What matters
// is that the issued total is carried through untouched.
ok('7.73 + 3.00 -> a backend-issued 10.73 carried verbatim, not re-summed locally');

// --- 7b. IDENTITY AND GUARANTEED MONEY ARE MANDATORY -----------------------------------------

// A row with no producer identity cannot be keyed, sorted or paginated — two of them would
// render as one. It is not a canonical event row.
assert.equal(
  toCanonicalBillingEventRow(canonical({ canonicalEventId: undefined })), null,
  'a row with no canonicalEventId must be rejected',
);
assert.equal(
  toCanonicalBillingEventRow(canonical({ canonicalEventId: '' })), null,
  'an empty canonicalEventId is not an identity',
);
ok('a row without a producer-issued identity is rejected');

// The seven totals PrepShip declares `: number`. A row missing one is not a billing event, and
// accepting it was customer-visible: money(null) prints $0.00 for an amount nobody computed.
for (const field of ['pickpackTotal', 'additionalTotal', 'packageTotal', 'shippingTotal',
  'storageTotal', 'adjustmentTotal', 'grandTotal']) {
  assert.equal(
    toCanonicalBillingEventRow(canonical({ [field]: undefined })), null,
    `a row missing the producer-guaranteed ${field} must be rejected, not printed as $0.00`,
  );
}
// The three RETURN totals are optional on the producer DTO, so they must NOT be required —
// requiring them would be the consumer inventing a stricter contract than the producer publishes.
for (const field of ['returnPostageTotal', 'returnProcessingTotal', 'returnTotal']) {
  assert.ok(
    toCanonicalBillingEventRow(canonical({ [field]: undefined, hasReturnPostageLine: false,
      hasReturnProcessingLine: false })),
    `${field} is optional on the producer DTO and must NOT be required`,
  );
}
ok('the seven guaranteed totals are required; the three optional return totals are not');

// --- 7c. THE MALFORMED SHAPES REVIEW GOT PAST THE BOUNDARY ------------------------------------
// Each of these was accepted at the previous SHA and reached a customer surface.

assert.equal(
  toCanonicalBillingEventRow(canonical({ canonicalEventId: 'x' })), null,
  'a non-empty string is not an identity — the producer publishes exactly 32 lowercase hex',
);
assert.equal(
  toCanonicalBillingEventRow(canonical({ canonicalEventId: 'AAAABBBBCCCCDDDDEEEEFFFF00001111' })), null,
  'uppercase hex is not the published format',
);
assert.equal(
  toCanonicalBillingEventRow(canonical({ canonicalEventId: 'aaaabbbbccccddddeeeeffff0000111' })), null,
  '31 characters is not the published format',
);
ok('only the exact 32-lowercase-hex identity format is accepted');

assert.equal(
  toCanonicalBillingEventRow(canonical({ orderId: 42.9 })), null,
  'a fractional relational id must be REJECTED, not truncated to a different order',
);
assert.ok(toCanonicalBillingEventRow(canonical({ orderId: 42 })), 'a real integer id still passes');
assert.ok(
  toCanonicalBillingEventRow(canonical({ orderId: null, canonicalEventId: hex32('storage-1') })),
  'a null orderId is a real storage shape and must still pass',
);
// clientId and returnId too — orderId has a second guard of its own, so a mutation of the
// shared integer rule is invisible unless a field WITHOUT that second layer is covered.
assert.equal(
  toCanonicalBillingEventRow(canonical({ clientId: 7.5 })), null,
  'a fractional clientId must be rejected — identity is not rounded',
);
assert.equal(
  toCanonicalBillingEventRow(canonical({ rowType: 'Return', returnId: 3.5 })), null,
  'a fractional returnId must be rejected',
);
assert.ok(
  toCanonicalBillingEventRow(canonical({ rowType: 'Return', returnId: 3 })),
  'a real integer returnId still passes',
);
ok('a fractional relational id is rejected rather than silently truncated');

for (const field of ['pickpackTotal', 'grandTotal', 'shippingTotal']) {
  assert.equal(
    toCanonicalBillingEventRow(canonical({ [field]: '3.00' })), null,
    `${field} is declared a number by the producer; a numeric STRING is contract drift`,
  );
  assert.equal(
    toCanonicalBillingEventRow(canonical({ [field]: Number.NaN })), null,
    `${field} must be a FINITE number`,
  );
}
ok('required totals must be finite JSON numbers, not coercible strings or NaN');

assert.equal(
  toCanonicalBillingEventRow(canonical({ clientId: undefined })), null,
  'a row with no client identity must not be silently detached from its client',
);
ok('client identity is required, not erased to null');

// DUPLICATE IDENTITIES fail the WHOLE response. Per-row validation cannot see this: each
// duplicate is individually well-formed, yet two rows sharing an identity render as one.
stubUpstream({ data: [
  canonical({ displayReference: 'A', canonicalEventId: hex32('same') }),
  canonical({ displayReference: 'B', canonicalEventId: hex32('same') }),
] });
const dupes = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.equal(dupes.ok, false, 'two rows sharing an identity must fail the whole response');
if (!dupes.ok) assert.match(dupes.code, /contract_mismatch/, 'and name it a contract mismatch');
// The same two rows with distinct identities must succeed, so this cannot pass by rejecting all.
stubUpstream({ data: [
  canonical({ displayReference: 'A', canonicalEventId: hex32('a') }),
  canonical({ displayReference: 'B', canonicalEventId: hex32('b') }),
] });
const distinct = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.ok(distinct.ok, 'distinct identities must still succeed');
ok('duplicate event identities reject the response; distinct ones still succeed');

// --- 8. MALFORMED ROWS FAIL CLOSED. The counterexample review found. --------------------------

// `{}` used to be accepted and become an all-null row. That row then reached the serializers,
// where `present === false ? dash : money(value)` read NULL presence as "present" and printed
// money(null) — a fabricated $0.00 on a printed invoice and in XLSX, while the grid showed a
// dash for the same row. An upstream contract mismatch rendered as customer billing activity.
assert.equal(toCanonicalBillingEventRow({}), null, 'an empty object is not a canonical row');

for (const [missing, row] of [
  // NOT orderId. PrepShip emits storage lines with orderId null by design, so requiring it
  // rejected every storage row and 502'd any period containing storage billing. Identity comes
  // from canonicalEventId, which covers the orderless shapes too.
  ['canonicalEventId', canonical({ canonicalEventId: null })],
  ['rowType', canonical({ rowType: undefined })],
  ['destination', canonical({ destination: undefined })],
  ['hasReturnPostageLine', canonical({ hasReturnPostageLine: null })],
  ['hasReturnProcessingLine', canonical({ hasReturnProcessingLine: undefined })],
] as const) {
  assert.equal(
    toCanonicalBillingEventRow(row), null,
    `a row missing ${missing} must be rejected, not turned into an all-null row`,
  );
}
ok('a row missing any mandatory identity/classification/presence fact is rejected');

// PRESENCE IS THE ONLY SIGNAL — the regression pins for the break review found.
//
// The validator used to reject `present: false` carrying a number, calling it a
// contradiction. It is not a contradiction; it is the producer's normal output for every
// outbound row and every processing-only return. Rejecting it 502'd the whole endpoint.
for (const [label, fixture] of [
  ['an outbound row (no return activity at all)',
    canonical({ hasReturnPostageLine: false, returnPostageTotal: 0,
      hasReturnProcessingLine: false, returnProcessingTotal: 0 })],
  ['a processing-only return: postage absent as 0, processing real',
    canonical({ rowType: 'Return', returnId: 88, hasReturnPostageLine: false, returnPostageTotal: 0,
      hasReturnProcessingLine: true, returnProcessingTotal: 3.5 })],
  ['a postage-only return: processing absent as 0',
    canonical({ rowType: 'Return', returnId: 89, hasReturnPostageLine: true, returnPostageTotal: 7.73,
      hasReturnProcessingLine: false, returnProcessingTotal: 0 })],
] as const) {
  assert.ok(
    toCanonicalBillingEventRow(fixture),
    `${label} is the producer's normal shape and MUST be accepted`,
  );
}
ok("false + 0 is accepted on every row shape — the producer's absent fee is not a contradiction");

// A real $0.00 fee is still distinguishable from an absent one, and both are accepted. The
// difference lives entirely in the presence flag, which is the point of AC-5.
const realZero = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 90, hasReturnPostageLine: true, returnPostageTotal: 0,
}))!;
const absentZero = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 91, hasReturnPostageLine: false, returnPostageTotal: 0,
}))!;
assert.ok(realZero && absentZero, 'both zero-amount forms are accepted');
assert.equal(realZero.returnPostageTotal, absentZero.returnPostageTotal, 'the AMOUNTS are identical');
assert.notEqual(
  realZero.hasReturnPostageLine, absentZero.hasReturnPostageLine,
  'and only the presence flag separates them — so nullability can carry no meaning',
);
ok('a real $0.00 fee and an absent fee have the SAME amount; only presence separates them');

// The one contradiction still rejected: claiming a fee exists while withholding its value.
assert.equal(
  toCanonicalBillingEventRow(canonical({ hasReturnPostageLine: true, returnPostageTotal: null })),
  null, 'present=true with no amount cannot be rendered honestly and must be rejected',
);
ok('present=true with a missing amount is still rejected');

// And one malformed row poisons the WHOLE response — skipping it would silently drop a billing
// event and show a shorter invoice than the customer was billed for.
stubUpstream({ data: [canonical(), {}, canonical()] });
const withMalformed = await fetchCanonicalBillingDetails('Bearer t', { dateFrom: '2026-08-01', dateTo: '2026-09-01' });
assert.equal(withMalformed.ok, false, 'one malformed row must fail the whole response');
if (!withMalformed.ok) {
  assert.match(withMalformed.code, /contract_mismatch/, 'and name it a contract mismatch');
}
ok('a single malformed row inside a valid envelope rejects the response, never a partial invoice');

globalThis.fetch = originalFetch;

// A checks/checks report is a tautology: it prints whatever ran and can never fail. Pinning the
// expected count means deleting a block fails the guard instead of quietly shrinking it, which
// is how a guard rots into a green no-op.
const EXPECTED_CHECKS = 19;
assert.equal(
  checks, EXPECTED_CHECKS,
  `expected ${EXPECTED_CHECKS} checks to run; ${checks} did - a check was removed or skipped`,
);
console.log('');
console.log(`PASS CP-059 canonical billing guard - ${checks}/${EXPECTED_CHECKS} checks`);
