// CP-006 / CP-042 / CP-051 / CP-069 guard: Client Portal outbound shipment status is
// backend-owned — since CP-069 it is PrepShip's fulfillment truth (voided | the linked order's
// lifecycle bucket), never carrier telemetry or tracking-number presence, and never derived in
// React. Sections 1-3 keep the CP-042 official-carrier collector pinned (the Returns surface
// still depends on it); sections 4-8 pin the CP-069 outbound display contract.
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
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

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
const { CircuitBreaker } = await import('../src/lib/shipstation/circuit-breaker');
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

const expectedMissBreaker = new CircuitBreaker(1, 60_000);
await assert.rejects(
  expectedMissBreaker.execute(
    async () => {
      throw new Error('expected label miss');
    },
    () => false,
  ),
);
check(
  expectedMissBreaker.status.state === 'closed' && expectedMissBreaker.status.failures === 0,
  'expected label misses do not open the ShipStation circuit breaker',
);
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
    trackingService.includes('const SWEEP_RECHECK_MS = 60 * 60 * 1000') &&
    trackingService.includes('Historical rows are checked once; recent rows'),
  'CP-042: forced refresh bypasses cooldowns; historical rows backfill once and recent rows recheck hourly',
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
const shipStationClient = read('src/lib/shipstation/client.ts');
check(
  shipStationTracking.includes("tracking_number: normalized") &&
    shipStationTracking.includes('/track`') &&
    shipStationTracking.includes('TARGETED_TRACKING_TIMEOUT_MS'),
  'ShipStation adapter resolves missing label IDs by tracking number and bounds per-label calls',
);
check(
  shipStationClient.includes('error instanceof ShipStationError && error.status === 404'),
  'legacy label-ID 404s fall through without opening the shared circuit breaker',
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

/// 3) Worker owns the periodic refresh — no browser-driven carrier calls on OUTBOUND surfaces.
//    (CP-069: the Returns page drives a returns-scoped refresh because its CP-062 arrival signal
//    depends on telemetry — pinned in client-portal-returns-tracking-guard.mjs. The outbound
//    Shipments page and adapter issue none — pinned in §8 below.)
const worker = read('src/worker.ts');
check(worker.includes('startShipmentTrackingSweep()'), 'worker starts the shipment tracking sweep');
check(
  trackingService.includes("uspsOfficialTracking: readiness.uspsConfigured ? 'enabled'"),
  'CP-042: worker startup reports official USPS readiness without exposing credentials',
);

// 4) One backend expression owns both filter and DTO status projection (CP-069 contract):
//    voided -> 'voided'; else the linked order's PrepShip fulfillment bucket via the left-joined
//    orders row (or a same-client order_number fallback when order_id is null): cancelled ->
//    'cancelled', shipped -> 'shipped', pending -> 'label_created'; no order -> 'unavailable'.
const statusOwner = read('src/lib/client-portal/shipment-status.ts');
const statusOwnerCode = stripComments(statusOwner);
const {
  normalizePortalShipmentStatus,
  resolveShipmentStatusFilterParam,
  LEGACY_SHIPMENT_STATUS_FILTER_ALIASES,
  PORTAL_SHIPMENT_STATUSES: OWNER_STATUSES,
} = await import('../src/lib/client-portal/shipment-status');
const CONTRACT_STATUSES = ['shipped', 'label_created', 'cancelled', 'voided', 'unavailable'] as const;
const LEGACY_FILTER_VALUES = ['delivered', 'in_transit', 'exception', 'attempted'] as const;
check(
  [...OWNER_STATUSES].join(',') === CONTRACT_STATUSES.join(','),
  'CP-069: PORTAL_SHIPMENT_STATUSES is exactly shipped | label_created | cancelled | voided | unavailable',
);
for (const status of CONTRACT_STATUSES) {
  check(normalizePortalShipmentStatus(status) === status, `CP-069: ${status} survives DTO validation`);
}
for (const legacy of LEGACY_FILTER_VALUES) {
  check(normalizePortalShipmentStatus(legacy) === 'unavailable', `CP-069: projected carrier vocabulary '${legacy}' fails closed (never a rendered status)`);
}
check(
  normalizePortalShipmentStatus(null) === 'unavailable' &&
    normalizePortalShipmentStatus('carrier_mystery') === 'unavailable',
  'CP-051: missing/invalid projected status fails closed as unavailable',
);
check(
  statusOwner.includes('export function portalShipmentStatusSql') &&
    statusOwnerCode.includes("then 'voided'") &&
    statusOwnerCode.includes("then 'cancelled'") &&
    statusOwnerCode.includes("then 'shipped'") &&
    statusOwnerCode.includes("then 'label_created'") &&
    statusOwnerCode.includes("else 'unavailable'"),
  'CP-069: the shipment status formula has the voided / cancelled / shipped / label_created / unavailable arms',
);
check(
  statusOwnerCode.includes('portalOrderFulfillmentBucketSql()') &&
    statusOwnerCode.includes("portalOrderFulfillmentBucketAliasSql('o')") &&
    statusOwnerCode.includes("orderLifecycleEffectiveStatusAliasSql('o')") &&
    /from '\.\/order-lifecycle'/.test(statusOwnerCode),
  'CP-069: the shipment status delegates to the order-lifecycle owner (joined orders row + same-client order_number fallback)',
);
check(
  statusOwnerCode.includes('o.order_number = ${shipments.orderNumber}') &&
    statusOwnerCode.includes('o.client_id = ${shipments.clientId}') &&
    /order by case when \$\{orderLifecycleEffectiveStatusAliasSql\('o'\)\} = 'shipped' then 0 else 1 end, o\.id desc/.test(statusOwnerCode),
  'CP-069: the order_number fallback is tenant-scoped and prefers an effective-shipped order, then the newest',
);
check(
  !statusOwnerCode.includes('trackingNumber') &&
    !statusOwnerCode.includes('labelTracking') &&
    !/tracking_status|trackingStatus|delivered_at|deliveredAt|ship_date|shipDate/.test(statusOwnerCode),
  'CP-069: the formula never reads tracking-number presence, carrier telemetry, or ship dates',
);

const readModel = read('src/lib/client-portal/read-models/shipments.ts');
check(
  readModel.includes('return status ? eq(portalShipmentStatusSql(), status)') &&
    readModel.includes('shipmentStatus: portalShipmentStatusSql()'),
  'CP-051/CP-069: filtering and DTO projection call the same backend status expression',
);
check(
  readModel.includes('outboundShipmentPredicate()') &&
    (readModel.match(/\.leftJoin\(orders, eq\(orders\.id, shipments\.orderId\)\)/g) ?? []).length === 2,
  'CP-069: the Shipments list admits outbound rows only and left-joins orders on list AND count',
);

// 5) DTO exposes intent-named lifecycle/tracking fields and no competing raw fields; the
//    carrier-telemetry fields (shipmentStatusDetail / deliveredAt) are ABSENT, not null.
const dto = read('src/lib/client-portal/dto.ts');
const shipmentDtoBlock = stripComments(/export function toPortalShipmentDto[\s\S]*?\n\}/.exec(dto)?.[0] ?? '');
check(
  shipmentDtoBlock.includes('displayTrackingNumber') &&
    shipmentDtoBlock.includes('shipmentStatus: normalizePortalShipmentStatus(row.shipmentStatus)'),
  'CP-051: shipment DTO exposes displayTrackingNumber + normalized shipmentStatus',
);
check(
  shipmentDtoBlock.length > 0 &&
    !shipmentDtoBlock.includes('shipmentStatusDetail') &&
    !shipmentDtoBlock.includes('deliveredAt') &&
    !shipmentDtoBlock.includes('trackingStatusDetail'),
  'CP-069: shipment DTO projects NO shipmentStatusDetail / deliveredAt (absence)',
);
const shipmentsContract = stripComments(read('src/lib/client-portal/contracts/shipments.ts'));
check(
  !shipmentsContract.includes('deliveredAt') &&
    !shipmentsContract.includes('shipmentStatusDetail') &&
    shipmentsContract.includes('shipmentStatus: PortalShipmentStatus'),
  'CP-069: PortalShipment contract has no deliveredAt / shipmentStatusDetail',
);

