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
    trackingService.includes('labelTrackingMap(apiKey ?? undefined, options.forceRefresh)') &&
    trackingService.includes('requestTrackingMaps') &&
    trackingService.includes('const SWEEP_RECHECK_MS = 60 * 60 * 1000'),
  'CP-042: forced refresh bypasses cooldowns, dedupes account scans, and background reconciliation rechecks hourly',
);
check(
  trackingService.indexOf('officialStatus = await lookupOfficialCarrierTracking') <
    trackingService.indexOf('const map = await trackingMapFor'),
  'CP-042: runtime checks official tracking before consulting ShipStation fallback',
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
console.log('\nCP-006/CP-042 client portal shipment status guard passed.');
