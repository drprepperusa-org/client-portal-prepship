import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-034 — Client Portal tracking links open REAL carrier sites, never 17track.
//
// Pins the invariant that shipment + return tracking links route to the official
// USPS / UPS / FedEx sites via a BACKEND-built trackingUrl — the frontend never
// builds a URL or a generic 17track link, and the carrier IDENTITY stays
// redacted (only the URL, whose destination is carrier-specific, crosses):
//   1. src/lib/tracking-url.ts is the single official-URL builder (USPS/UPS/FedEx).
//   2. labels-confirmation reuses it (no duplicate).
//   3. The shipment + return DTOs build trackingUrl backend-side; carrierCode
//      stays null on the wire.
//   4. The API types carry trackingUrl: string | null.
//   5. The Shipments + Returns pages render the backend trackingUrl and contain
//      ZERO 17track references (the old hardcoded helper is gone).
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

const helper = read('src/lib/tracking-url.ts');
const confirmation = read('src/services/labels-confirmation.ts');
const dto = read('src/lib/client-portal/dto.ts');
const returnsRoute = read('src/routes/client-portal/returns.ts');
const api = readActiveClientPortalApiSource();
const shipmentsPage = read('portal-client/src/pages/Shipments.tsx');
const returnsPage = [
  read('portal-client/src/pages/Returns.tsx'),
  read('portal-client/src/components/returns/ReturnDetailDrawer.tsx'),
  read('portal-client/src/components/returns/returnPresentation.ts'),
].join('\n');
const pkg = JSON.parse(read('package.json'));

// ── 1. Shared official-URL helper ──
assert(helper.length > 0, 'src/lib/tracking-url.ts exists');
assert(/export function trackingUrlForCarrier/.test(helper), 'tracking-url exports trackingUrlForCarrier');
assert(
  /tools\.usps\.com/.test(helper) && /ups\.com\/track/.test(helper) && /fedex\.com\/fedextrack/.test(helper),
  'the helper builds official USPS / UPS / FedEx tracking URLs',
);
assert(!/17track\.net/.test(helper), 'the helper never builds a 17track.net URL');
assert(
  /from '\.\.\/lib\/tracking-url'/.test(confirmation),
  'labels-confirmation REUSES the shared tracking-url helper (no duplicate definition)',
);

// ── 2. Backend DTOs build trackingUrl; carrier stays redacted ──
assert(/trackingUrlForCarrier\(/.test(dto), 'toPortalShipmentDto builds trackingUrl via trackingUrlForCarrier');
assert(/labelCarrier/.test(dto), 'the shipment DTO uses the canonical labelCarrier to build the URL');
assert(/carrierCode:\s*null/.test(dto), 'the shipment DTO STILL redacts carrierCode (null on the wire)');
assert(
  /trackingUrlForCarrier\(/.test(returnsRoute),
  'the returns route builds trackingUrl via trackingUrlForCarrier (list + detail)',
);

// ── 3. API types carry trackingUrl ──
assert(
  /interface PortalShipment[\s\S]*?trackingUrl: string \| null/.test(api),
  'PortalShipment declares trackingUrl: string | null',
);
assert(
  /interface PortalReturnRow[\s\S]*?trackingUrl: string \| null/.test(api),
  'PortalReturnRow declares trackingUrl: string | null',
);

// ── 4. Frontend: no 17track anywhere; render the backend trackingUrl ──
assert(!/17track\.net/.test(shipmentsPage), 'Shipments.tsx has ZERO 17track.net URLs');
assert(!/17track\.net/.test(returnsPage), 'Returns.tsx has ZERO 17track.net URLs');
assert(
  /s\.trackingUrl/.test(shipmentsPage) && /selected\.trackingUrl/.test(shipmentsPage),
  'Shipments.tsx renders the backend s.trackingUrl + selected.trackingUrl',
);
assert(
  /row\.trackingUrl/.test(returnsPage) && /detail\.trackingUrl/.test(returnsPage),
  'Returns.tsx renders the backend r.trackingUrl + d.trackingUrl',
);
assert(
  !/function trackingUrl\s*\(/.test(shipmentsPage),
  'Shipments.tsx no longer defines a hardcoded frontend trackingUrl() helper',
);
assert(
  !/function trackingUrl\s*\(/.test(returnsPage),
  'Returns.tsx no longer defines a hardcoded frontend trackingUrl() helper',
);

// ── package.json wiring ──
assert(
  pkg.scripts?.['test:client-portal-returns-tracking-url'] ===
    'node scripts/client-portal-returns-tracking-url-guard.mjs',
  'package.json exposes test:client-portal-returns-tracking-url',
);

if (failed) process.exit(1);
console.log('\nCP-034 client-portal tracking-url guard passed.');
