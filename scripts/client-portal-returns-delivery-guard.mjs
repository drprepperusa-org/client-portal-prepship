// CP-028 — return-delivery resolver guard.
//
// Statically pins the safety + correctness invariants of the return-delivery
// resolver (src/services/return-delivery.ts) that decides how a PrepShip-created
// return label reaches the customer:
//   1. The RETURNS_SHOPIFY_DELIVERY env gate exists and defaults OFF.
//   2. The resolver picks 'shopify_native' ONLY when the store is Shopify-capable
//      AND the flag is on; otherwise 'manual_pdf'.
//   3. Shopify capability = a LIVE 'shipment.confirm' store connector (the stub
//      is 'registered_stub', so it is not capable) — resolved via the shared
//      resolveStoreConnector, defaulting to manual_pdf when undetectable.
//   4. Delivery NEVER lets Shopify mint its own label — it pushes OUR PrepShip
//      tracking (labelTracking / trackingNumber) via confirmShipment.
//   5. On any Shopify failure/unavailability it degrades to manual_pdf, records
//      deliveryStatus 'failed' + deliveryError, and keeps the PDF available.
//   6. No live customer/marketplace notification by default (notifyCustomer /
//      notifyMarketplace false).
//   7. The CLIENT-SAFE delivery result never carries carrier/service/provider/
//      account/raw identifiers — only method/status/pdf/tracking.
//   8. The additive delivery columns exist on the returns table + a migration.
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

const service = read('src/services/return-delivery.ts');
const envFile = read('src/lib/env.ts');
const schema = read('src/db/schema/returns.ts');
const pkg = JSON.parse(read('package.json'));

assert(service.length > 0, 'src/services/return-delivery.ts exists');

// ── 1. RETURNS_SHOPIFY_DELIVERY gate + default OFF ──
assert(
  /RETURNS_SHOPIFY_DELIVERY/.test(envFile),
  'env module declares the RETURNS_SHOPIFY_DELIVERY approval flag',
);
assert(
  /RETURNS_SHOPIFY_DELIVERY:\s*booleanFlag\(false\)/.test(envFile),
  'RETURNS_SHOPIFY_DELIVERY defaults to false (OFF) in the env module',
);
assert(
  /env\.RETURNS_SHOPIFY_DELIVERY/.test(service),
  'the delivery service reads env.RETURNS_SHOPIFY_DELIVERY to gate the Shopify path',
);

