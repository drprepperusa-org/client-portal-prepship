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

/** One canonical row as PrepShip issues it, with overrides. */
const canonical = (over: Record<string, unknown> = {}) => ({
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
  returnPostageTotal: null,
  returnProcessingTotal: null,
  returnTotal: null,
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

const absent = toCanonicalBillingEventRow(canonical({
  rowType: 'Return', returnId: 55, displayReference: '1234-RETURN',
  hasReturnPostageLine: false, returnPostageTotal: null,
}))!;
assert.equal(absent.returnPostageTotal, null, 'an absent return-postage amount must stay null');
assert.notEqual(absent.returnPostageTotal, 0, 'absent must never become 0');

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

// --- 8. MALFORMED ROWS FAIL CLOSED. The counterexample review found. --------------------------

// `{}` used to be accepted and become an all-null row. That row then reached the serializers,
// where `present === false ? dash : money(value)` read NULL presence as "present" and printed
// money(null) — a fabricated $0.00 on a printed invoice and in XLSX, while the grid showed a
// dash for the same row. An upstream contract mismatch rendered as customer billing activity.
assert.equal(toCanonicalBillingEventRow({}), null, 'an empty object is not a canonical row');

for (const [missing, row] of [
  ['orderId', canonical({ orderId: null })],
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

// Presence and amount must agree. Rendering either side of a contradiction picks a winner
// between two upstream facts that disagree, which the portal is not entitled to do.
assert.equal(
  toCanonicalBillingEventRow(canonical({ hasReturnPostageLine: true, returnPostageTotal: null })),
  null, 'present=true with no amount is a contradiction and must be rejected',
);
assert.equal(
  toCanonicalBillingEventRow(canonical({ hasReturnPostageLine: false, returnPostageTotal: 7.73 })),
  null, 'present=false with money attached is a contradiction and must be rejected',
);
// Both consistent forms still survive — this must not pass by rejecting everything.
assert.ok(
  toCanonicalBillingEventRow(canonical({ hasReturnPostageLine: false, returnPostageTotal: null })),
  'absent-and-null is consistent and must be ACCEPTED',
);
assert.ok(
  toCanonicalBillingEventRow(canonical({ hasReturnPostageLine: true, returnPostageTotal: 0 })),
  'present-with-explicit-zero is consistent and must be ACCEPTED',
);
ok('presence and amount must agree; both consistent forms still accepted');

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
const EXPECTED_CHECKS = 10;
assert.equal(
  checks, EXPECTED_CHECKS,
  `expected ${EXPECTED_CHECKS} checks to run; ${checks} did - a check was removed or skipped`,
);
console.log('');
console.log(`PASS CP-059 canonical billing guard - ${checks}/${EXPECTED_CHECKS} checks`);
