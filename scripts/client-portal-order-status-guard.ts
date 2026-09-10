import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP order fulfillment status guard (CP-069 shipped-display contract).
//
// Pins the backend-owned order fulfillment status (Awaiting shipment / Shipped /
// Cancelled / Voided) the Client Portal Orders table and order detail render, and
// proves the shadow-renderer / SOT boundary:
//   1. resolveOrderFulfillmentStatus is the ONE owner — exercised against the CP-069
//      acceptance matrix over the 6-field signal shape (PrepShip effective lifecycle
//      → customer bucket → shipped-label display state). Carrier telemetry, tracking-number
//      presence and ship dates are NOT inputs.
//   2. The order DTO delegates to the resolver (never hand-derives the status) and feeds it
//      the canonical columns + OUTBOUND row signals.
//   3. The read-model supplies those signals from the shared PrepShip aggregate fragment
//      (hasActiveOutboundShipmentSql / hasVoidedOutboundShipmentSql over
//      orderOutboundShipmentMatchSql — is_return excluded, order_number fallback tenant-scoped).
//   4. The contract carries exactly the 4-value enum; Orders.tsx renders it through the ONE
//      shared fulfillmentStatusMeta map WITHOUT re-deriving the status in React.
//   5. The resolver never touches carrier/service identity or tracking telemetry (CP-009 safe).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';

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
  return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
}
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

// ── 1. Acceptance matrix against the REAL resolver ──
const { resolveOrderFulfillmentStatus, ORDER_FULFILLMENT_STATUSES } = await import(
  '../src/lib/client-portal/order-status'
);
const lifecycle = await import('../src/lib/client-portal/order-lifecycle');
type Signals = Parameters<typeof resolveOrderFulfillmentStatus>[0];
type Status = ReturnType<typeof resolveOrderFulfillmentStatus>;
const BASE: Signals = {
  orderStatus: null,
  canonicalStatus: null,
  externallyShipped: false,
  externallyFulfilled: null,
  hasActiveOutboundShipment: false,
  hasVoidedOutboundShipment: false,
};
const S = (o: Partial<Signals>) => resolveOrderFulfillmentStatus({ ...BASE, ...o });

