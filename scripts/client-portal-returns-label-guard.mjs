// CP-027 — backend return-label service guard.
//
// Statically pins the safety + correctness invariants of the backend
// return-label service (src/services/returns.ts):
//   1. NO real postage by default — the RETURNS_LIVE_LABELS env gate exists and
//      the OFFLINE MOCK path is the default (source 'test_offline', cost 0).
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
const pkg = JSON.parse(read('package.json'));

assert(service.length > 0, 'src/services/returns.ts exists');

// ── 1. RETURNS_LIVE_LABELS gate + offline-mock default ──
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
  /env\.RETURNS_LIVE_LABELS\s*&&\s*!\s*isTest/.test(service),
  'live purchase is gated on RETURNS_LIVE_LABELS && !isTest (the liveEligible condition)',
);
assert(
  /'test_offline'/.test(service),
  "the offline mock path persists source 'test_offline'",
);
assert(
  /generateMockLabelPdf/.test(service) && /saveMockLabel/.test(service),
  'the offline mock path reuses generateMockLabelPdf + saveMockLabel (no carrier call)',
);
// The offline branch is the DEFAULT: it runs whenever live purchase is not
// permitted, i.e. guarded by `if (!liveEligible)` BEFORE any live createLabel.
assert(
  /if\s*\(\s*!\s*liveEligible\s*\)/.test(service),
  'the offline mock path is the default (runs under `if (!liveEligible)`)',
);
{
  const offlineIdx = service.indexOf('if (!liveEligible)');
  const liveCallIdx = service.search(/carrierConnectors\.shipstation\.createLabel/);
  assert(
    offlineIdx !== -1 && liveCallIdx !== -1 && offlineIdx < liveCallIdx,
    'the offline branch precedes (and returns before) the live carrier createLabel call',
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

// ── 6b. CP-027 acceptance: customer price is BILLING-POLICY derived ──
// The client-facing return price must come from the SAME policy that generates
// the return_postage billing line (billing.ts resolveReturnPostageRate), so the
// quoted price equals the billed amount — one definition, no drift. The raw
// house/label cost must never be the client-facing price.
assert(
  /resolveReturnCustomerPrice/.test(service),
  'the client price is produced by resolveReturnCustomerPrice (policy-derived), not raw cost',
);
assert(
  /resolveReturnPostageRate/.test(service) && /from '\.\/billing'/.test(service),
  'resolveReturnCustomerPrice reuses billing.ts resolveReturnPostageRate (one shared definition, no drift)',
);
assert(
  !/function computeCustomerReturnPrice/.test(service),
  'the raw-cost pricer (computeCustomerReturnPrice) is removed in favour of the policy helper',
);
// Every client-price call site must pass through the policy helper with the
// client id, never a bare raw cost.
assert(
  /returnCustomerShippingRate:\s*await resolveReturnCustomerPrice\(/.test(service),
  'the client-safe returnCustomerShippingRate is awaited from resolveReturnCustomerPrice at the call sites',
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
