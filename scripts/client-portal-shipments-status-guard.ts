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
const {
  normalizeTrackingStatus,
  normalizeShipStationTrackingCode,
  normalizeShipStationTrackingSnapshot,
} = await import('../src/services/shipment-tracking');
const {
  normalizeOfficialTrackingSnapshot,
  chooseTrackingSignal,
  lookupOfficialCarrierTracking,
} = await import('../src/services/carrier-tracking');
check(normalizeTrackingStatus('delivered') === 'delivered', 'normalize: delivered -> delivered');
check(normalizeTrackingStatus('DELIVERED') === 'delivered', 'normalize: case-insensitive');
check(normalizeTrackingStatus('in_transit') === 'in_transit', 'normalize: in_transit -> in_transit');
check(normalizeTrackingStatus('error') === 'exception', 'normalize: error -> exception');
check(normalizeTrackingStatus('unknown') === null, 'normalize: unknown carries no signal (keeps derived label)');
check(normalizeTrackingStatus(null) === null, 'normalize: null-safe');
check(normalizeShipStationTrackingCode('DE') === 'delivered', 'ShipStation DE -> delivered');
check(normalizeShipStationTrackingCode('SP') === 'delivered', 'ShipStation SP -> delivered');
check(normalizeShipStationTrackingCode('AC') === 'in_transit', 'ShipStation AC -> in_transit');
check(normalizeShipStationTrackingCode('AT') === 'attempted', 'ShipStation AT -> attempted');
check(normalizeShipStationTrackingCode('UN') === null, 'ShipStation UN carries no signal');
const shipStationDelivered = normalizeShipStationTrackingSnapshot({
  trackingNumber: '9434650106151099370997',
  statusCode: 'DE',
  statusDescription: 'Delivered',
  statusDetailCode: null,
  statusDetailDescription: null,
  actualDeliveryDate: '2026-07-08T21:11:00Z',
});
check(
  shipStationDelivered?.trackingStatus === 'delivered' &&
    shipStationDelivered.deliveredAt?.toISOString() === '2026-07-08T21:11:00.000Z',
  'targeted ShipStation response preserves delivered status and carrier event time',
);
const uspsDelivered = normalizeOfficialTrackingSnapshot('usps', {
  statusCategory: 'Delivered',
  status: 'Delivered, Front Door/Porch',
  trackingEvents: [{ eventType: 'Delivered', eventTimestamp: '2026-07-03T12:20:00-07:00' }],
});
check(uspsDelivered?.trackingStatus === 'delivered', 'CP-042: official USPS delivered normalizes to delivered');
check(
  uspsDelivered?.trackingStatusDetail === 'Delivered, Front Door/Porch',
  'CP-042: official USPS wording is retained as a safe tracking detail',
);
check(
  uspsDelivered?.deliveredAt?.toISOString() === '2026-07-03T19:20:00.000Z',
  'CP-042: official USPS delivered event time is preserved',
);
const chosenSignal = chooseTrackingSignal({
  official: uspsDelivered,
  shipStationStatus: 'in_transit',
  previousStatus: 'in_transit',
});
check(
  chosenSignal?.source === 'carrier' && chosenSignal.trackingStatus === 'delivered',
  'CP-042: official carrier delivered wins over stale ShipStation in_transit',
);
const officialFirstSignal = chooseTrackingSignal({
  official: normalizeOfficialTrackingSnapshot('usps', {
    statusCategory: 'In Transit',
    status: 'Moving Through Network',
  }),
  shipStationStatus: 'exception',
  previousStatus: null,
});
check(
  officialFirstSignal?.source === 'carrier' && officialFirstSignal.trackingStatus === 'in_transit',
  'CP-042: official carrier status is authoritative and ShipStation is fallback-only',
);