// 6) Server-side status filter whitelist is the shared enum; the route resolves legacy aliases.
check(
  readModel.includes('new Set<PortalShipmentStatus>(PORTAL_SHIPMENT_STATUSES)'),
  'CP-051: shipments read-model derives its filter whitelist from the shared enum',
);
check(
  shipmentsRoute.includes("resolveShipmentStatusFilterParam(c.req.query('status'))") &&
    shipmentsRoute.includes('SHIPMENT_STATUS_FILTERS.has(resolvedStatus)'),
  'CP-069: GET /shipments resolves ?status through resolveShipmentStatusFilterParam and the shared whitelist',
);
for (const status of CONTRACT_STATUSES) {
  check(resolveShipmentStatusFilterParam(status) === status, `CP-069: ?status=${status} filters on ${status}`);
}
for (const legacy of LEGACY_FILTER_VALUES) {
  check(
    resolveShipmentStatusFilterParam(legacy) === 'shipped' && LEGACY_SHIPMENT_STATUS_FILTER_ALIASES[legacy] === 'shipped',
    `CP-069: legacy ?status=${legacy} aliases to 'shipped' (one release)`,
  );
}
check(
  resolveShipmentStatusFilterParam('bogus') === undefined &&
    resolveShipmentStatusFilterParam('') === undefined &&
    resolveShipmentStatusFilterParam(undefined) === undefined,
  'CP-069: unknown ?status values mean no filter',
);
check(
  Object.keys(LEGACY_SHIPMENT_STATUS_FILTER_ALIASES).sort().join(',') === 'attempted,delivered,exception,in_transit',
  'CP-069: the legacy alias map is exactly delivered | in_transit | exception | attempted',
);
{
  const aliasIdx = statusOwner.indexOf('export const LEGACY_SHIPMENT_STATUS_FILTER_ALIASES');
  check(
    aliasIdx > 0 && /transitional|legacy|one release/i.test(statusOwner.slice(Math.max(0, aliasIdx - 900), aliasIdx)),
    'CP-069: the legacy alias map carries its TRANSITIONAL / removal marker',
  );
}

