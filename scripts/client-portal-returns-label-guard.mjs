// CP-027 — backend return-label service guard.
//
// Statically pins the safety + correctness invariants of the backend
// return-label service (src/services/returns.ts):
//   1. NO real postage by default — the RETURNS_LIVE_LABELS env gate exists;
//      real clients fail closed and explicit test clients use an offline mock.
//   2. The clients.isTest guard is present (a test client never buys postage).
//   3. Cheapest ELIGIBLE rate selection uses isBlockedRate + pickBestRate/bestRate.
//   4. Persistence sets isReturn: true + returnForShipmentId + selectedRateJson.
//   5. labelUrl is normalized through extractShipstationLabelUrl.
//   6. The CLIENT-SAFE result type/object never carries carrier/service/provider/
//      selected-rate identifiers (carrierCode / serviceCode / providerAccountId /
//      selectedRateJson).
//   7. An admin-override audit path exists.
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

const service = read('src/services/returns.ts');
const envFile = read('src/lib/env.ts');
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

assert(service.length > 0, 'src/services/returns.ts exists');

// ── 1. RETURNS_LIVE_LABELS gate + fail-closed default ──
assert(
  /RETURNS_LIVE_LABELS/.test(envFile),
  'env module declares the RETURNS_LIVE_LABELS approval flag',
);
assert(
  /RETURNS_LIVE_LABELS:\s*booleanFlag\(false\)/.test(envFile),
  'RETURNS_LIVE_LABELS defaults to false (OFF) in the env module',
);
assert(
  /env\.RETURNS_LIVE_LABELS/.test(service),
  'the return-label service reads env.RETURNS_LIVE_LABELS to gate live postage',
);
// The live purchase path must require the flag AND a non-test client.
assert(
  /resolveReturnLabelExecutionMode/.test(service) && /executionMode === 'live'/.test(service),
  'live purchase is gated by the centralized return-label execution policy',
);
assert(
  /'test_offline'/.test(service),
  "the offline mock path persists source 'test_offline'",
);
assert(
  /generateMockLabelPdf/.test(service) && /saveMockLabel/.test(service),
  'the offline mock path reuses generateMockLabelPdf + saveMockLabel (no carrier call)',
);
// Real clients fail closed when live labels are disabled. Only an explicit
// test client may enter the offline-mock branch.
assert(
  /executionMode === 'disabled'[\s\S]{0,250}Return label creation is unavailable/.test(service),
  'a real client fails closed when live labels are disabled',
);
{
  const offlineIdx = service.indexOf("executionMode === 'test_offline'");
  const liveCallIdx = service.search(/carrierConnectors\.shipstation\.createLabel/);
  assert(
    offlineIdx !== -1 && liveCallIdx !== -1 && offlineIdx < liveCallIdx,
    'the test-only offline branch precedes and returns before the live carrier createLabel call',
  );
}

