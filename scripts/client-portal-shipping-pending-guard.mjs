import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// Client-portal "Customer Shipping Rate: Pending" guard.
//
// A shipped-but-not-yet-billed order/shipment shows a muted "Pending" (not a
// bare "—") in the Customer Shipping Rate column, so a not-yet-invoiced charge
// doesn't read as "no shipping". The PENDING decision is BACKEND-OWNED
// (dto.ts customerShippingRatePending): the frontend renders the flag via the
// shared ShippingRateCell — it never derives "pending" itself, and the cell
// never invents a shipping amount (money only shows for a real rate > 0).
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) =>
  fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '';

let failed = false;
function assert(cond, msg) {
  if (cond) console.log(`PASS ${msg}`);
  else {
    console.error(`FAIL ${msg}`);
    failed = true;
  }
}

const dto = read('src/lib/client-portal/dto.ts');
const api = readActiveClientPortalApiSource();
const cell = read('portal-client/src/components/ShippingRateCell.tsx');
const orders = read('portal-client/src/pages/Orders.tsx');
const shipments = read('portal-client/src/pages/Shipments.tsx');
const pkg = JSON.parse(read('package.json'));

// 1. Backend owns the pending flag for BOTH the order + shipment DTO.
assert(
  /customerShippingRatePending:\s*customerShippingRate == null && Boolean\(row\.hasActiveShipment\)/.test(dto),
  'order DTO derives customerShippingRatePending from a null rate + an active shipment',
);
assert(
  /customerShippingRatePending:\s*Boolean\([\s\S]*?options\.includeFinancials[\s\S]*?row\.shippingCost == null[\s\S]*?!row\.voided/.test(dto),
  'shipment DTO derives customerShippingRatePending from a null rate + a non-voided shipment',
);

// 2. Frontend types carry the flag (PortalOrder + PortalShipment).
assert(
  (api.match(/customerShippingRatePending\??:\s*boolean/g) ?? []).length >= 2,
  'PortalOrder + PortalShipment declare customerShippingRatePending',
);

// 3. The shared cell renders the flag and never invents an amount.
assert(cell.length > 0, 'ShippingRateCell component exists');
assert(/pending/.test(cell) && /Pending/.test(cell), 'ShippingRateCell renders a "Pending" state from the pending prop');
assert(
  /Number\.isFinite\(amount\) && amount > 0/.test(cell),
  'ShippingRateCell only shows money for a real rate (> 0), never an invented amount',
);

// 4. Both tables render the column via ShippingRateCell + pass the BACKEND flag
//    (the frontend never decides pending itself).
for (const [name, src] of [
  ['Orders', orders],
  ['Shipments', shipments],
]) {
  assert(
    /<ShippingRateCell/.test(src) && /pending=\{[^}]*customerShippingRatePending\}/.test(src),
    `${name} renders the rate via ShippingRateCell with the backend pending flag`,
  );
}

// 5. package.json wiring (also auto-discovered by run-guards).
assert(
  pkg.scripts?.['test:client-portal-shipping-pending'] === 'node scripts/client-portal-shipping-pending-guard.mjs',
  'package.json exposes test:client-portal-shipping-pending',
);

if (failed) process.exit(1);
console.log('\nClient-portal shipping-pending guard passed.');
