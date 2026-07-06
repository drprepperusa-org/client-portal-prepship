// CP-032 (supersedes CP-028) — return-delivery is PDF-ONLY.
//
// DJ's final return decision removed the CP-028 Shopify-native delivery path.
// This guard pins the PDF-only contract of the delivery resolver
// (src/services/return-delivery.ts):
//   1. resolveReturnDelivery ALWAYS returns 'manual_pdf' — there is no active
//      shopify_native decision.
//   2. deliverReturn touches NO store connector (no confirmShipment / Shopify
//      call) and creates/purchases NO label.
//   3. No live customer/marketplace notification exists in the active flow.
//   4. The CLIENT-SAFE result never carries carrier/service/provider/account/raw
//      identifiers — only method/status/pdf/tracking; PDF is always exposed.
//   5. The additive delivery columns still exist on the returns table + migration.
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
const schema = read('src/db/schema/returns.ts');
const pkg = JSON.parse(read('package.json'));

assert(service.length > 0, 'src/services/return-delivery.ts exists');

// ── 1. Resolver is PDF-only: always manual_pdf ──
assert(
  /export function resolveReturnDelivery\([^)]*\)\s*:\s*\{\s*method:\s*ReturnDeliveryMethod\s*\}\s*\{\s*return\s*\{\s*method:\s*'manual_pdf'\s*\}/.test(
    service.replace(/\n/g, ' ').replace(/\s+/g, ' '),
  ),
  "resolveReturnDelivery ALWAYS returns { method: 'manual_pdf' } (no active shopify_native decision)",
);
assert(
  /'manual_pdf'/.test(service),
  "the delivery service produces 'manual_pdf'",
);

// ── 2. No Shopify/native delivery in the active flow ──
// The active flow must not call a store connector or confirmShipment, and must
// not gate on the (now-dormant) Shopify flag or capability helper.
for (const bad of ['confirmShipment', 'resolveStoreConnector', 'isShopifyDeliveryCapable', 'RETURNS_SHOPIFY_DELIVERY']) {
  assert(!new RegExp(bad).test(service), `the PDF-only delivery service never references ${bad}`);
}
// It must NOT create/purchase a label either (PrepShip label is canonical).
assert(
  !/createLabel|purchaseLabel|buyLabel|mintLabel/.test(service),
  'the delivery service never creates/purchases a label (PrepShip label is canonical)',
);
// No live customer/marketplace notification exists in the active flow.
assert(
  !/notifyCustomer:\s*true/.test(service) && !/notifyMarketplace:\s*true/.test(service),
  'the delivery service never fires a live customer/marketplace notification',
);

// ── 3. deliverReturn exposes the PDF ──
assert(
  /deliverReturn/.test(service) && /pdfAvailable/.test(service) && /pdfUrl/.test(service),
  'deliverReturn returns a client-safe result that always carries pdfAvailable + pdfUrl',
);

// ── 4. Client-safe delivery result omits carrier/service/provider/account ──
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
  assert(!new RegExp(id).test(resultType), `ClientSafeDeliveryResult type never exposes ${id}`);
}
const builder = sliceBlock(service, /function toClientSafe\s*\(/);
assert(builder.length > 0, 'toClientSafe builder exists');
for (const id of forbidden) {
  assert(!new RegExp(id).test(builder), `the client-safe delivery object never sets ${id}`);
}
for (const field of ['deliveryMethod', 'deliveryStatus', 'pdfAvailable', 'pdfUrl', 'trackingNumber', 'trackingStatus']) {
  assert(new RegExp(field).test(resultType), `ClientSafeDeliveryResult exposes the whitelisted field ${field}`);
}
assert(!/\bprovider\s*:/.test(resultType), 'ClientSafeDeliveryResult never exposes a provider field');

// ── 5. Additive delivery columns on the returns table + migration ──
assert(
  /deliveryMethod:\s*text\(\)/.test(schema) &&
    /deliveryStatus:\s*text\(\)/.test(schema) &&
    /deliveryError:\s*text\(\)/.test(schema),
  'the returns table declares additive deliveryMethod / deliveryStatus / deliveryError text columns',
);
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
console.log('\nCP-032 return-delivery PDF-only guard passed.');
