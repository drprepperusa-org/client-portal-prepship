/**
 * CP-058 AC-3/AC-4 guard — assigning an externally purchased return label.
 *
 * Offline/pure: no DB, no network, no provider call, no label purchase, no postage.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXTERNAL_TRACKING_EVENT,
  EXTERNAL_TRACKING_RETURN_STATUS,
  externalTrackingShipmentFields,
  resolveReturnExternalTracking,
} from '../src/services/return-external-tracking.ts';

/**
 * Strip comments before any NEGATIVE assertion over source.
 *
 * Four separate checks in this file's history fired on the prose explaining a rule
 * instead of the rule itself — a doc comment naming the provider fields it refuses to
 * write, a route comment mentioning requirePermission, a comment saying the portal
 * decides nothing about "finalized periods". A negative assertion cannot tell code from
 * the sentence describing it, so it must never see the sentence.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

const pending = { status: 'requested', returnShipmentId: null };
const ok = (o = {}) => resolveReturnExternalTracking({
  return: pending, trackingNumber: '1Z999AA10123456784', labelCost: '7.95', ...o,
});

// ── AC-4: one canonical label state ─────────────────────────────────────────
check('a return that ALREADY has a PrepShip label refuses external tracking', () => {
  const d = resolveReturnExternalTracking({
    return: { status: 'label_created', returnShipmentId: 28887 },
    trackingNumber: '1Z999AA10123456784',
    labelCost: '7.95',
  });
  assert.equal(d.kind, 'rejected');
  assert.equal(d.code, 'label_already_exists',
    'competing PrepShip and external truths are exactly what AC-4 forbids');
});

check('the competing-truths check runs BEFORE any field validation', () => {
  // A blank tracking number on an already-labelled return must still report the real
  // reason, not send the operator off fixing the wrong thing.
  const d = resolveReturnExternalTracking({
    return: { status: 'label_created', returnShipmentId: 28887 },
    trackingNumber: '',
    labelCost: '',
  });
  assert.equal(d.code, 'label_already_exists');
});

check('a return past the labelable window refuses tracking', () => {
  for (const status of ['in_transit', 'received', 'inspected', 'closed', 'cancelled']) {
    const d = resolveReturnExternalTracking({
      return: { status, returnShipmentId: null },
      trackingNumber: '1Z999AA10123456784',
      labelCost: '7.95',
    });
    assert.equal(d.code, 'status_not_labelable', status);
  }
});

check('a label-pending or failed return accepts it', () => {
  for (const status of ['requested', 'label_failed']) {
    const d = resolveReturnExternalTracking({
      return: { status, returnShipmentId: null },
      trackingNumber: '1Z999AA10123456784',
      labelCost: '7.95',
    });
    assert.equal(d.kind, 'accept', status);
  }
});

// ── AC-3: required tracking + cost ──────────────────────────────────────────
check('a tracking number is required', () => {
  for (const trackingNumber of ['', '   ', null, undefined, 42]) {
    assert.equal(ok({ trackingNumber }).code, 'tracking_required', String(trackingNumber));
  }
});

check('a label cost is required', () => {
  for (const labelCost of ['', null, undefined, 'abc', -1]) {
    assert.equal(ok({ labelCost }).code, 'label_cost_required', String(labelCost));
  }
});

check('a $0.00 label cost is accepted (free labels are real)', () => {
  const d = ok({ labelCost: '0.00' });
  assert.equal(d.kind, 'accept');
  assert.equal(d.externalLabelCost, 0);
});

check('tracking is trimmed', () => {
  const d = ok({ trackingNumber: '  1Z999AA10123456784  ' });
  assert.equal(d.trackingNumber, '1Z999AA10123456784');
});

// ── AC-4: never a purchase, never a customer rate ───────────────────────────
check('the recorded shipment carries NO provider identity', () => {
  const fields = externalTrackingShipmentFields(ok());
  for (const forbidden of [
    'providerAccountId', 'labelProvider', 'shipstationLabelId', 'labelProviderKey',
    'labelShipmentId', 'selectedRateJson',
  ]) {
    assert.ok(!(forbidden in fields),
      `${forbidden} would make hand-entered tracking look like a PrepShip purchase`);
  }
  assert.equal(fields.source, 'external_return_label');
  assert.equal(fields.isReturn, true);
  assert.equal(fields.voided, false);
});

check('the external cost NEVER becomes a customer-facing rate', () => {
  const fields = externalTrackingShipmentFields(ok({ labelCost: '12.34' }));
  assert.equal(fields.cost, '12.34', 'the operator-entered cost is recorded as cost');
  // selectedRateCost and the customer rate are PrepShip-owned (PS-487 AC-2 / PS-435).
  assert.ok(!('selectedRateCost' in fields));
  assert.ok(!('returnCustomerShippingRate' in fields));
  assert.ok(!('customerRate' in fields));
});

check('the module makes no provider call and imports no carrier connector', () => {
  // Strip comments first. The doc comment in that module legitimately NAMES the provider
  // fields it refuses to write ("no providerAccountId, labelProvider, shipstationLabelId
  // ..."), and a raw scan matches that prose — the same way the permission-gate and
  // hugrab checks earlier today fired on the text explaining the rule rather than the
  // rule. What this assertion means is that no CODE reaches a carrier.
  const code = readFileSync('src/services/return-external-tracking.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(code, /^import/m, 'the rule must stay dependency-free and unable to buy postage');
  assert.doesNotMatch(code, /carrierConnectors|createLabel\(|shipstation|easypost/i);
});

check('the resulting status and audit event are named constants', () => {
  assert.equal(EXTERNAL_TRACKING_RETURN_STATUS, 'label_created');
  assert.equal(EXTERNAL_TRACKING_EVENT, 'external_tracking_assigned');
});


// ── the ROUTE + apply service stay thin and provider-free ───────────────────
const actions = readFileSync('src/routes/client-portal/returns/actions.ts', 'utf8');
const applySvc = readFileSync('src/services/return-external-tracking-apply.ts', 'utf8');
const routeStart = actions.indexOf("'/returns/:id{[0-9]+}/external-tracking'");
const routeBlock = routeStart >= 0 ? actions.slice(routeStart, routeStart + 3000) : '';

check('the external-tracking route exists and is scope-gated', () => {
  assert.ok(routeStart >= 0, 'the route must exist');
  assert.match(routeBlock, /scopeOrResponse\(c\)/);
  assert.match(routeBlock, /returnScopePredicate\(scope\)/,
    'an out-of-scope return must not be reachable');
});

check('the route DELEGATES the decision and the write', () => {
  assert.match(routeBlock, /resolveReturnExternalTracking\(\{/);
  assert.match(routeBlock, /applyReturnExternalTracking\(\{/);
  assert.doesNotMatch(routeBlock, /db\.transaction\(/, 'the write belongs to the service');
});

check('a rejected decision writes NOTHING', () => {
  const reject = routeBlock.indexOf("decision.kind === 'rejected'");
  const apply = routeBlock.indexOf('applyReturnExternalTracking(');
  assert.ok(reject >= 0 && apply > reject, 'the rejection must return before the write');
});

check('an already-labelled return answers 409, not a silent overwrite', () => {
  assert.match(routeBlock, /label_already_exists[\s\S]{0,160}?409/);
});

check('carrier is NOT a client-supplied field', () => {
  // client-portal-returns-ui pins that carrier/service/provider stays server-internal.
  // The first version of this route accepted carrierCode from the request body and broke
  // that guard, correctly — AC-3 asks only for a tracking number, a cost and a PDF. The
  // carrier was my addition, not the card's.
  assert.doesNotMatch(routeBlock, /carrierCode/, 'carrier must stay server-internal');
});

check('neither the route nor the apply service calls a carrier', () => {
  // Comment-stripped, for the reason recorded above.
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const [name, src] of [['route', routeBlock], ['apply service', applySvc]]) {
    assert.doesNotMatch(strip(src), /carrierConnectors|shipstation|easypost|createReturnLabel\(/i,
      `${name} must never buy postage`);
  }
});

check('the canonical slot is claimed by id, and the status moves with it', () => {
  assert.match(applySvc, /\.update\(returns\)/);
  assert.match(applySvc, /returnShipmentId: shipment!\.id/);
  assert.match(applySvc, /status: EXTERNAL_TRACKING_RETURN_STATUS/);
});

check('the apply service writes no customer-facing rate', () => {
  assert.doesNotMatch(applySvc, /returnCustomerShippingRate|selectedRateCost/,
    'the customer-billed amount stays PrepShip-owned (PS-487 AC-2 / PS-435)');
});

// ── AC-2: a start-only return reads as Label Pending ────────────────────────
check('the start-only status presents as "Return Started — Label Pending"', () => {
  const presentation = readFileSync(
    'portal-client/src/components/returns/returnPresentation.ts', 'utf8',
  );
  assert.match(
    presentation,
    /requested: \{ label: 'Return Started — Label Pending'/,
    'AC-2 wants the start-only state named, not left as a bare "Requested"',
  );
  // Presentation only — the backend enum key must NOT be renamed, or every stored row,
  // filter and guard that speaks 'requested' breaks.
  assert.match(presentation, /^\s*'requested',$/m, 'the filter option keeps the enum key');
});

// ── AC-6: the date-edit surface is STAFF-ONLY and canonical-owned ───────────
const dateStart = actions.indexOf("'/returns/:id{[0-9]+}/billing-date'");
const dateBlock = dateStart >= 0 ? actions.slice(dateStart, dateStart + 3600) : '';

check('the billing-date route exists and refuses CLIENT users', () => {
  assert.ok(dateStart >= 0, 'the staff-only date-edit route must exist');
  assert.match(dateBlock, /if \(!scope\.isGlobal\)/, 'client users must be refused');
});

check('a client user gets 404, not 403 (the endpoint is not confirmed to exist)', () => {
  // AC-6: clients cannot edit the date OR see the audit. A 403 would confirm both that
  // the endpoint exists and that this return is real.
  assert.match(dateBlock, /!scope\.isGlobal[\s\S]{0,240}?'Return not found'[\s\S]{0,40}?404/);
});

check('the portal DECIDES nothing — it proxies to the canonical PrepShip route', () => {
  assert.match(dateBlock, /\$\{baseUrl\}\/billing\/returns\/\$\{id\}\/billing-date/);
  // Comment-stripped. This is the FOURTH negative assertion in this session to fire on
  // the prose explaining a rule rather than the rule — the route's own comment says it
  // decides nothing about "finalized periods or adjustments". Any negative that scans
  // source must strip comments first; there is no exception worth remembering.
  assert.doesNotMatch(
    stripComments(dateBlock),
    /finalized|adjustment|billingDateOverride|createBillingCreditNote/i,
    'PS-487 owns the rule; the portal owns the surface',
  );
});

check('the caller\'s own token is forwarded, so PrepShip re-authorises', () => {
  assert.match(dateBlock, /const authorization = c\.req\.header\('authorization'\)/);
  assert.match(dateBlock, /authorization,/, 'forward the bearer rather than a portal service key');
});

check('the canonical status is passed through verbatim (409 stays a 409)', () => {
  assert.match(dateBlock, /upstream\.status/,
    're-wording the refusal would hide why a finalized period was blocked');
});

check('the return must still be in the caller\'s scope', () => {
  assert.match(dateBlock, /returnScopePredicate\(scope\)/);
});

// ── AC-4: the optional PDF is private and scoped ────────────────────────────
const pdfStart = actions.indexOf("'/returns/:id{[0-9]+}/external-label-pdf'");
const pdfBlock = pdfStart >= 0 ? actions.slice(pdfStart, pdfStart + 3200) : '';

check('the external-label PDF route exists and is scope-gated', () => {
  assert.ok(pdfStart >= 0, 'the PDF route must exist');
  assert.match(pdfBlock, /scopeOrResponse\(c\)/);
  assert.match(pdfBlock, /returnScopePredicate\(scope\)/);
});

check('the PDF goes to the PRIVATE bucket, and only its path is persisted', () => {
  // CP-030's bucket is private and read through short-lived signed URLs. Reusing it is
  // what makes AC-4's "private/scoped" true; a second storage mechanism would be a
  // second chance to publish a customer document by accident.
  assert.match(pdfBlock, /uploadReturnInspectionMedia\(objectPath/);
  assert.match(pdfBlock, /labelUrl: objectPath/, 'persist the object PATH, never the binary');
  assert.doesNotMatch(pdfBlock, /getPublicUrl|publicUrl/, 'the bucket must never be public');
});

check('only a PDF, and only within the size limit', () => {
  assert.match(pdfBlock, /file\.type !== 'application\/pdf'/);
  assert.match(pdfBlock, /file\.size > EXTERNAL_LABEL_PDF_MAX_BYTES/);
  assert.match(pdfBlock, /413/, 'an oversized upload must be refused, not truncated');
});

check('the filename is sanitised before it becomes an object path', () => {
  assert.match(pdfBlock, /replace\(\/\[\^a-zA-Z0-9\._-\]\/g, '_'\)/,
    'an unsanitised name lets a caller shape the storage path');
});

check('a PrepShip label\'s PDF can never be replaced by this route', () => {
  // One return, one label document. Overwriting a PrepShip label PDF with a hand-uploaded
  // one is the same competing-truths failure AC-4 forbids for tracking.
  assert.match(pdfBlock, /shipmentSource !== 'external_return_label'/);
  assert.match(pdfBlock, /returnShipmentId == null[\s\S]{0,200}?409/,
    'a return with no external tracking yet has nothing to attach a PDF to');
});

check('a failed upload does NOT persist a dead reference', () => {
  const upload = pdfBlock.indexOf('uploadReturnInspectionMedia(');
  const persist = pdfBlock.indexOf('labelUrl: objectPath');
  const fail = pdfBlock.indexOf('502');
  assert.ok(upload >= 0 && fail > upload && persist > fail,
    'the 502 must return before the row is updated');
});

// ── AC-1: a return must record WHY it was started ────────────────────────────
const createBlock = (() => {
  const start = actions.indexOf("app.post('/returns'");
  if (start < 0) {
    console.error('SETUP FAILED: the return create route moved — this guard proves nothing');
    process.exit(1);
  }
  const end = actions.indexOf('registerReturn', start + 10);
  return actions.slice(start, end > start ? end : start + 8000);
})();

check('a blank return reason is refused at creation', () => {
  assert.match(createBlock, /A return reason is required[\s\S]{0,40}?400/,
    'a missing reason must 400, not be accepted');
  assert.match(createBlock, /const requestedReason = body\.reason\?\.trim\(\)/,
    'whitespace must not satisfy the requirement');
});

check('the reason is never invented on the caller\'s behalf', () => {
  // The point of AC-1 is the REAL answer. A default like "Customer Return" would satisfy
  // a NOT NULL column while destroying exactly the information the field exists to hold,
  // and it would do so silently — every return would then look documented.
  const code = stripComments(createBlock);
  assert.ok(!/reason:\s*body\.reason\?\.trim\(\)\s*\|\|\s*null/.test(code),
    'reason must no longer fall back to null');
  assert.ok(!/reason[^\n]*\|\|\s*'Customer Return'/.test(code),
    'a placeholder reason cannot be told apart from a real one');
  assert.match(code, /reason: requestedReason/,
    'the validated value is what gets stored');
});

check('the create UI does not advertise the reason as optional', () => {
  // A backend rule the form contradicts is a 400 the operator cannot predict. This pins
  // BOTH halves: the paired FE change is what keeps the rule from breaking a working
  // flow, so it belongs in the same guard as the rule.
  const modal = stripComments(
    readFileSync('portal-client/src/components/returns/ReturnCreateModal.tsx', 'utf8')
      .replace(/\r\n/g, '\n'),
  );
  assert.ok(!/Reason \(optional\)/.test(modal),
    'the label still says optional while the backend requires it');
  assert.ok(!/reason: reason\.trim\(\) \|\| undefined/.test(modal),
    'the form still sends undefined for a blank reason');
  assert.match(modal, /disabled=\{[^}]*!reason\.trim\(\)/,
    'submit must be disabled on a blank reason rather than collecting a 400');
});

if (failures > 0) {
  console.error(`\nFAIL CP-058 external tracking guard (${failures} failing)`);
  process.exit(1);
}
console.log('\nPASS CP-058 external tracking guard');