const { env } = await import('../src/lib/env');
const originalFetch = globalThis.fetch;
const originalUspsEnv = {
  clientId: env.USPS_TRACKING_CLIENT_ID,
  clientSecret: env.USPS_TRACKING_CLIENT_SECRET,
  baseUrl: env.USPS_TRACKING_BASE_URL,
};
const uspsCalls: Array<{ url: string; init?: RequestInit }> = [];
try {
  env.USPS_TRACKING_CLIENT_ID = 'cp-042-test-client';
  env.USPS_TRACKING_CLIENT_SECRET = 'cp-042-test-secret';
  env.USPS_TRACKING_BASE_URL = 'https://apis.usps.com';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    uspsCalls.push({ url, init });
    if (url.endsWith('/oauth2/v3/token')) {
      return new Response(JSON.stringify({ access_token: 'guard-token', expires_in: 300 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        statusCategory: 'Delivered',
        status: 'Delivered, Front Door/Porch',
        trackingEvents: [{ eventType: 'Delivered', eventTimestamp: '2026-07-03T12:20:00-07:00' }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  const liveShape = await lookupOfficialCarrierTracking({
    carrierCode: 'usps',
    trackingNumber: '9434650106151099380583',
  });
  const oauthCall = uspsCalls[0];
  const oauthBody = JSON.parse(String(oauthCall?.init?.body ?? '{}')) as Record<string, string>;
  const oauthHeaders = new Headers(oauthCall?.init?.headers);
  check(
    oauthCall?.url === 'https://apis.usps.com/oauth2/v3/token' &&
      oauthHeaders.get('content-type') === 'application/json' &&
      oauthBody.grant_type === 'client_credentials' &&
      oauthBody.client_id === 'cp-042-test-client' &&
      oauthBody.client_secret === 'cp-042-test-secret',
    'CP-042: USPS OAuth executes with the official JSON client-credentials contract',
  );
  check(
    uspsCalls[1]?.url.endsWith('/tracking/v3/tracking/9434650106151099380583?expand=DETAIL') === true &&
      liveShape?.trackingStatus === 'delivered',
    'CP-042: official USPS v3 detail response reconciles the affected stale-delivery fixture',
  );
} finally {
  globalThis.fetch = originalFetch;
  env.USPS_TRACKING_CLIENT_ID = originalUspsEnv.clientId;
  env.USPS_TRACKING_CLIENT_SECRET = originalUspsEnv.clientSecret;
  env.USPS_TRACKING_BASE_URL = originalUspsEnv.baseUrl;
}

// 2) The service treats delivered as terminal and backs off between checks.
const trackingService = read('src/services/shipment-tracking.ts');
check(
  trackingService.includes("<> 'delivered'") &&
    trackingService.includes('trackingCheckedAt') &&
    trackingService.includes('lookupOfficialCarrierTracking'),
  'refresh/sweep skip delivered rows, record checked-at, and consult official carrier tracking before falling back',
);
check(
  trackingService.includes('options.forceRefresh') &&
    trackingService.includes('LOOKUP_CONCURRENCY') &&
    trackingService.includes('shipstationLabelId') &&
    trackingService.includes('const SWEEP_RECHECK_MS = 60 * 60 * 1000'),
  'CP-042: forced refresh bypasses cooldowns; targeted concurrent reconciliation rechecks hourly',
);
check(
  trackingService.indexOf('officialStatus = await lookupOfficialCarrierTracking') <
    trackingService.indexOf('const result = await lookupShipStationTracking'),
  'CP-042: runtime checks official tracking before consulting ShipStation fallback',
);
check(
  trackingService.includes('ssGetLabelTracking') &&
    trackingService.includes('ssFindLabelByTrackingNumber') &&
    trackingService.includes('trackingFailedAt: now') &&
    trackingService.includes('trackingError: message') &&
    !trackingService.includes('ssListLabelTracking'),
  'targeted per-label tracking replaces account scan and failed lookups keep explicit retry state',
);

const shipStationTracking = read('src/lib/shipstation/tracking.ts');
check(
  shipStationTracking.includes("tracking_number: normalized") &&
    shipStationTracking.includes('/track`') &&
    shipStationTracking.includes('TARGETED_TRACKING_TIMEOUT_MS'),
  'ShipStation adapter resolves missing label IDs by tracking number and bounds per-label calls',
);

const trackingMigration = read('drizzle/0042_targeted_shipment_tracking.sql');
check(
  trackingMigration.includes('shipstation_label_id') &&
    trackingMigration.includes('tracking_failed_at') &&
    trackingMigration.includes('tracking_error'),
  'additive migration persists ShipStation label identity and retry diagnostics',
);

const carrierTracking = read('src/services/carrier-tracking.ts');
check(
  carrierTracking.includes("'content-type': 'application/json'") &&
    carrierTracking.includes('body: JSON.stringify({') &&
    !carrierTracking.includes('application/x-www-form-urlencoded'),
  'CP-042: USPS OAuth uses the official JSON client-credentials request shape',
);
check(
  carrierTracking.includes('AbortSignal.timeout(CARRIER_REQUEST_TIMEOUT_MS)'),
  'CP-042: official carrier calls have bounded request timeouts',
);

const shipmentsRoute = read('src/routes/client-portal/shipments.ts');
check(
  shipmentsRoute.includes('forceRefresh: true') && shipmentsRoute.includes('logDiagnostics: true'),
  'CP-042: manual refresh is immediate and emits safe backend diagnostics',
);

// 3) Worker owns the periodic refresh (no browser-driven carrier calls).
const worker = read('src/worker.ts');
check(worker.includes('startShipmentTrackingSweep()'), 'worker starts the shipment tracking sweep');
check(
  trackingService.includes("uspsOfficialTracking: readiness.uspsConfigured ? 'enabled'"),
  'CP-042: worker startup reports official USPS readiness without exposing credentials',
);

// 4) One backend expression owns both filter and DTO status projection.
const statusOwner = read('src/lib/client-portal/shipment-status.ts');
const { normalizePortalShipmentStatus } = await import('../src/lib/client-portal/shipment-status');
const statusFixtures = [
  'delivered',
  'in_transit',
  'exception',
  'attempted',
  'label_created',
  'voided',
] as const;
for (const status of statusFixtures) {
  check(normalizePortalShipmentStatus(status) === status, `CP-051: ${status} survives DTO validation`);
}
check(
  normalizePortalShipmentStatus(null) === 'unavailable' &&
    normalizePortalShipmentStatus('carrier_mystery') === 'unavailable',
  'CP-051: missing/invalid projected status fails closed as unavailable',
);
check(
  statusOwner.includes('export function portalShipmentStatusSql') &&
    statusOwner.includes("then 'label_created'") &&
    statusOwner.includes("else 'unavailable'") &&
    !statusOwner.includes('trackingNumber') &&
    !statusOwner.includes('labelTracking'),
  'CP-051: backend lifecycle formula covers fixtures and never uses tracking-number presence',
);

const readModel = read('src/lib/client-portal/read-models/shipments.ts');
check(
  readModel.includes('return status ? eq(portalShipmentStatusSql(), status)') &&
    readModel.includes('shipmentStatus: portalShipmentStatusSql()'),
  'CP-051: filtering and DTO projection call the same backend status expression',
);

// 5) DTO exposes intent-named lifecycle/tracking fields and no competing raw fields.
const dto = read('src/lib/client-portal/dto.ts');
check(
  dto.includes('displayTrackingNumber') &&
    dto.includes('shipmentStatus: normalizePortalShipmentStatus(row.shipmentStatus)') &&
    dto.includes('shipmentStatusDetail: row.trackingStatusDetail ?? null') &&
    dto.includes('deliveredAt: iso(row.deliveredAt)'),
  'CP-051: shipment DTO exposes displayTrackingNumber + normalized shipmentStatus',
);

// 6) Server-side status filter whitelist includes every rendered enum value.
check(
  readModel.includes('new Set<PortalShipmentStatus>(PORTAL_SHIPMENT_STATUSES)'),
  'CP-051: shipments read-model derives its filter whitelist from the shared enum',
);

// 7) Frontend maps the enum to presentation only.
const statusLib = read('portal-client/src/lib/status.ts');
const metaBody = /shipmentStatusMeta[\s\S]*?\n\}/.exec(statusLib)?.[0] ?? '';
check(
  metaBody.includes("case 'in_transit':") &&
    metaBody.includes("label: 'Unavailable'") &&
    !metaBody.includes('trackingNumber') &&
    !metaBody.includes('labelTracking') &&
    !metaBody.includes('trackingStatus'),
  'CP-051: shipmentStatusMeta only maps backend enum values and fails closed visibly',
);
check(metaBody.includes("label: 'Delivered'"), 'Delivered is a rendered shipment status');

// 8) Both shipment UIs render only the intent-named customer contract.
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
const billingDrawer = read('portal-client/src/components/billing/InvoiceShipmentDrawer.tsx');
check(
  shipmentsPage.includes("value: 'delivered'") &&
    shipmentsPage.includes("value: 'unavailable'") &&
    shipmentsPage.includes('status: statusFilter || undefined') &&
    shipmentsPage.includes('shipmentStatusMeta(s.shipmentStatus)') &&
    shipmentsPage.includes('s.displayTrackingNumber') &&
    shipmentsPage.includes('allRows.find((shipment) => shipment.id === current.id)'),
  'CP-051: Shipments render backend status and refresh an open drawer from the latest DTO',
);
check(
  billingDrawer.includes('shipmentStatusMeta(shipment.shipmentStatus)') &&
    billingDrawer.includes('shipment.displayTrackingNumber') &&
    !billingDrawer.includes('shipment.trackingNumber') &&
    !billingDrawer.includes('shipment.labelTracking'),
  'CP-051: Billing shipment drawer uses the same backend-owned contract',
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

// 9) Read-only diagnostics explain local/external/chosen status and mask the
// tracking number without exposing or mutating credentials/state.
const diagnostic = read('scripts/diagnose-shipment-tracking.ts');
check(
  diagnostic.includes("readOnly: true") &&
    diagnostic.includes('maskTrackingNumber') &&
    diagnostic.includes('chosenSource') &&
    !diagnostic.includes('db.update') &&
    !diagnostic.includes('db.delete') &&
    !diagnostic.includes('db.insert'),
  'CP-042: tracking diagnostic is read-only, masked, and shows reconciliation choice',
);

const envExample = read('.env.example');
check(
  envExample.includes('USPS_TRACKING_CLIENT_ID=') &&
    envExample.includes('USPS_TRACKING_CLIENT_SECRET=') &&
    envExample.includes('USPS_TRACKING_BASE_URL=https://apis.usps.com'),
  'CP-042: deployment environment template documents official USPS tracking settings',
);

// 10) package.json exposes this guard and the read-only diagnostic.
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-shipments-status'] === 'tsx scripts/client-portal-shipments-status-guard.ts',
  'package.json exposes test:client-portal-shipments-status',
);
console.log('ok: package.json exposes test:client-portal-shipments-status');
check(
  pkg.scripts?.['diagnose:shipment-tracking'] === 'tsx scripts/diagnose-shipment-tracking.ts',
  'package.json exposes diagnose:shipment-tracking',
);

if (failed) process.exit(1);
console.log('\nCP-006/CP-042/CP-051 client portal shipment status guard passed.');