// 7) Frontend maps the enum to presentation only.
const statusLib = read('portal-client/src/lib/status.ts');
const metaBody = statusLib.slice(statusLib.indexOf('const SHIPMENT_STATUS_META'), statusLib.indexOf('function prettify'));
check(metaBody.length > 0, 'shipmentStatusMeta block found');
check(
  /shipped:\s*\{\s*label:\s*'Shipped'/.test(metaBody) &&
    /label_created:\s*\{\s*label:\s*'Label Created'/.test(metaBody) &&
    /cancelled:\s*\{\s*label:\s*'Cancelled'/.test(metaBody) &&
    /voided:\s*\{\s*label:\s*'Voided'/.test(metaBody) &&
    /unavailable:\s*\{\s*label:\s*'Unavailable'/.test(metaBody),
  'CP-069: shipmentStatusMeta maps exactly the 5 contract values (Shipped / Label Created / Cancelled / Voided / Unavailable)',
);
check(
  !metaBody.includes('trackingNumber') &&
    !metaBody.includes('labelTracking') &&
    !metaBody.includes('trackingStatus') &&
    metaBody.includes("?? 'unavailable'"),
  'CP-051: shipmentStatusMeta only maps backend enum values and fails closed visibly',
);
check(
  !/['"`]In Transit['"`]|['"`]Delivered['"`]/.test(stripComments(metaBody)),
  'CP-069: no In Transit / Delivered LABEL is rendered for an outbound shipment (transitional legacy KEYS map to Shipped)',
);
{
  const legacyIdx = statusLib.indexOf('const LEGACY_SHIPMENT_KEYS');
  check(
    legacyIdx > 0 &&
      /TRANSITIONAL/.test(statusLib.slice(Math.max(0, legacyIdx - 1200), legacyIdx)) &&
      /in_transit:\s*'shipped'/.test(metaBody) &&
      /delivered:\s*'shipped'/.test(metaBody),
    'CP-069: transitional legacy keys (in_transit / delivered / exception / attempted -> shipped) carry the removal marker',
  );
}

// 8) Both shipment UIs render only the intent-named customer contract.
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
const billingDrawer = read('portal-client/src/components/billing/InvoiceShipmentDrawer.tsx');
const statusOptions = /const STATUS_OPTIONS[\s\S]*?;\n/.exec(shipmentsPage)?.[0] ?? '';
check(
  statusOptions.length > 0 &&
    CONTRACT_STATUSES.every((s) => statusOptions.includes(`'${s}'`)) &&
    !/'delivered'|'in_transit'|'exception'|'attempted'/.test(statusOptions) &&
    statusOptions.includes('shipmentStatusMeta(value).label'),
  "CP-069: Shipments status filter offers exactly the 5 contract values (incl. 'shipped' and 'unavailable') labelled by shipmentStatusMeta",
);
check(
  shipmentsPage.includes('status: statusFilter || undefined') &&
    shipmentsPage.includes('shipmentStatusMeta(s.shipmentStatus)') &&
    shipmentsPage.includes('s.displayTrackingNumber') &&
    shipmentsPage.includes('allRows.find((shipment) => shipment.id === current.id)'),
  'CP-051: Shipments render backend status and refresh an open drawer from the latest DTO',
);
check(
  !/refreshShipmentTracking|refresh-tracking|deliveredAt|shipmentStatusDetail/.test(shipmentsPage) &&
    !/['"`]Delivered['"`]|['"`]In Transit['"`]/.test(stripComments(shipmentsPage)),
  'CP-069: Shipments page issues no tracking refresh and renders no Delivered / tracking-status fields',
);
check(
  billingDrawer.includes('shipmentStatusMeta(shipment.shipmentStatus)') &&
    billingDrawer.includes('shipment.displayTrackingNumber') &&
    !billingDrawer.includes('shipment.trackingNumber') &&
    !billingDrawer.includes('shipment.labelTracking') &&
    !/deliveredAt|shipmentStatusDetail/.test(stripComments(billingDrawer)),
  'CP-051/CP-069: Billing shipment drawer uses the same backend-owned contract and shows no deliveredAt',
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

const main = read('src/main.ts');
const envSource = read('src/lib/env.ts');
check(
  main.includes('env.RUN_SHIPMENT_TRACKING_SWEEP') &&
    main.includes('startShipmentTrackingSweep()') &&
    envSource.includes('RUN_SHIPMENT_TRACKING_SWEEP: booleanFlag(false)') &&
    envExample.includes('RUN_SHIPMENT_TRACKING_SWEEP=false'),
  'CP-042: production tracking sweep is explicit, opt-in, and documented',
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
console.log('\nCP-006/CP-042/CP-051/CP-069 client portal shipment status guard passed.');
