// CP-006 guard: Client Portal shipment delivery status is backend-owned and
// provider-backed — never derived in React from tracking-number presence when
// live status exists.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;

function check(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// 1) Backend normalization: provider label statuses -> portal vocabulary.
const { normalizeTrackingStatus } = await import('../src/services/shipment-tracking');
check(normalizeTrackingStatus('delivered') === 'delivered', 'normalize: delivered -> delivered');
check(normalizeTrackingStatus('DELIVERED') === 'delivered', 'normalize: case-insensitive');
check(normalizeTrackingStatus('in_transit') === 'in_transit', 'normalize: in_transit -> in_transit');
check(normalizeTrackingStatus('error') === 'exception', 'normalize: error -> exception');
check(normalizeTrackingStatus('unknown') === null, 'normalize: unknown carries no signal (keeps derived label)');
check(normalizeTrackingStatus(null) === null, 'normalize: null-safe');

// 2) The service treats delivered as terminal and backs off between checks.
const trackingService = read('src/services/shipment-tracking.ts');
check(
  trackingService.includes("<> 'delivered'") && trackingService.includes('trackingCheckedAt'),
  'refresh/sweep skip delivered rows (terminal) and record checked-at for backoff',
);

// 3) Worker owns the periodic refresh (no browser-driven carrier calls).
const worker = read('src/worker.ts');
check(worker.includes('startShipmentTrackingSweep()'), 'worker starts the shipment tracking sweep');

// 4) DTO returns the normalized status fields to the portal.
const dto = read('src/lib/client-portal/dto.ts');
check(
  dto.includes('trackingStatus: row.trackingStatus ?? null') && dto.includes('deliveredAt: iso(row.deliveredAt)'),
  'shipment DTO exposes trackingStatus + deliveredAt',
);

// 5) Server-side status filter whitelist includes delivered (and voided).
const readModel = read('src/lib/client-portal/read-models/shipments.ts');
check(
  readModel.includes("'delivered'") && readModel.includes("'voided'") && readModel.includes('SHIPMENT_STATUS_FILTERS'),
  'shipments read-model whitelists delivered/voided server-side status filters',
);

// 6) Frontend renders backend status first; tracking-number-derived In Transit
//    is only the fallback for rows with no live status. Voided always wins.
const statusLib = read('portal-client/src/lib/status.ts');
const metaBody = /shipmentStatusMeta[\s\S]*?\n\}/.exec(statusLib)?.[0] ?? '';
const voidedIdx = metaBody.indexOf("s.voided");
const deliveredIdx = metaBody.indexOf("s.trackingStatus === 'delivered'");
const derivedIdx = metaBody.indexOf('s.trackingNumber || s.labelTracking');
check(
  voidedIdx !== -1 && deliveredIdx !== -1 && derivedIdx !== -1 && voidedIdx < deliveredIdx && deliveredIdx < derivedIdx,
  'shipmentStatusMeta: voided wins, backend delivered beats tracking-number-derived In Transit',
);
check(metaBody.includes("label: 'Delivered'"), 'Delivered is a rendered shipment status');

// 7) Shipments page filters by backend status (server-side), incl. Delivered.
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
check(
  shipmentsPage.includes("value: 'delivered'") && shipmentsPage.includes('status: statusFilter || undefined'),
  'Shipments filter offers Delivered and sends the status to the backend',
);

// 8) No frontend code talks to carrier/tracking APIs directly.
function grepDir(dir: string, needle: string): string[] {
  const hits: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...grepDir(p, needle));
    else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(p, 'utf8').includes(needle)) hits.push(p);
  }
  return hits;
}
const carrierCalls = grepDir(path.join(root, 'portal-client/src'), 'shipstation.com');
check(carrierCalls.length === 0, `frontend never calls carrier/tracking APIs directly${carrierCalls.length ? `: ${carrierCalls.join(', ')}` : ''}`);

// 9) package.json exposes this guard.
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-shipments-status'] === 'tsx scripts/client-portal-shipments-status-guard.ts',
  'package.json exposes test:client-portal-shipments-status',
);
console.log('ok: package.json exposes test:client-portal-shipments-status');

if (failed) process.exit(1);
console.log('\nCP-006 client portal shipment status guard passed.');