// ── 1b. CP-032: PrepShip owns the workflow — NO ShipStation-return shortcut ──
// Return-label creation must ALWAYS rate-shop the cheapest eligible rate
// backend-side; the old delegate-to-ShipStation shortcut (createReturnLabelV2
// when the outbound row had a labelShipmentId) is removed.
assert(
  !/createReturnLabelV2\(/.test(service) && !/import[^;]*createReturnLabelV2/.test(service),
  'the return-label service no longer imports/calls the ShipStation createReturnLabelV2 shortcut (rate-shop is the sole path)',
);

// ── 2. clients.isTest guard ──
assert(
  /clients\.isTest/.test(service) && /clientIsTest/.test(service),
  'the service checks clients.isTest so a test client can never buy real postage',
);

// ── 3. Cheapest ELIGIBLE selection ──
assert(
  /isBlockedRate/.test(service),
  'cheapest-eligible selection filters with isBlockedRate',
);
assert(
  /bestRate/.test(service),
  'cheapest-eligible selection uses the cheapest-first bestRate from getRates',
);
assert(
  /getRates\s*\(/.test(service),
  'the fallback path rate-shops via getRates',
);
assert(
  /getRates\s*\(\s*rateInput\s*,\s*\{\s*forceRefresh:\s*true,\s*applyMarkups:\s*false\s*\}\s*\)/.test(service),
  'live return-label purchase forces a fresh unmarked provider-rate attempt',
);
assert(
  /resolveReturnRatePolicy/.test(service) &&
    /prepship_default_return_context/.test(service) &&
    !/client_explicit_return_context/.test(service) &&
    !/loadClientCredentials/.test(service),
  'the return-label service uses the explicit PrepShip default account instead of generic client credentials',
);
assert(
  /markReturnLabelFailed/.test(service) && /label_failed/.test(service),
  'no-rate/all-blocked live failures mark the return workflow as label_failed',
);
assert(
  /deliveryError/.test(service) && /returnLabelFailureMessage/.test(service),
  'label failure persists a client-safe deliveryError summary',
);
for (const field of ['returnId', 'orderId', 'clientId', 'storeId', 'weightOz', 'hasDims', 'fromZip', 'toZip', 'rawRateCount', 'eligibleRateCount', 'blockedRateCount']) {
  assert(new RegExp(field).test(service), `safe return-label diagnostics include ${field}`);
}
assert(
  /carrierDiagnostics/.test(service) && /sanitizeCarrierDiagnostics/.test(service),
  'carrier diagnostics are sanitized before logging or audit/error details',
);
assert(
  /label_failed/.test(returnsRoute) && /RETURN_STATUS_FILTERS/.test(returnsRoute),
  'returns API whitelist includes the recoverable label_failed workflow state',
);
assert(
  /label_failed/.test(returnsPage) &&
    /Label needs attention/.test(returnsPage) &&
    /PrepShip could not create the label yet/.test(returnsPage),
  'Returns UI renders the recoverable label_failed state with client-safe copy',
);

// ── 4. Canonical persistence ──
assert(
  /isReturn:\s*true/.test(service),
  'persistence sets isReturn: true on the return shipments row',
);
assert(
  /returnForShipmentId/.test(service),
  'persistence sets returnForShipmentId (links the return to its outbound shipment)',
);
assert(
  /selectedRateJson/.test(service),
  'persistence writes selectedRateJson (the full rate envelope)',
);
assert(
  /packageCode:\s*'package'/.test(service) &&
    !/packageCode:\s*outbound\.selectedPackageId/.test(service),
  'live return labels use a carrier package code, never PrepShip internal package inventory ids',
);

// ── 5. labelUrl normalization ──
assert(
  /extractShipstationLabelUrl/.test(service),
  'labelUrl is normalized through extractShipstationLabelUrl before persisting',
);

// ── 6. Client-safe result omits carrier/service/provider/selected-rate ──
// Locate the ClientSafeReturnResult type block and the toClientSafeResult
// builder; neither may reference the forbidden identifiers.
// Slice from a declaration's start up to (and including) the first line that is
// a lone `}` at column 0 — the function/type terminator. This keeps the block
// scoped to its own declaration so a later function that legitimately handles
// carrier/service fields (e.g. persistReturnShipment) never bleeds in.
function sliceBlock(src, startRe) {
  const m = src.match(startRe);
  if (!m) return '';
  const start = m.index ?? 0;
  const rest = src.slice(start);
  const endRel = rest.search(/\n\}/);
  return endRel === -1 ? rest.slice(0, 1200) : rest.slice(0, endRel + 2);
}
const resultType = sliceBlock(service, /export type ClientSafeReturnResult\s*=/);
assert(resultType.length > 0, 'ClientSafeReturnResult type is exported');
const forbidden = ['carrierCode', 'serviceCode', 'providerAccountId', 'selectedRateJson'];
for (const id of forbidden) {
  assert(
    !new RegExp(`${id}`).test(resultType),
    `ClientSafeReturnResult type never exposes ${id}`,
  );
}
const builder = sliceBlock(service, /function toClientSafeResult\s*\(/);
assert(builder.length > 0, 'toClientSafeResult builder exists');
for (const id of forbidden) {
  assert(
    !new RegExp(`${id}`).test(builder),
    `the client-safe result object never sets ${id}`,
  );
}
// The client-safe result exposes only the whitelisted fields. CP-036 keeps the
// customer-facing return amount intent-named; the generic `price` field is not
// allowed on the client contract.
for (const field of ['returnCustomerShippingRate', 'trackingNumber', 'trackingStatus', 'returnShipmentId', 'createdAt']) {
  assert(
    new RegExp(field).test(resultType),
    `ClientSafeReturnResult exposes the whitelisted field ${field}`,
  );
}
assert(
  !/\bprice\s*:/.test(resultType) && !/\bprice\s*:/.test(builder),
  'ClientSafeReturnResult never exposes the generic price field',
);
assert(
  /pdfAvailable/.test(resultType) || /labelAvailable/.test(resultType),
  'ClientSafeReturnResult exposes label/PDF availability (boolean, not a URL/provider)',
);

// ── 6b. PS-437: PrepShip owns customer shipping money ──
assert(
  /freezePrepShipCustomerShippingMoney/.test(service),
  'the client price is frozen by the PrepShip source-of-truth boundary',
);
assert(
  !/resolveReturnPostageRate|resolveReturnCustomerPrice|computeCustomerReturnPrice/.test(service),
  'the Client Portal return service contains no customer pricing formula',
);
assert(
  !/function computeCustomerReturnPrice/.test(service),
  'the raw-cost pricer (computeCustomerReturnPrice) is removed in favour of the policy helper',
);
// Label creation computes the customer rate once, then freezes that exact value
// on the return workflow for every downstream reader.
assert(
  /const returnCustomerShippingRate = await resolveReturnCustomerRateForShipment\(/.test(service) &&
    /returnCustomerShippingRate:\s*returnCustomerShippingRate\.toFixed\(2\)/.test(service) &&
    /returnCustomerShippingRate,\s*\n\s*trackingNumber: created\.trackingNumber/.test(service),
  'label creation delegates once and persists/returns the same frozen customer rate',
);

// ── 7. Admin-override audit path ──
assert(
  /adminOverride/.test(service),
  'an admin-override branch exists for a second active return',
);
assert(
  /adminOverrideBy/.test(service) && /adminOverrideReason/.test(service),
  'the admin override is audited (records who + why: adminOverrideBy / adminOverrideReason)',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-returns-label'] ===
    'node scripts/client-portal-returns-label-guard.mjs',
  'package.json exposes test:client-portal-returns-label',
);

if (failed) process.exit(1);
console.log('\nCP-027 returns-label service guard passed.');