// [description, signals, expected] — every row of the CP-069 acceptance matrix that the
// order grain decides (shipment-grain rows live in the cp069 display guard / integration suite).
const MATRIX: Array<[string, Partial<Signals>, Status]> = [
  ['shipped order + active outbound row (tracking number missing or present) -> Shipped (active_label)', { orderStatus: 'shipped', hasActiveOutboundShipment: true }, 'shipped'],
  ['label-only: awaiting order + non-voided outbound row -> Awaiting shipment (a label never promotes)', { orderStatus: 'awaiting_shipment', hasActiveOutboundShipment: true }, 'pending'],
  ['cancelled order, no rows -> Cancelled', { orderStatus: 'cancelled' }, 'cancelled'],
  ['cancelled order + live (non-voided) outbound label -> Cancelled (tracking number still displayed)', { orderStatus: 'cancelled', hasActiveOutboundShipment: true }, 'cancelled'],
  ['cancelled + externally_shipped -> Cancelled (cancelled outranks every shipped signal)', { orderStatus: 'cancelled', externallyShipped: true }, 'cancelled'],
  ['cancelled + voided-only rows -> Cancelled', { orderStatus: 'cancelled', hasVoidedOutboundShipment: true }, 'cancelled'],
  ['voided only: shipped order whose outbound rows are all voided (externallyFulfilled null) -> Voided', { orderStatus: 'shipped', hasVoidedOutboundShipment: true }, 'voided'],
  ['voided only with raw externallyFulfilled=false -> Voided', { orderStatus: 'shipped', hasVoidedOutboundShipment: true, externallyFulfilled: false }, 'voided'],
  ['voided + active replacement label on the same shipped order -> Shipped (active_label wins)', { orderStatus: 'shipped', hasVoidedOutboundShipment: true, hasActiveOutboundShipment: true }, 'shipped'],
  ['externally shipped (awaiting locally), no rows -> Shipped (effective shipped / external_label)', { orderStatus: 'awaiting_shipment', externallyShipped: true }, 'shipped'],
  ['externally shipped + shipped locally, no rows -> Shipped', { orderStatus: 'shipped', externallyShipped: true }, 'shipped'],
  ['externally_shipped override + voided-only rows, externallyFulfilled not true -> Voided (#1298: voided_label beats the override flag)', { orderStatus: 'shipped', externallyShipped: true, hasVoidedOutboundShipment: true }, 'voided'],
  ['externally fulfilled marketplace label (raw.externallyFulfilled=true) + stale voided row -> Shipped (#1298)', { orderStatus: 'shipped', externallyFulfilled: true, hasVoidedOutboundShipment: true }, 'shipped'],
  [
    'raw.externallyFulfilled=true on an AWAITING order + voided row -> Awaiting shipment (display state only applies in the shipped bucket)',
    { orderStatus: 'awaiting_shipment', externallyFulfilled: true, hasVoidedOutboundShipment: true },
    'pending',
  ],
  ['shipped order with no shipment rows and not external (PS missing_shipment_sync) -> Shipped', { orderStatus: 'shipped' }, 'shipped'],
  ["canonical_status = 'cancelled' while order_status = 'shipped' with a live label -> Cancelled (PS cancelled upstream)", { orderStatus: 'shipped', canonicalStatus: 'cancelled', hasActiveOutboundShipment: true }, 'cancelled'],
  ["canonical_status = 'cancelled' while awaiting, no rows -> Cancelled", { orderStatus: 'awaiting_shipment', canonicalStatus: 'cancelled' }, 'cancelled'],
  ["canonical_status = 'cancelled' while awaiting + label row -> Cancelled", { orderStatus: 'awaiting_shipment', canonicalStatus: 'cancelled', hasActiveOutboundShipment: true }, 'cancelled'],
  ["canonical_status = 'CANCELLED' (any case) -> Cancelled (lower() parity)", { orderStatus: 'awaiting_shipment', canonicalStatus: 'CANCELLED' }, 'cancelled'],
  ["canonical_status = 'shipped_pending_confirmation' + shipped -> Shipped", { orderStatus: 'shipped', canonicalStatus: 'shipped_pending_confirmation', hasActiveOutboundShipment: true }, 'shipped'],
  ["canonical_status = 'confirmation_failed' + shipped -> Shipped", { orderStatus: 'shipped', canonicalStatus: 'confirmation_failed', hasActiveOutboundShipment: true }, 'shipped'],
  [
    "canonical_status = 'shipped' on an AWAITING order -> Awaiting shipment (canonical shipped never promotes; verbatim PrepShip CASE)",
    { orderStatus: 'awaiting_shipment', canonicalStatus: 'shipped', hasActiveOutboundShipment: true },
    'pending',
  ],
  ["order_status 'Shipped' (mixed case) -> Shipped (lower() parity)", { orderStatus: 'Shipped', hasActiveOutboundShipment: true }, 'shipped'],
  ['reopened order: awaiting_shipment with voided-only rows (PS voided the last label) -> Awaiting shipment, NOT Voided', { orderStatus: 'awaiting_shipment', hasVoidedOutboundShipment: true }, 'pending'],
  ['on_hold -> Awaiting shipment (pending = complement bucket)', { orderStatus: 'on_hold' }, 'pending'],
  ['on_hold + active label -> Awaiting shipment', { orderStatus: 'on_hold', hasActiveOutboundShipment: true }, 'pending'],
  ['awaiting_payment -> Awaiting shipment', { orderStatus: 'awaiting_payment' }, 'pending'],
  ['pending_fulfillment -> Awaiting shipment', { orderStatus: 'pending_fulfillment' }, 'pending'],
  ["'refunded' (not PrepShip vocabulary) -> Awaiting shipment, exactly as PrepShip buckets it", { orderStatus: 'refunded' }, 'pending'],
  ["US-spelled 'canceled' (not PrepShip vocabulary) -> Awaiting shipment (no portal-only cancelled arm)", { orderStatus: 'canceled' }, 'pending'],
  ['null order_status -> Awaiting shipment', { orderStatus: null }, 'pending'],
  ["'' order_status -> Awaiting shipment", { orderStatus: '' }, 'pending'],
  ['undefined order_status / canonical_status / externally_shipped -> Awaiting shipment', { orderStatus: undefined, canonicalStatus: undefined, externallyShipped: undefined }, 'pending'],
  ['externally_shipped null is not shipped', { orderStatus: 'awaiting_shipment', externallyShipped: null }, 'pending'],
  ["' shipped' (padded) is NOT shipped — no trim, exactly like the SQL", { orderStatus: ' shipped', hasActiveOutboundShipment: true }, 'pending'],
  ['shipped + voided + externally_shipped + raw externallyFulfilled=true -> Shipped', { orderStatus: 'shipped', externallyShipped: true, externallyFulfilled: true, hasVoidedOutboundShipment: true }, 'shipped'],
  ['empty/unknown signals -> Awaiting shipment', {}, 'pending'],
  // PS order-lifecycle-status.ts:93-165 precedence: the shipped-label display state is consulted
  // ONLY when the LOCAL order_status is shipped, after the canonical confirmation states.
  [
    'externally shipped (awaiting locally) + voided-only rows -> Shipped (PS externally_shipped, never voided_label off a non-shipped local status)',
    { orderStatus: 'awaiting_shipment', externallyShipped: true, hasVoidedOutboundShipment: true },
    'shipped',
  ],
  [
    "canonical 'shipped_pending_confirmation' + shipped + voided-only -> Shipped (canonical confirmation state outranks voided_label)",
    { orderStatus: 'shipped', canonicalStatus: 'shipped_pending_confirmation', hasVoidedOutboundShipment: true },
    'shipped',
  ],
  ["canonical 'confirmation_failed' + shipped + voided-only -> Shipped", { orderStatus: 'shipped', canonicalStatus: 'confirmation_failed', hasVoidedOutboundShipment: true }, 'shipped'],
  ["canonical 'shipped' + shipped + voided-only -> Voided", { orderStatus: 'shipped', canonicalStatus: 'shipped', hasVoidedOutboundShipment: true }, 'voided'],
];
for (const [label, input, expected] of MATRIX) {
  const actual = S(input);
  check(actual === expected, `${label} [got ${actual}]`);
}
// Carrier telemetry and tracking-number presence are not inputs: extra legacy keys change nothing.
const telemetryProbe = {
  ...BASE,
  orderStatus: 'shipped',
  hasActiveOutboundShipment: true,
  activeTrackingStatus: 'delivered',
  deliveredAt: '2026-09-01T00:00:00Z',
  displayTrackingNumber: null,
} as unknown as Signals;
check(resolveOrderFulfillmentStatus(telemetryProbe) === 'shipped', 'delivered / in_transit carrier telemetry on a shipped order still renders Shipped (never Delivered / In Transit)');
check(
  resolveOrderFulfillmentStatus({ ...BASE, orderStatus: 'awaiting_shipment', hasActiveOutboundShipment: true, activeTrackingStatus: 'in_transit' } as unknown as Signals) === 'pending',
  'in_transit telemetry on an awaiting order does not promote it (Awaiting shipment)',
);
check(
  [...ORDER_FULFILLMENT_STATUSES].sort().join(',') === ['cancelled', 'pending', 'shipped', 'voided'].join(','),
  'exactly the four canonical statuses are exported (no in_transit / delivered)',
);
// The resolver is the composition of the two pinned PrepShip ports.
check(
  lifecycle.resolvePortalOrderFulfillmentBucket({ orderStatus: 'shipped', canonicalStatus: 'cancelled', externallyShipped: true }) === 'cancelled' &&
    lifecycle.resolveShippedLabelDisplayState({ externallyShipped: false, externallyFulfilled: null, hasActiveShipment: false, hasVoidedShipment: true }) === 'voided_label',
  'resolver composes resolvePortalOrderFulfillmentBucket + resolveShippedLabelDisplayState (order-lifecycle.ts)',
);

