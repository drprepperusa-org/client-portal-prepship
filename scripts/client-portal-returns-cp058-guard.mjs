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

check('tracking is trimmed and the carrier is optional', () => {
  const d = ok({ trackingNumber: '  1Z999AA10123456784  ' });
  assert.equal(d.trackingNumber, '1Z999AA10123456784');
  assert.equal(d.carrierCode, null);
  assert.equal(ok({ carrierCode: ' ups ' }).carrierCode, 'ups');
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

if (failures > 0) {
  console.error(`\nFAIL CP-058 external tracking guard (${failures} failing)`);
  process.exit(1);
}
console.log('\nPASS CP-058 external tracking guard');
