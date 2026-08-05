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

if (failures > 0) {
  console.error(`\nFAIL CP-058 external tracking guard (${failures} failing)`);
  process.exit(1);
}
console.log('\nPASS CP-058 external tracking guard');
