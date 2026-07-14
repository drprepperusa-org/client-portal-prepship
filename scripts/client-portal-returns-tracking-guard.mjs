// CP-033 — return lifecycle status is BACKEND-OWNED + synced from return-shipment
// tracking; the frontend never infers it, and warehouse receiving stays the sole
// authority for received/inspected.
//
//   1. The tracking-refresh path advances a return's lifecycle from its shipment
//      tracking (label_created → in_transit) — scoped to return shipments,
//      never regressing, NEVER auto-marking received/inspected.
//   2. The return DTO exposes the canonical returns.status AND a DISTINCT
//      backend trackingStatus (carrier state).
//   3. The Returns page renders the backend lifecycle status and never derives
//      it from the carrier tracking status.
import fs from 'node:fs';
import path from 'node:path';
import { readSourceTree } from './lib/source-tree.mjs';

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

const tracking = read('src/services/shipment-tracking.ts');
const activity = read('src/services/return-activity.ts');
const returnsRoute = readSourceTree([
  'src/routes/client-portal/returns.ts',
  'src/routes/client-portal/returns',
]);
const returnsPage = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const pkg = JSON.parse(read('package.json'));

// ── 1. Backend advances the return lifecycle from tracking ──
assert(/advanceReturnsFromTracking/.test(tracking), 'shipment-tracking defines advanceReturnsFromTracking');
assert(
  /await advanceReturnsFromTracking\(/.test(tracking),
  'refreshShipmentTracking calls advanceReturnsFromTracking after persisting tracking',
);
assert(/is_return\s*=\s*true/.test(tracking), 'the advance is scoped to RETURN shipments (is_return = true)');
assert(
  /r\.status\s*=\s*'label_created'/.test(tracking),
  'the advance only touches returns still at label_created (never regresses a later state)',
);
assert(/set status\s*=\s*'in_transit'/.test(tracking), 'the advance sets status to in_transit on carrier movement');
// SAFE RULE: tracking must NEVER auto-mark received / inspected.
assert(
  !/set status\s*=\s*'received'/.test(tracking) && !/set status\s*=\s*'inspected'/.test(tracking),
  'tracking NEVER auto-marks a return received/inspected (warehouse receiving owns those)',
);
assert(
  /recordReturnTrackingActivities/.test(tracking) && /tracking_status_changed/.test(activity),
  'changed return-shipment tracking snapshots append a return history event',
);

// ── 2. Detail DTO: canonical lifecycle status + a DISTINCT trackingStatus ──
assert(
  /status:\s*row\.ret\.status/.test(returnsRoute),
  'the return DTO status is the canonical backend returns.status',
);
assert(
  /trackingStatus:\s*row\.returnTrackingStatus/.test(returnsRoute),
  'the return detail exposes a DISTINCT backend trackingStatus (carrier state)',
);
assert(
  /listOriginalOrderActivity/.test(activity) && /original_order_placed/.test(activity),
  'the return drawer order timeline is derived from canonical order/shipment event clocks',
);

// ── 3. Frontend renders backend status; NO inference from tracking ──
assert(
  /returnStatusMeta\(row\.status\)/.test(returnsPage) ||
    /returnStatusMeta\(detail\.status\)/.test(returnsPage),
  'the Returns page renders the backend lifecycle status (statusMeta(status))',
);
assert(
  !/returnStatusMeta\([^)]*trackingStatus/.test(returnsPage),
  'the Returns page never maps the carrier trackingStatus into the lifecycle status',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-returns-tracking'] ===
    'node scripts/client-portal-returns-tracking-guard.mjs',
  'package.json exposes test:client-portal-returns-tracking',
);

if (failed) process.exit(1);
console.log('\nCP-033 return lifecycle tracking guard passed.');
