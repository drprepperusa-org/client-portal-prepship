// CP order fulfillment status guard.
//
// Pins the backend-owned order fulfillment status (Pending / In Transit /
// Delivered / Cancelled / Voided) the Client Portal Orders table renders, and
// proves the shadow-renderer / SOT boundary:
//   1. resolveOrderFulfillmentStatus is the ONE owner — exercised against an
//      acceptance matrix (precedence cancelled > voided > delivered >
//      in_transit > pending; "Shipped = In Transit").
//   2. The order DTO delegates to the resolver (never hand-derives the status).
//   3. The read-model supplies the canonical shipment signals (tracking status +
//      active/voided existence) — the resolver inputs come from the DB.
//   4. The frontend PortalOrder type carries the 5-value enum and Orders.tsx
//      renders it via a label map WITHOUT re-deriving the status in React.
//   5. The resolver never touches carrier/service identity (CP-009 safe).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failed = false;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    console.error(`FAIL: ${msg}`);
    failed = true;
  }
}
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// ── 1. Acceptance matrix against the REAL resolver ──
const { resolveOrderFulfillmentStatus, ORDER_FULFILLMENT_STATUSES } = await import(
  '../src/lib/client-portal/order-status'
);
type Signals = Parameters<typeof resolveOrderFulfillmentStatus>[0];
const S = (o: Partial<Signals>) =>
  resolveOrderFulfillmentStatus({
    orderStatus: null,
    activeTrackingStatus: null,
    hasActiveShipment: false,
    hasVoidedShipment: false,
    ...o,
  });

check(S({ orderStatus: 'cancelled' }) === 'cancelled', 'cancelled order -> cancelled');
check(S({ orderStatus: 'canceled' }) === 'cancelled', 'US-spelled canceled -> cancelled');
check(S({ orderStatus: 'refunded' }) === 'cancelled', 'refunded order -> cancelled (matches cost-summary treatment)');
check(
  S({ orderStatus: 'cancelled', hasActiveShipment: true, activeTrackingStatus: 'delivered' }) === 'cancelled',
  'cancelled precedence beats a delivered shipment',
);
check(
  S({ orderStatus: 'shipped', hasVoidedShipment: true, hasActiveShipment: false }) === 'voided',
  'voided label + no active shipment -> voided',
);
check(
  S({ orderStatus: 'shipped', hasVoidedShipment: true, hasActiveShipment: true }) === 'in_transit',
  'voided + active replacement -> in_transit (not voided)',
);
check(S({ hasActiveShipment: true, activeTrackingStatus: 'delivered' }) === 'delivered', 'active delivered tracking -> delivered');
check(S({ hasActiveShipment: true, activeTrackingStatus: 'in_transit' }) === 'in_transit', 'active in_transit tracking -> in_transit');
check(S({ hasActiveShipment: true, activeTrackingStatus: 'pre_transit' }) === 'in_transit', 'pre_transit -> in_transit');
check(
  S({ hasActiveShipment: true, activeTrackingStatus: null }) === 'in_transit',
  'active label, no carrier scan yet -> in_transit (Shipped = In Transit)',
);
check(S({ orderStatus: 'shipped', hasActiveShipment: false }) === 'in_transit', 'order marked shipped, no shipment row -> in_transit');
check(S({ orderStatus: 'awaiting_shipment' }) === 'pending', 'awaiting_shipment -> pending');
check(S({ orderStatus: 'on_hold' }) === 'pending', 'on_hold -> pending');
check(S({}) === 'pending', 'empty/unknown signals -> pending');
check(
  [...ORDER_FULFILLMENT_STATUSES].sort().join(',') === ['cancelled', 'delivered', 'in_transit', 'pending', 'voided'].join(','),
  'exactly the five canonical statuses are exported',
);

// ── 2. DTO delegates to the resolver (no hand-derived status) ──
const dto = read('src/lib/client-portal/dto.ts');
check(/import\s*\{\s*resolveOrderFulfillmentStatus\s*\}\s*from '\.\/order-status'/.test(dto), 'dto imports resolveOrderFulfillmentStatus');
check(/fulfillmentStatus:\s*resolveOrderFulfillmentStatus\(/.test(dto), 'toPortalOrderDto sets fulfillmentStatus from the resolver');
check(!/fulfillmentStatus:\s*['"`]/.test(dto), 'dto never hard-codes a literal fulfillmentStatus value');

// ── 3. Read-model supplies the canonical shipment signals ──
const readModel = read('src/lib/client-portal/read-models/orders.ts');
for (const sig of ['activeTrackingStatus', 'hasActiveShipment', 'hasVoidedShipment']) {
  check(readModel.includes(sig), `read-model provides the ${sig} signal`);
}
check(/tracking_status\s+from\s+shipments/.test(readModel), 'active tracking status comes from shipments.tracking_status');
check(/coalesce\(s\.voided, false\) = true/.test(readModel), 'voided-shipment existence read from shipments.voided');
// Tenant isolation: the order_number fallback (for order_id-null shipments) must
// be scoped to the same client, or a shared order number could surface another
// client's shipment status. The exact order_id match stays unconditional.
check(
  !readModel.includes('s.order_number = ${orders.orderNumber})'),
  'the order_number fallback is never used unscoped (no bare order_number match)',
);
check(
  (readModel.match(/s\.order_number = \$\{orders\.orderNumber\} and s\.client_id = \$\{orders\.clientId\}/g) ?? []).length >= 6,
  'every shipment-signal subquery scopes the order_number fallback by client_id (tenant isolation)',
);

// ── 4. Frontend renders the enum, never derives it ──
const api = read('portal-client/src/lib/api.ts');
const orders = read('portal-client/src/pages/Orders.tsx');
check(
  /fulfillmentStatus:\s*'pending'\s*\|\s*'in_transit'\s*\|\s*'delivered'\s*\|\s*'cancelled'\s*\|\s*'voided'/.test(api),
  'PortalOrder declares the 5-value fulfillmentStatus enum',
);
check(/header:\s*'Status'/.test(orders) && /status=\{o\.fulfillmentStatus\}/.test(orders), 'Orders table renders a Status column from fulfillmentStatus');
for (const label of ['Pending', 'In Transit', 'Delivered', 'Cancelled', 'Voided']) {
  check(orders.includes(`'${label}'`), `Orders status label map includes ${label}`);
}
// The frontend must not RE-DERIVE the status: no assignment to fulfillmentStatus.
check(!/fulfillmentStatus\s*=[^=]/.test(orders), 'Orders.tsx never assigns/derives fulfillmentStatus (render-only)');

// ── 5. Resolver is carrier/service-identity free (CP-009) ──
const resolver = read('src/lib/client-portal/order-status.ts');
for (const forbidden of ['carrierCode', 'serviceCode', 'providerAccount', 'selectedRate']) {
  check(!resolver.includes(forbidden), `order-status resolver never references ${forbidden}`);
}

// ── package.json wiring ──
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-order-status'] === 'tsx scripts/client-portal-order-status-guard.ts',
  'package.json exposes test:client-portal-order-status',
);
console.log('ok: package.json exposes test:client-portal-order-status');

if (failed) process.exit(1);
console.log('\nClient portal order-status guard passed.');