// ── 2. DTO delegates to the resolver (no hand-derived status) ──
const dto = read('src/lib/client-portal/dto.ts');
check(/import\s*\{\s*resolveOrderFulfillmentStatus\s*\}\s*from '\.\/order-status'/.test(dto), 'dto imports resolveOrderFulfillmentStatus');
check(/import\s*\{\s*rawExternallyFulfilled\s*\}\s*from '\.\/order-lifecycle'/.test(dto), 'dto imports rawExternallyFulfilled (raw externallyFulfilled read in TypeScript, never a SQL cast)');
check(/fulfillmentStatus:\s*resolveOrderFulfillmentStatus\(/.test(dto), 'toPortalOrderDto sets fulfillmentStatus from the resolver');
check(!/fulfillmentStatus:\s*['"`]/.test(dto), 'dto never hard-codes a literal fulfillmentStatus value');
const resolverCall = /fulfillmentStatus:\s*resolveOrderFulfillmentStatus\(\{[\s\S]*?\}\)/.exec(dto)?.[0] ?? '';
check(
  resolverCall.includes('orderStatus: row.orderStatus') &&
    resolverCall.includes('canonicalStatus: row.canonicalStatus') &&
    resolverCall.includes('externallyShipped: row.externallyShipped === true') &&
    resolverCall.includes('externallyFulfilled: rawExternallyFulfilled(row.raw)') &&
    resolverCall.includes('hasActiveOutboundShipment: row.hasActiveOutboundShipment') &&
    resolverCall.includes('hasVoidedOutboundShipment: row.hasVoidedOutboundShipment'),
  'dto feeds the resolver the 6 canonical signals (order_status, canonical_status, externally_shipped, raw externallyFulfilled, active/voided OUTBOUND rows)',
);
check(
  !/activeTrackingStatus|trackingStatus/.test(stripComments(dto).slice(0, stripComments(dto).indexOf('export function toPortalShipmentDto'))),
  'the order DTO row type and resolver call carry no carrier tracking status',
);
check(!/hasActiveShipment\??:|hasVoidedShipment\??:/.test(dto), 'the pre-CP-069 hasActiveShipment / hasVoidedShipment row fields are gone (OUTBOUND-named signals only)');

// ── 3. Read-model supplies the canonical OUTBOUND-shipment signals ──
const readModel = read('src/lib/client-portal/read-models/orders.ts');
const readModelCode = stripComments(readModel);
// PS-486 shares ONE projection (order-fulfillment-signals.ts) between the list, the detail
// and the transactional return-request recheck; CP-069 makes that projection the OUTBOUND
// aggregate signals from order-lifecycle.ts and nothing else.
const signalsModule = stripComments(read('src/lib/client-portal/order-fulfillment-signals.ts'));
check(
  /import\s*\{[^}]*orderOutboundShipmentMatchSql[^}]*\}\s*from '\.\.\/order-lifecycle'/.test(readModel) &&
    readModel.includes("from '../order-fulfillment-signals'"),
  'read-model imports the shared PrepShip aggregate fragment and the PS-486 signal projection',
);
check(
  (readModelCode.match(/\.\.\.orderFulfillmentSignalSelects\(\)/g) ?? []).length === 2,
  'list AND detail delegate the shipment signals to the ONE PS-486 projection',
);
check(
  signalsModule.includes('hasActiveOutboundShipment: hasActiveOutboundShipmentSql()') &&
    signalsModule.includes('hasVoidedOutboundShipment: hasVoidedOutboundShipmentSql()') &&
    !/tracking_status|activeTrackingStatus|hasActiveShipment\b|hasVoidedShipment\b/.test(signalsModule),
  'the shared projection is exactly the two OUTBOUND signals from order-lifecycle.ts (no carrier tracking)',
);
const returnRequest = stripComments(read('src/services/return-request.ts'));
check(
  returnRequest.includes('...orderFulfillmentSignalSelects()') &&
    returnRequest.includes('canonicalStatus: orders.canonicalStatus') &&
    returnRequest.includes('externallyFulfilled: rawExternallyFulfilled(facts.raw)'),
  'the transactional return-request recheck reads the same six signals as the DTO badge',
);
check(
  (readModelCode.match(/orderOutboundShipmentMatchSql\('s'\)/g) ?? []).length === 2,
  'the tracking-number and carrier-code subqueries use the same orderOutboundShipmentMatchSql row set',
);
check(
  !/tracking_status|activeTrackingStatus|hasActiveShipment\b|hasVoidedShipment\b/.test(readModelCode),
  'read-model reads no carrier tracking status and no un-scoped shipment-existence signal',
);
// Render the shared fragments: is_return excluded, order_number fallback tenant-scoped.
const dialect = new PgDialect({ casing: 'snake_case' });
const render = (expr: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(expr).sql;
const MATCH =
  '( (s.order_id = "orders"."id" or (s.order_id is null and s.order_number = "orders"."order_number" and s.client_id = "orders"."client_id")) and coalesce(s.is_return, false) = false )';
check(norm(render(lifecycle.orderOutboundShipmentMatchSql('s'))) === MATCH, 'orderOutboundShipmentMatchSql: order_id match OR client-scoped order_number fallback, AND is_return = false');
check(
  norm(render(lifecycle.hasActiveOutboundShipmentSql())) === `exists ( select 1 from shipments s where ${MATCH} and coalesce(s.voided, false) = false )`,
  'hasActiveOutboundShipmentSql = exists(outbound match AND voided = false)',
);
check(
  norm(render(lifecycle.hasVoidedOutboundShipmentSql())) === `exists ( select 1 from shipments s where ${MATCH} and coalesce(s.voided, false) = true )`,
  'hasVoidedOutboundShipmentSql = exists(outbound match AND voided = true)',
);
check(
  !/s\.order_number = "orders"\."order_number"\)/.test(render(lifecycle.orderOutboundShipmentMatchSql('s'))),
  'the order_number fallback is never used unscoped (tenant isolation)',
);

// ── 4. Frontend renders the enum, never derives it ──
const api = readActiveClientPortalApiSource();
const ordersContract = read('src/lib/client-portal/contracts/orders.ts');
const orders = read('portal-client/src/pages/Orders.tsx');
const statusLib = read('portal-client/src/lib/status.ts');
const panel = read('portal-client/src/components/OrderDetailPanel.tsx');
const badge = read('portal-client/src/components/OrderStatusBadge.tsx');
check(
  /export type PortalOrderFulfillmentStatus = 'pending' \| 'shipped' \| 'cancelled' \| 'voided';/.test(ordersContract) &&
    api.includes('fulfillmentStatus: PortalOrderFulfillmentStatus'),
  'PortalOrder declares exactly the 4-value fulfillmentStatus enum (pending | shipped | cancelled | voided)',
);
check(/header:\s*'Status'/.test(orders) && /status=\{o\.fulfillmentStatus\}/.test(orders), 'Orders table renders a Status column from fulfillmentStatus');
// PS-486: table and drawer share ONE badge component; CP-069: that component reads the ONE
// shared label map (fulfillmentStatusMeta) and carries no label map of its own.
check(
  orders.includes("import { OrderStatusBadge } from '@/components/OrderStatusBadge'") &&
    panel.includes("import { OrderStatusBadge } from '@/components/OrderStatusBadge'"),
  'Orders.tsx and OrderDetailPanel share the OrderStatusBadge component',
);
check(
  /import\s*\{[^}]*fulfillmentStatusMeta[^}]*\}\s*from '@\/lib\/status'/.test(badge) && /const meta = fulfillmentStatusMeta\(status\)/.test(badge),
  'OrderStatusBadge renders through the shared fulfillmentStatusMeta map',
);
check(!orders.includes('ORDER_STATUS_META') && !badge.includes('ORDER_STATUS_META'), 'no local status label map anywhere (one shared map in lib/status.ts)');
const fulfillmentMeta = statusLib.slice(statusLib.indexOf('const FULFILLMENT_STATUS_META'), statusLib.indexOf('const SHIPMENT_STATUS_META'));
for (const label of ['Awaiting shipment', 'Shipped', 'Cancelled', 'Voided']) {
  check(fulfillmentMeta.includes(`label: '${label}'`), `fulfillmentStatusMeta includes the label ${label}`);
}
check(
  !/['"`]In Transit['"`]|['"`]Delivered['"`]/.test(stripComments(fulfillmentMeta)) &&
    !/['"`]In Transit['"`]|['"`]Delivered['"`]/.test(stripComments(orders)) &&
    !/['"`]In Transit['"`]|['"`]Delivered['"`]/.test(stripComments(badge)),
  'no In Transit / Delivered label exists for an order (transitional legacy KEYS map to Shipped)',
);
check(panel.includes('<OrderStatusBadge status={o.fulfillmentStatus} />'), 'OrderDetailPanel renders the SAME OrderStatusBadge from o.fulfillmentStatus');
// The frontend must not RE-DERIVE the status: no assignment to fulfillmentStatus.
check(!/fulfillmentStatus\s*=[^=>]/.test(orders) && !/fulfillmentStatus\s*=[^=>]/.test(panel), 'Orders.tsx / OrderDetailPanel never assign/derive fulfillmentStatus (render-only)');
check(!/orderStatusMeta\(|o\.orderStatus\b/.test(orders) && !/orderStatusMeta\(|o\.orderStatus\b/.test(panel), 'Orders.tsx / OrderDetailPanel never render the raw orderStatus as a status');

// ── 5. Resolver is carrier/service-identity and telemetry free (CP-009 / CP-069) ──
const resolver = stripComments(read('src/lib/client-portal/order-status.ts'));
for (const forbidden of ['carrierCode', 'serviceCode', 'providerAccount', 'selectedRate', 'trackingStatus', 'tracking_status', 'deliveredAt', 'delivered_at', 'trackingNumber']) {
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