// ── 2. resolver: shopify_native ONLY when capable AND flagged ──
// The resolver condition must AND the flag with the Shopify-capability check and
// otherwise fall to manual_pdf.
assert(
  /env\.RETURNS_SHOPIFY_DELIVERY\s*&&\s*isShopifyDeliveryCapable\s*\(/.test(service),
  "resolver picks 'shopify_native' only when RETURNS_SHOPIFY_DELIVERY && isShopifyDeliveryCapable(...)",
);
assert(
  /'shopify_native'/.test(service) && /'manual_pdf'/.test(service),
  "the resolver returns one of 'shopify_native' | 'manual_pdf'",
);
assert(
  /:\s*'manual_pdf'/.test(service),
  "manual_pdf is the fallback branch of the resolver's ternary/decision",
);

// ── 3. Shopify capability = LIVE shipment.confirm store connector ──
assert(
  /resolveStoreConnector\s*\(/.test(service) && /'shipment\.confirm'/.test(service),
  "capability detection reuses resolveStoreConnector(..., 'shipment.confirm')",
);
assert(
  /implementation\.status\s*===\s*'live'/.test(service),
  'a store is Shopify-capable only when its connector implementation status is live (the stub is registered_stub)',
);
assert(
  /isShopifyDeliveryCapable/.test(service),
  'an isShopifyDeliveryCapable helper encapsulates the Shopify capability check',
);

// ── 4. PrepShip label is canonical — push OUR tracking, never let Shopify mint ──
assert(
  /confirmShipment\s*\(/.test(service),
  'shopify_native delivers via the existing store connector confirmShipment interface',
);
assert(
  /labelTracking/.test(service) && /trackingNumber/.test(service),
  'the Shopify path pushes OUR PrepShip return tracking (labelTracking / trackingNumber) so Shopify never mints its own label',
);
// It must NOT call any label-creation/purchase surface on the Shopify path.
assert(
  !/createLabel|purchaseLabel|buyLabel|mintLabel/.test(service),
  'the delivery service never creates/purchases a new label (PrepShip label is canonical)',
);

// ── 5. Graceful fallback: failure keeps PDF, records failed + deliveryError ──
assert(
  /catch\s*\(/.test(service),
  'the Shopify attempt is wrapped so any failure is caught (never blocks label access)',
);
assert(
  /'failed'/.test(service) && /deliveryError/.test(service),
  "a Shopify failure records deliveryStatus 'failed' + a deliveryError",
);
// On failure the method degrades back to manual_pdf.
{
  const failIdx = service.indexOf("'failed'");
  const manualNearFail = service.indexOf("persistDeliveryOutcome(returnId, 'manual_pdf', 'failed'");
  assert(
    manualNearFail !== -1,
    'a Shopify failure degrades to manual_pdf (persists manual_pdf + failed)',
  );
  assert(failIdx !== -1, "the failed status literal is present");
}
// PDF stays available regardless — pdfAvailable derives from the label PDF, and
// pdfUrl/pdfAvailable are always in the client-safe result.
assert(
  /pdfAvailable/.test(service) && /pdfUrl/.test(service),
  'the client-safe result always carries pdfAvailable + pdfUrl (PDF never blocked on Shopify failure)',
);

// ── 6. No live customer/marketplace notification by default ──
assert(
  /notifyCustomer:\s*false/.test(service) && /notifyMarketplace:\s*false/.test(service),
  'the Shopify confirmation sends notifyCustomer:false + notifyMarketplace:false (no live notification by default)',
);

// ── 7. Client-safe delivery result omits carrier/service/provider/account ──
// Slice the ClientSafeDeliveryResult type block + the toClientSafe builder and
// assert neither references a forbidden identifier.
function sliceBlock(src, startRe) {
  const m = src.match(startRe);
  if (!m) return '';
  const start = m.index ?? 0;
  const rest = src.slice(start);
  const endRel = rest.search(/\n\}/);
  return endRel === -1 ? rest.slice(0, 1200) : rest.slice(0, endRel + 2);
}
const resultType = sliceBlock(service, /export type ClientSafeDeliveryResult\s*=/);
assert(resultType.length > 0, 'ClientSafeDeliveryResult type is exported');
const forbidden = [
  'carrierCode',
  'serviceCode',
  'carrierProvider',
  'providerAccountId',
  'providerAccount',
  'carrierAccountId',
  'selectedRateJson',
];
for (const id of forbidden) {
  assert(
    !new RegExp(id).test(resultType),
    `ClientSafeDeliveryResult type never exposes ${id}`,
  );
}
const builder = sliceBlock(service, /function toClientSafe\s*\(/);
assert(builder.length > 0, 'toClientSafe builder exists');
for (const id of forbidden) {
  assert(
    !new RegExp(id).test(builder),
    `the client-safe delivery object never sets ${id}`,
  );
}
// The client-safe result exposes exactly the whitelisted fields.
for (const field of [
  'deliveryMethod',
  'deliveryStatus',
  'pdfAvailable',
  'pdfUrl',
  'trackingNumber',
  'trackingStatus',
]) {
  assert(
    new RegExp(field).test(resultType),
    `ClientSafeDeliveryResult exposes the whitelisted field ${field}`,
  );
}
// The result must NOT expose a generic 'provider' field name either.
assert(
  !/\bprovider\s*:/.test(resultType),
  'ClientSafeDeliveryResult never exposes a provider field',
);

// ── 8. Additive delivery columns on the returns table + migration ──
assert(
  /deliveryMethod:\s*text\(\)/.test(schema) &&
    /deliveryStatus:\s*text\(\)/.test(schema) &&
    /deliveryError:\s*text\(\)/.test(schema),
  'the returns table declares additive deliveryMethod / deliveryStatus / deliveryError text columns',
);

// A migration adds the three columns to "returns" (additive ALTER ... ADD COLUMN).
const drizzleDir = path.join(root, 'drizzle');
const migrationSql = fs.existsSync(drizzleDir)
  ? fs
      .readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => fs.readFileSync(path.join(drizzleDir, f), 'utf8'))
      .join('\n')
  : '';
assert(
  /ALTER TABLE "returns" ADD COLUMN "delivery_method"/.test(migrationSql) &&
    /ALTER TABLE "returns" ADD COLUMN "delivery_status"/.test(migrationSql) &&
    /ALTER TABLE "returns" ADD COLUMN "delivery_error"/.test(migrationSql),
  'an additive migration adds delivery_method / delivery_status / delivery_error to "returns"',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-returns-delivery'] ===
    'node scripts/client-portal-returns-delivery-guard.mjs',
  'package.json exposes test:client-portal-returns-delivery',
);

if (failed) process.exit(1);
console.log('\nCP-028 return-delivery resolver guard passed.');
