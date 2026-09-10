// CP-069 — the shipped-display contract guard.
//
// The Client Portal is a shadow renderer of PrepShip: a customer-facing "Shipped" must come from
// PrepShip's own fulfillment evidence (orders.order_status / canonical_status / externally_shipped,
// raw.externallyFulfilled, and the OUTBOUND shipment rows' voided truth) — never carrier
// telemetry, tracking-number presence, ship dates or elapsed time. This guard proves three
// things without a database:
//
//   (a) the pure TypeScript twins (resolveOrderLifecycleEffectiveStatus,
//       resolvePortalOrderFulfillmentBucket, resolveOrderFulfillmentStatus) over every scenario
//       of the CP-069 acceptance matrix, plus cross-product invariants tying the three together;
//   (b) the drizzle SQL of orderLifecycleEffectiveStatusSql() / AliasSql('o') renders
//       byte-for-byte (whitespace-normalised) to PrepShip's CASE — the expression PS 0057 builds
//       orders_effective_status_date_id_idx on — and the bucket / tab predicates / shipment
//       status / outbound fragments render to their pinned shapes on top of it;
//   (c) static pins: no "In Transit" / "Delivered" label on any outbound surface, no
//       deliveredAt / shipmentStatusDetail on the shipment contract, both shipment surfaces use
//       outboundShipmentPredicate + portalShipmentStatusSql + a left-joined orders row, the order
//       read-model reads no tracking_status and matches rows through orderOutboundShipmentMatchSql,
//       no SQL ::boolean cast of raw externallyFulfilled, the frontend never assigns a status or
//       renders the raw orderStatus, no outbound refresh caller, transitional bridges carry their
//       removal marker, the Orders route whitelists ?status (400 otherwise), and the parity
//       scripts are denied from the static-guard runner.
//
// Companion proofs: scripts/integration/client-portal-orders-fulfillment-cp069.integration.ts
// (real Postgres) and scripts/integration/client-portal-order-lifecycle-parity.ts (PrepShip's real
// functions, sibling checkout lane).
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
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const lifecycle = await import('../src/lib/client-portal/order-lifecycle');
const { resolveOrderFulfillmentStatus, ORDER_FULFILLMENT_STATUSES } = await import('../src/lib/client-portal/order-status');
const shipmentStatus = await import('../src/lib/client-portal/shipment-status');
const { PORTAL_SHIPMENT_STATUSES } = await import('../src/lib/client-portal/contracts/shipments');
const { shipmentIsCustomerShippingEligibleSql } = await import('../src/lib/client-portal/customer-shipping-rate');

// ══════════════════════════════════════════════════════════════════════════════════════════
// (a) Pure resolver matrix
// ══════════════════════════════════════════════════════════════════════════════════════════
type Signals = Parameters<typeof resolveOrderFulfillmentStatus>[0];
type Lifecycle = Parameters<typeof lifecycle.resolveOrderLifecycleEffectiveStatus>[0];
type Status = ReturnType<typeof resolveOrderFulfillmentStatus>;
type Bucket = ReturnType<typeof lifecycle.resolvePortalOrderFulfillmentBucket>;
const BASE: Signals = {
  orderStatus: null,
  canonicalStatus: null,
  externallyShipped: false,
  externallyFulfilled: null,
  hasActiveOutboundShipment: false,
  hasVoidedOutboundShipment: false,
};
const lifecycleOf = (s: Signals): Lifecycle => ({
  orderStatus: s.orderStatus,
  canonicalStatus: s.canonicalStatus,
  externallyShipped: s.externallyShipped,
});

// [label, signals, effective, bucket, status]
const MATRIX: Array<[string, Partial<Signals>, string, Bucket, Status]> = [
  ['shipped + active outbound row (missing tracking number)', { orderStatus: 'shipped', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ['shipped + active row, stale / in_transit / delivered telemetry (not an input)', { orderStatus: 'shipped', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ['label-only: awaiting + non-voided outbound row', { orderStatus: 'awaiting_shipment', hasActiveOutboundShipment: true }, 'awaiting_shipment', 'pending', 'pending'],
  ['cancelled, no rows', { orderStatus: 'cancelled' }, 'cancelled', 'cancelled', 'cancelled'],
  ['cancelled + live outbound label (synced on an already-cancelled order)', { orderStatus: 'cancelled', hasActiveOutboundShipment: true }, 'cancelled', 'cancelled', 'cancelled'],
  ['cancelled + externally_shipped', { orderStatus: 'cancelled', externallyShipped: true }, 'cancelled', 'cancelled', 'cancelled'],
  ['cancelled + voided-only rows', { orderStatus: 'cancelled', hasVoidedOutboundShipment: true }, 'cancelled', 'cancelled', 'cancelled'],
  ['voided only (PS-486 population): shipped, all outbound rows voided, externallyFulfilled null', { orderStatus: 'shipped', hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'voided'],
  ['voided only, externallyFulfilled false', { orderStatus: 'shipped', hasVoidedOutboundShipment: true, externallyFulfilled: false }, 'shipped', 'shipped', 'voided'],
  ['voided + active replacement label on the same shipped order', { orderStatus: 'shipped', hasVoidedOutboundShipment: true, hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ['multi-shipment: two active rows', { orderStatus: 'shipped', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ['externally shipped, awaiting locally, no rows', { orderStatus: 'awaiting_shipment', externallyShipped: true }, 'shipped', 'shipped', 'shipped'],
  ['externally shipped, shipped locally, no rows', { orderStatus: 'shipped', externallyShipped: true }, 'shipped', 'shipped', 'shipped'],
  ['externally_shipped override + voided-only, externallyFulfilled null (#1298 precedence)', { orderStatus: 'shipped', externallyShipped: true, hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'voided'],
  ['raw.externallyFulfilled = true + stale voided row (#1298)', { orderStatus: 'shipped', externallyFulfilled: true, hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ['raw.externallyFulfilled = true on an awaiting order + voided row', { orderStatus: 'awaiting_shipment', externallyFulfilled: true, hasVoidedOutboundShipment: true }, 'awaiting_shipment', 'pending', 'pending'],
  ['raw.externallyFulfilled = true, awaiting, no rows', { orderStatus: 'awaiting_shipment', externallyFulfilled: true }, 'awaiting_shipment', 'pending', 'pending'],
  ['shipped, no rows, not external (PS missing_shipment_sync)', { orderStatus: 'shipped' }, 'shipped', 'shipped', 'shipped'],
  ["canonical_status 'cancelled' + order_status shipped + live label (PS cancelled upstream)", { orderStatus: 'shipped', canonicalStatus: 'cancelled', hasActiveOutboundShipment: true }, 'cancelled', 'cancelled', 'cancelled'],
  ["canonical_status 'cancelled' + awaiting, no rows", { orderStatus: 'awaiting_shipment', canonicalStatus: 'cancelled' }, 'cancelled', 'cancelled', 'cancelled'],
  ["canonical_status 'cancelled' + awaiting + label row", { orderStatus: 'awaiting_shipment', canonicalStatus: 'cancelled', hasActiveOutboundShipment: true }, 'cancelled', 'cancelled', 'cancelled'],
  ["canonical_status 'cancelled' + externally_shipped", { orderStatus: 'awaiting_shipment', canonicalStatus: 'cancelled', externallyShipped: true }, 'cancelled', 'cancelled', 'cancelled'],
  ["canonical_status 'CANCELLED' (case-insensitive)", { orderStatus: 'awaiting_shipment', canonicalStatus: 'CANCELLED' }, 'cancelled', 'cancelled', 'cancelled'],
  ["canonical_status 'shipped_pending_confirmation' + shipped", { orderStatus: 'shipped', canonicalStatus: 'shipped_pending_confirmation', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ["canonical_status 'confirmation_failed' + shipped", { orderStatus: 'shipped', canonicalStatus: 'confirmation_failed', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ["canonical_status 'shipped' + shipped", { orderStatus: 'shipped', canonicalStatus: 'shipped', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ["canonical_status 'shipped' on an AWAITING order does not promote (verbatim PrepShip)", { orderStatus: 'awaiting_shipment', canonicalStatus: 'shipped', hasActiveOutboundShipment: true }, 'awaiting_shipment', 'pending', 'pending'],
  ["canonical_status 'awaiting_shipment' (outbox COALESCE-copied raw) + shipped", { orderStatus: 'shipped', canonicalStatus: 'awaiting_shipment' }, 'shipped', 'shipped', 'shipped'],
  ["order_status 'Shipped' (mixed case)", { orderStatus: 'Shipped', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ["order_status 'CANCELLED' (mixed case)", { orderStatus: 'CANCELLED' }, 'cancelled', 'cancelled', 'cancelled'],
  ['reopened: awaiting + voided-only rows (PS voided the last label)', { orderStatus: 'awaiting_shipment', hasVoidedOutboundShipment: true }, 'awaiting_shipment', 'pending', 'pending'],
  ['on_hold', { orderStatus: 'on_hold' }, 'on_hold', 'pending', 'pending'],
  ['on_hold + active label', { orderStatus: 'on_hold', hasActiveOutboundShipment: true }, 'on_hold', 'pending', 'pending'],
  ['awaiting_payment', { orderStatus: 'awaiting_payment' }, 'awaiting_payment', 'pending', 'pending'],
  ['pending_fulfillment', { orderStatus: 'pending_fulfillment' }, 'pending_fulfillment', 'pending', 'pending'],
  ["'refunded' (not PrepShip vocabulary) buckets as pending", { orderStatus: 'refunded' }, 'refunded', 'pending', 'pending'],
  ["'canceled' (US spelling, not PrepShip vocabulary) buckets as pending", { orderStatus: 'canceled' }, 'canceled', 'pending', 'pending'],
  ['null order_status', { orderStatus: null }, 'awaiting_shipment', 'pending', 'pending'],
  ["'' order_status", { orderStatus: '' }, 'awaiting_shipment', 'pending', 'pending'],
  ['undefined order_status / canonical_status / externally_shipped', { orderStatus: undefined, canonicalStatus: undefined, externallyShipped: undefined }, 'awaiting_shipment', 'pending', 'pending'],
  ['externally_shipped null is not shipped', { orderStatus: 'awaiting_shipment', externallyShipped: null }, 'awaiting_shipment', 'pending', 'pending'],
  ["' shipped' (padded) is not shipped — no trim, exactly like the SQL", { orderStatus: ' shipped', hasActiveOutboundShipment: true }, ' shipped', 'pending', 'pending'],
  ['shipped + voided + externally_shipped + raw externallyFulfilled = true', { orderStatus: 'shipped', externallyShipped: true, externallyFulfilled: true, hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ['future ship date / any date: not an input (shipped stays shipped)', { orderStatus: 'shipped', hasActiveOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  // PS order-lifecycle-status.ts:93-165 precedence: the display state only applies when the LOCAL
  // order_status is shipped, after the canonical confirmation states.
  [
    'externally shipped, awaiting locally, voided-only rows -> Shipped (PS externally_shipped; no voided_label off a non-shipped local status)',
    { orderStatus: 'awaiting_shipment', externallyShipped: true, hasVoidedOutboundShipment: true },
    'shipped', 'shipped', 'shipped',
  ],
  ['externally shipped, null local status, voided-only rows -> Shipped', { orderStatus: null, externallyShipped: true, hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  [
    "canonical 'shipped_pending_confirmation' + shipped + voided-only -> Shipped (canonical confirmation state outranks voided_label)",
    { orderStatus: 'shipped', canonicalStatus: 'shipped_pending_confirmation', hasVoidedOutboundShipment: true },
    'shipped', 'shipped', 'shipped',
  ],
  ["canonical 'confirmation_failed' + shipped + voided-only -> Shipped", { orderStatus: 'shipped', canonicalStatus: 'confirmation_failed', hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'shipped'],
  ["canonical 'shipped' + shipped + voided-only -> Voided (no canonical confirmation override)", { orderStatus: 'shipped', canonicalStatus: 'shipped', hasVoidedOutboundShipment: true }, 'shipped', 'shipped', 'voided'],
];
for (const [label, input, effective, bucket, status] of MATRIX) {
  const signals = { ...BASE, ...input };
  const gotEffective = lifecycle.resolveOrderLifecycleEffectiveStatus(lifecycleOf(signals));
  const gotBucket = lifecycle.resolvePortalOrderFulfillmentBucket(lifecycleOf(signals));
  const gotStatus = resolveOrderFulfillmentStatus(signals);
  check(
    gotEffective === effective && gotBucket === bucket && gotStatus === status,
    `matrix: ${label} -> effective=${effective} bucket=${bucket} status=${status} [got ${gotEffective}/${gotBucket}/${gotStatus}]`,
  );
}
check(
  resolveOrderFulfillmentStatus({ ...BASE, orderStatus: 'shipped', hasActiveOutboundShipment: true, activeTrackingStatus: 'delivered', deliveredAt: '2026-09-01' } as unknown as Signals) === 'shipped',
  'delivered telemetry passed as extra keys is ignored (never Delivered)',
);
check(
  [...ORDER_FULFILLMENT_STATUSES].join(',') === 'pending,shipped,cancelled,voided',
  'ORDER_FULFILLMENT_STATUSES = pending | shipped | cancelled | voided',
);

// PrepShip shipped-label display state precedence (verbatim port).
const D = lifecycle.resolveShippedLabelDisplayState;
check(D({ externallyShipped: false, externallyFulfilled: null, hasActiveShipment: true, hasExternalShipment: true, hasVoidedShipment: false }) === 'external_label', 'display state: active + external record -> external_label (PS-489)');
check(D({ externallyShipped: false, externallyFulfilled: null, hasActiveShipment: true, hasVoidedShipment: true }) === 'active_label', 'display state: active row wins -> active_label');
check(D({ externallyShipped: true, externallyFulfilled: null, hasActiveShipment: false, hasVoidedShipment: true }) === 'voided_label', 'display state: voided + not truly external -> voided_label (beats externally_shipped)');
check(D({ externallyShipped: false, externallyFulfilled: true, hasActiveShipment: false, hasVoidedShipment: true }) === 'external_label', 'display state: voided + raw externallyFulfilled=true -> external_label (#1298)');
check(D({ externallyShipped: true, externallyFulfilled: null, hasActiveShipment: false, hasVoidedShipment: false }) === 'external_label', 'display state: externally_shipped, no rows -> external_label');
check(D({ externallyShipped: false, externallyFulfilled: null, hasActiveShipment: false, hasVoidedShipment: false }) === 'missing_shipment_sync', 'display state: shipped with nothing -> missing_shipment_sync');
// raw externallyFulfilled is read in TypeScript as PrepShip's booleanOrNull.
check(lifecycle.rawExternallyFulfilled({ externallyFulfilled: true }) === true && lifecycle.rawExternallyFulfilled({ externallyFulfilled: false }) === false, 'rawExternallyFulfilled reads real JSON booleans');
check(
  lifecycle.rawExternallyFulfilled({ externallyFulfilled: 'true' }) === null &&
    lifecycle.rawExternallyFulfilled({ externallyFulfilled: 1 }) === null &&
    lifecycle.rawExternallyFulfilled({}) === null &&
    lifecycle.rawExternallyFulfilled(null) === null &&
    lifecycle.rawExternallyFulfilled('garbage') === null &&
    lifecycle.rawExternallyFulfilled([true]) === null,
  'rawExternallyFulfilled: strings / numbers / garbage / arrays / missing -> null (never throws, never truthy)',
);
check(lifecycle.booleanOrNull(true) === true && lifecycle.booleanOrNull('true') === null && lifecycle.booleanOrNull(undefined) === null, 'booleanOrNull: only a real boolean counts');

// Cross-product invariants: the three twins can never disagree with each other, and an
// independent transcription of the SQL CASE agrees with the TS twin on every input.
const ORDER_STATUSES = [null, undefined, '', 'awaiting_shipment', 'shipped', 'Shipped', 'cancelled', 'CANCELLED', 'on_hold', 'awaiting_payment', 'pending_fulfillment', 'refunded', 'canceled', ' shipped', 'delivered', 'in_transit'];
const CANONICAL_STATUSES = [null, undefined, '', 'shipped_pending_confirmation', 'shipped', 'confirmation_failed', 'cancelled', 'CANCELLED', 'awaiting_shipment'];
const TRI = [null, undefined, false, true] as const;
const refEffective = (o: unknown, c: unknown, e: unknown) => {
  const os = String(o ?? '').toLowerCase();
  const cs = String(c ?? '').toLowerCase();
  if (os === 'cancelled') return 'cancelled';
  if (cs === 'cancelled') return 'cancelled';
  if (os === 'shipped') return 'shipped';
  if (e === true) return 'shipped';
  return os === '' ? 'awaiting_shipment' : os;
};
let combos = 0;
let invariantFailures = 0;
for (const orderStatus of ORDER_STATUSES)
  for (const canonicalStatus of CANONICAL_STATUSES)
    for (const externallyShipped of TRI)
      for (const externallyFulfilled of TRI)
        for (const hasActiveOutboundShipment of [false, true])
          for (const hasVoidedOutboundShipment of [false, true]) {
            combos += 1;
            const signals: Signals = { orderStatus, canonicalStatus, externallyShipped, externallyFulfilled, hasActiveOutboundShipment, hasVoidedOutboundShipment };
            const effective = lifecycle.resolveOrderLifecycleEffectiveStatus(lifecycleOf(signals));
            const bucket = lifecycle.resolvePortalOrderFulfillmentBucket(lifecycleOf(signals));
            const status = resolveOrderFulfillmentStatus(signals);
            const expectedBucket = effective === 'cancelled' ? 'cancelled' : effective === 'shipped' ? 'shipped' : 'pending';
            // PrepShip resolveOrderLifecycleStatus (order-lifecycle-status.ts:93-165): the shipped-label
            // display state is consulted ONLY when the LOCAL order_status is 'shipped', after the
            // canonical confirmation states; externally_shipped on a non-shipped local status is
            // 'Externally shipped' (customer: Shipped), never voided_label.
            const localShipped = String(orderStatus ?? '').toLowerCase() === 'shipped';
            const canonicalLower = String(canonicalStatus ?? '').toLowerCase();
            const canonicalConfirmationState = canonicalLower === 'confirmation_failed' || canonicalLower === 'shipped_pending_confirmation';
            const voidedCase =
              bucket === 'shipped' && localShipped && !canonicalConfirmationState && !hasActiveOutboundShipment && hasVoidedOutboundShipment && externallyFulfilled !== true;
            const expectedStatus: Status = bucket === 'cancelled' ? 'cancelled' : bucket === 'pending' ? 'pending' : voidedCase ? 'voided' : 'shipped';
            const ok =
              effective === refEffective(orderStatus, canonicalStatus, externallyShipped) &&
              bucket === expectedBucket &&
              status === expectedStatus &&
              (ORDER_FULFILLMENT_STATUSES as readonly string[]).includes(status);
            if (!ok) {
              invariantFailures += 1;
              if (invariantFailures <= 5) console.error(`  invariant broke for ${JSON.stringify(signals)} -> ${effective}/${bucket}/${status}`);
            }
          }
check(invariantFailures === 0, `cross-product invariants hold over ${combos} signal combinations (effective -> bucket -> status; no telemetry input)`);

// ══════════════════════════════════════════════════════════════════════════════════════════
// (b) Rendered SQL parity with PrepShip's CASE (and everything built on it)
// ══════════════════════════════════════════════════════════════════════════════════════════
// The runtime db client renders with casing: 'snake_case' (src/db/client.ts), so the same
// dialect option is used here; with it the column references render exactly as PrepShip's
// checkout does, and exactly as PS 0057's orders_effective_status_date_id_idx expression.
const dialect = new PgDialect({ casing: 'snake_case' });
const render = (expr: Parameters<PgDialect['sqlToQuery']>[0]) => dialect.sqlToQuery(expr);
const sqlOf = (expr: Parameters<PgDialect['sqlToQuery']>[0]) => norm(render(expr).sql);

// prepship-v4 @ dfc6809e src/services/order-lifecycle-status.ts orderLifecycleEffectiveStatusSql
const EFF =
  `case when lower(coalesce("orders"."order_status", '')) = 'cancelled' then 'cancelled' ` +
  `when lower(coalesce("orders"."canonical_status", '')) = 'cancelled' then 'cancelled' ` +
  `when lower(coalesce("orders"."order_status", '')) = 'shipped' then 'shipped' ` +
  `when coalesce("orders"."externally_shipped", false) = true then 'shipped' ` +
  `else coalesce(nullif(lower("orders"."order_status"), ''), 'awaiting_shipment') end`;
// prepship-v4 orderLifecycleEffectiveStatusAliasSql('o') (aliasColumn renders raw `o.<column>`)
const EFF_O =
  `case when lower(coalesce(o.order_status, '')) = 'cancelled' then 'cancelled' ` +
  `when lower(coalesce(o.canonical_status, '')) = 'cancelled' then 'cancelled' ` +
  `when lower(coalesce(o.order_status, '')) = 'shipped' then 'shipped' ` +
  `when coalesce(o.externally_shipped, false) = true then 'shipped' ` +
  `else coalesce(nullif(lower(o.order_status), ''), 'awaiting_shipment') end`;
const BUCKET = `case when ${EFF} = 'cancelled' then 'cancelled' when ${EFF} = 'shipped' then 'shipped' else 'pending' end`;
const BUCKET_O = `case when ${EFF_O} = 'cancelled' then 'cancelled' when ${EFF_O} = 'shipped' then 'shipped' else 'pending' end`;
const MATCH =
  '( (s.order_id = "orders"."id" or (s.order_id is null and s.order_number = "orders"."order_number" and s.client_id = "orders"."client_id")) and coalesce(s.is_return, false) = false )';
const OUTBOUND = `( coalesce("shipments"."is_return", false) = false and coalesce("shipments"."source", '') <> 'replacement' )`;
const LINKED =
  `case when "orders"."id" is not null then ${BUCKET} ` +
  `when "shipments"."order_id" is null then ( select ${BUCKET_O} from orders o ` +
  `where o.order_number = "shipments"."order_number" and o.client_id = "shipments"."client_id" ` +
  `order by case when ${EFF_O} = 'shipped' then 0 else 1 end, o.id desc limit 1 ) else null end`;
const SHIP =
  `case when coalesce("shipments"."voided", false) then 'voided' ` +
  `when ${LINKED} = 'cancelled' then 'cancelled' ` +
  `when ${LINKED} = 'shipped' then 'shipped' ` +
  `when ${LINKED} is not null then 'label_created' else 'unavailable' end`;

const effectiveQuery = render(lifecycle.orderLifecycleEffectiveStatusSql());
check(norm(effectiveQuery.sql) === EFF && effectiveQuery.params.length === 0, "orderLifecycleEffectiveStatusSql renders PrepShip's CASE byte-for-byte (index-eligible: no bound params)");
const aliasQuery = render(lifecycle.orderLifecycleEffectiveStatusAliasSql('o'));
check(norm(aliasQuery.sql) === EFF_O && aliasQuery.params.length === 0, "orderLifecycleEffectiveStatusAliasSql('o') renders PrepShip's alias CASE byte-for-byte");
let aliasRejected = false;
try {
  lifecycle.orderLifecycleEffectiveStatusAliasSql('o; drop table orders');
} catch {
  aliasRejected = true;
}
check(aliasRejected, 'an unsafe alias is rejected before it reaches SQL');
check(sqlOf(lifecycle.portalOrderFulfillmentBucketSql()) === BUCKET, 'portalOrderFulfillmentBucketSql = cancelled | shipped | pending (complement) over the effective CASE');
check(sqlOf(lifecycle.portalOrderFulfillmentBucketAliasSql('o')) === BUCKET_O, "portalOrderFulfillmentBucketAliasSql('o') = the same bucket over the alias CASE");
check(sqlOf(lifecycle.portalOrderFulfillmentBucketPredicateSql('shipped')) === `${EFF} = 'shipped'`, "shipped tab predicate renders on the INNER effective CASE (= 'shipped')");
check(sqlOf(lifecycle.portalOrderFulfillmentBucketPredicateSql('cancelled')) === `${EFF} = 'cancelled'`, "cancelled tab predicate renders on the INNER effective CASE (= 'cancelled')");
check(sqlOf(lifecycle.portalOrderFulfillmentBucketPredicateSql('pending')) === `${EFF} not in ('shipped', 'cancelled')`, "awaiting tab predicate renders on the INNER effective CASE (not in ('shipped', 'cancelled'))");
check(sqlOf(lifecycle.portalOrderFulfillmentBucketAliasPredicateSql('o', 'pending')) === `${EFF_O} not in ('shipped', 'cancelled')`, "Analysis is_awaiting_order predicate ('o', pending) renders on the alias CASE");
check(
  sqlOf(lifecycle.portalOrderFulfillmentBucketAliasPredicateSql('o', 'shipped')) === `${EFF_O} = 'shipped'` &&
    sqlOf(lifecycle.portalOrderFulfillmentBucketAliasPredicateSql('o', 'cancelled')) === `${EFF_O} = 'cancelled'`,
  'alias shipped / cancelled predicates render on the alias CASE',
);
check(sqlOf(lifecycle.outboundShipmentPredicate()) === OUTBOUND, 'outboundShipmentPredicate = is_return false AND source <> replacement (customer LIST surfaces)');
check(sqlOf(lifecycle.orderOutboundShipmentMatchSql('s')) === MATCH, 'orderOutboundShipmentMatchSql = order_id match OR client-scoped order_number fallback, AND is_return false (no replacement arm: documented no-op)');
check(sqlOf(lifecycle.hasActiveOutboundShipmentSql()) === `exists ( select 1 from shipments s where ${MATCH} and coalesce(s.voided, false) = false )`, 'hasActiveOutboundShipmentSql = exists(match AND voided = false)');
check(sqlOf(lifecycle.hasVoidedOutboundShipmentSql()) === `exists ( select 1 from shipments s where ${MATCH} and coalesce(s.voided, false) = true )`, 'hasVoidedOutboundShipmentSql = exists(match AND voided = true)');
const shipQuery = render(shipmentStatus.portalShipmentStatusSql());
check(
  norm(shipQuery.sql) === SHIP && shipQuery.params.length === 0,
  'portalShipmentStatusSql = voided | linked-order bucket (joined row, else same-client shipped-preferring order_number fallback) -> cancelled | shipped | label_created | unavailable',
);
check(sqlOf(shipmentIsCustomerShippingEligibleSql()).includes('coalesce("shipments"."is_return", false) = false'), 'shipmentIsCustomerShippingEligibleSql shares the is_return arm with outboundShipmentPredicate');

// If the read-only PrepShip checkout is present, prove the pinned text is PrepShip's own template
// (the hosted parity lane does this against PrepShip's real functions; here it is a bonus).
const psDir = process.env.PREPSHIP_V4_DIR ?? path.resolve(root, '../shared-db-v4');
const psLifecycleFile = path.join(psDir, 'src/services/order-lifecycle-status.ts');
if (fs.existsSync(psLifecycleFile)) {
  const ps = fs.readFileSync(psLifecycleFile, 'utf8').replace(/\r\n/g, '\n');
  const template = (fn: string) => {
    const start = ps.indexOf(`export function ${fn}(`);
    const open = ps.indexOf('sql<string>`', start);
    const close = ps.indexOf('`', open + 'sql<string>`'.length);
    return start >= 0 && open >= 0 && close >= 0 ? ps.slice(open + 'sql<string>`'.length, close) : '';
  };
  const psEff = norm(
    template('orderLifecycleEffectiveStatusSql')
      .replace(/\$\{orders\.orderStatus\}/g, '"orders"."order_status"')
      .replace(/\$\{orders\.canonicalStatus\}/g, '"orders"."canonical_status"')
      .replace(/\$\{orders\.externallyShipped\}/g, '"orders"."externally_shipped"'),
  );
  const psAlias = norm(
    template('orderLifecycleEffectiveStatusAliasSql')
      .replace(/\$\{orderStatus\}/g, 'o.order_status')
      .replace(/\$\{canonicalStatus\}/g, 'o.canonical_status')
      .replace(/\$\{externallyShipped\}/g, 'o.externally_shipped'),
  );
  check(psEff === EFF, `PrepShip checkout (${psDir}) orderLifecycleEffectiveStatusSql template equals the pinned text`);
  check(psAlias === EFF_O, 'PrepShip checkout orderLifecycleEffectiveStatusAliasSql template equals the pinned alias text');
} else {
  console.log(`skip: PrepShip checkout not present at ${psDir} (the sibling-checkout parity lane covers upstream drift)`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// (c) Static pins
// ══════════════════════════════════════════════════════════════════════════════════════════
const OUTBOUND_UI_FILES = [
  'portal-client/src/lib/status.ts',
  'portal-client/src/components/OrderStatusBadge.tsx',
  'portal-client/src/pages/Orders.tsx',
  'portal-client/src/pages/Shipments.tsx',
  'portal-client/src/components/billing/InvoiceShipmentDrawer.tsx',
  'portal-client/src/components/OrderDetailPanel.tsx',
];
for (const file of OUTBOUND_UI_FILES) {
  const code = stripComments(read(file));
  check(
    !/['"`]In Transit['"`]|['"`]Delivered['"`]|>\s*Delivered\s*<|>\s*In Transit\s*</.test(code),
    `no "In Transit" / "Delivered" LABEL in ${file} (returns components legitimately keep theirs)`,
  );
}
const statusLib = read('portal-client/src/lib/status.ts');
for (const key of ['const LEGACY_FULFILLMENT_KEYS', 'const LEGACY_SHIPMENT_KEYS']) {
  const idx = statusLib.indexOf(key);
  check(idx > 0 && /TRANSITIONAL/.test(statusLib.slice(Math.max(0, idx - 1200), idx)), `${key} carries the TRANSITIONAL removal marker`);
}
{
  const owner = read('src/lib/client-portal/shipment-status.ts');
  const idx = owner.indexOf('export const LEGACY_SHIPMENT_STATUS_FILTER_ALIASES');
  check(idx > 0 && /transitional|legacy|one release/i.test(owner.slice(Math.max(0, idx - 900), idx)), 'LEGACY_SHIPMENT_STATUS_FILTER_ALIASES carries the transitional / removal marker');
  check(
    shipmentStatus.resolveShipmentStatusFilterParam('delivered') === 'shipped' &&
      shipmentStatus.resolveShipmentStatusFilterParam('in_transit') === 'shipped' &&
      shipmentStatus.resolveShipmentStatusFilterParam('exception') === 'shipped' &&
      shipmentStatus.resolveShipmentStatusFilterParam('attempted') === 'shipped' &&
      shipmentStatus.resolveShipmentStatusFilterParam('label_created') === 'label_created' &&
      shipmentStatus.resolveShipmentStatusFilterParam('bogus') === undefined,
    "?status legacy aliases (delivered | in_transit | exception | attempted) -> 'shipped'; unknown -> no filter",
  );
  check(shipmentStatus.normalizePortalShipmentStatus('delivered') === 'unavailable', "a projected 'delivered' fails closed to unavailable (aliases are filter-only)");
}

const shipmentsContract = stripComments(read('src/lib/client-portal/contracts/shipments.ts'));
check(!/deliveredAt|shipmentStatusDetail|trackingStatus/.test(shipmentsContract), 'contracts/shipments.ts has no deliveredAt / shipmentStatusDetail / trackingStatus');
check([...PORTAL_SHIPMENT_STATUSES].join(',') === 'shipped,label_created,cancelled,voided,unavailable', 'PORTAL_SHIPMENT_STATUSES = shipped | label_created | cancelled | voided | unavailable');
const ordersContract = read('src/lib/client-portal/contracts/orders.ts');
check(/export type PortalOrderFulfillmentStatus = 'pending' \| 'shipped' \| 'cancelled' \| 'voided';/.test(ordersContract), 'PortalOrderFulfillmentStatus = pending | shipped | cancelled | voided');
const shipmentDto = stripComments(/export function toPortalShipmentDto[\s\S]*?\n\}/.exec(read('src/lib/client-portal/dto.ts'))?.[0] ?? '');
check(shipmentDto.length > 0 && !/deliveredAt|shipmentStatusDetail|trackingStatus/.test(shipmentDto), 'toPortalShipmentDto projects no deliveredAt / shipmentStatusDetail / trackingStatus');

// Both shipment surfaces: outbound admission + the one status expression + a left-joined orders row.
const shipmentsReadModel = read('src/lib/client-portal/read-models/shipments.ts');
check(
  shipmentsReadModel.includes('outboundShipmentPredicate()') &&
    shipmentsReadModel.includes('shipmentStatus: portalShipmentStatusSql()') &&
    shipmentsReadModel.includes('eq(portalShipmentStatusSql(), status)') &&
    (shipmentsReadModel.match(/\.leftJoin\(orders, eq\(orders\.id, shipments\.orderId\)\)/g) ?? []).length === 2,
  'read-models/shipments.ts: outboundShipmentPredicate + portalShipmentStatusSql (projection AND filter) + leftJoin(orders) on list and count',
);
const ordersRoute = read('src/routes/client-portal/orders.ts');
const drillIn = /app\.get\('\/orders\/:id\{\[0-9\]\+\}\/shipments'[\s\S]*?\n\}\);/.exec(ordersRoute)?.[0] ?? '';
check(
  drillIn.includes('outboundShipmentPredicate()') &&
    drillIn.includes('shipmentStatus: portalShipmentStatusSql()') &&
    drillIn.includes('.leftJoin(orders, eq(orders.id, shipments.orderId))') &&
    drillIn.includes('eq(shipments.voided, false)'),
  'GET /orders/:id/shipments: outboundShipmentPredicate + portalShipmentStatusSql + leftJoin(orders), voided hidden',
);
const ordersListRoute = /app\.get\('\/orders',[\s\S]*?\n\}\);/.exec(ordersRoute)?.[0] ?? '';
check(
  ordersListRoute.includes('isPortalOrderStatusFilter(status)') &&
    /return c\.json\(\{ error: [\s\S]*?\}, 400\)/.test(ordersListRoute) &&
    ordersListRoute.includes("statusParam !== 'all'"),
  "GET /orders whitelists ?status via isPortalOrderStatusFilter (undefined / 'all' = unfiltered) and answers 400 otherwise",
);
const ordersReadModel = read('src/lib/client-portal/read-models/orders.ts');
check(
  !/tracking_status|activeTrackingStatus/.test(ordersReadModel) &&
    (stripComments(ordersReadModel).match(/orderOutboundShipmentMatchSql\('s'\)/g) ?? []).length === 2 &&
    ordersReadModel.includes('hasActiveOutboundShipmentSql()') &&
    ordersReadModel.includes('hasVoidedOutboundShipmentSql()') &&
    ordersReadModel.includes("PORTAL_ORDER_STATUS_FILTERS = ['awaiting_shipment', 'shipped', 'cancelled']"),
  'read-models/orders.ts: no tracking_status subquery; tracking/carrier subqueries use orderOutboundShipmentMatchSql; signals from the shared exists() fragments; 3 tab ids',
);

// No SQL ::boolean cast of raw externallyFulfilled anywhere under the client-portal lib/routes.
{
  const offenders: string[] = [];
  for (const dir of ['src/lib/client-portal', 'src/routes/client-portal']) {
    for (const file of walk(path.join(root, dir))) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (/::boolean/.test(code)) offenders.push(path.relative(root, file));
    }
  }
  check(offenders.length === 0, `no '::boolean' SQL cast under src/lib/client-portal or src/routes/client-portal (raw externallyFulfilled is read in TypeScript)${offenders.length ? `: ${offenders.join(', ')}` : ''}`);
}

// The frontend renders the enums; it never assigns them, never renders the raw orderStatus as a
// status on the outbound order surfaces, and never calls an outbound tracking refresh.
{
  const assigners: string[] = [];
  const refreshers: string[] = [];
  for (const file of walk(path.join(root, 'portal-client/src'))) {
    const code = stripComments(fs.readFileSync(file, 'utf8'));
    if (/\b(fulfillmentStatus|shipmentStatus)\s*=[^=>]/.test(code)) assigners.push(path.relative(root, file));
    if (/refreshShipmentTracking/.test(code)) refreshers.push(path.relative(root, file));
  }
  check(assigners.length === 0, `portal-client never assigns fulfillmentStatus / shipmentStatus${assigners.length ? `: ${assigners.join(', ')}` : ''}`);
  check(refreshers.length === 0, `portal-client has no refreshShipmentTracking caller${refreshers.length ? `: ${refreshers.join(', ')}` : ''}`);
}
for (const file of ['portal-client/src/pages/Orders.tsx', 'portal-client/src/components/OrderDetailPanel.tsx']) {
  const code = stripComments(read(file));
  check(
    !/orderStatusMeta\(|\bo\.orderStatus\b/.test(code) && code.includes("from '@/components/OrderStatusBadge'"),
    `${file} renders the shared OrderStatusBadge, never orderStatusMeta(o.orderStatus)`,
  );
}
check(
  stripComments(read('portal-client/src/components/OrderStatusBadge.tsx')).includes('fulfillmentStatusMeta(status)'),
  'OrderStatusBadge reads the ONE shared fulfillmentStatusMeta map',
);
check(
  read('portal-client/src/pages/Orders.tsx').includes('status={o.fulfillmentStatus}') &&
    read('portal-client/src/components/OrderDetailPanel.tsx').includes('<OrderStatusBadge status={o.fulfillmentStatus} />'),
  'Orders badge and OrderDetailPanel chip both read PortalOrder.fulfillmentStatus',
);
check(!/refreshShipmentTracking|refresh-tracking/.test(stripComments(read('portal-client/src/lib/api/domains/shipments.ts'))), 'the shipments adapter has no refresh method');
check(
  read('portal-client/src/pages/Returns.tsx').includes('useReturnTrackingRefresh(rows') &&
    read('portal-client/src/lib/useReturnTrackingRefresh.ts').includes('portalApi.refreshReturnTracking('),
  'the Returns page (whose CP-062 arrival signal depends on telemetry) owns the browser-driven refresh',
);

// Runner + package wiring: the parity scripts need a PrepShip read / checkout and are denied from
// the static-guard runner (omitting them turns npm run test:guards red in CI).
const runGuards = read('scripts/run-guards.mjs');
check(runGuards.includes("'prepship-order-lifecycle-parity'") && runGuards.includes("'client-portal-order-lifecycle-parity'"), 'run-guards.mjs denies both CP-069 parity scripts');
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert(
  pkg.scripts?.['test:client-portal-cp069-fulfillment-display'] === 'tsx scripts/client-portal-cp069-fulfillment-display-guard.ts',
  'package.json exposes test:client-portal-cp069-fulfillment-display',
);
console.log('ok: package.json exposes test:client-portal-cp069-fulfillment-display');
for (const companion of ['scripts/integration/client-portal-orders-fulfillment-cp069.integration.ts', 'scripts/integration/client-portal-order-lifecycle-parity.ts']) {
  console.log(`${exists(companion) ? 'ok' : 'note'}: companion proof ${companion} ${exists(companion) ? 'present' : 'not present yet (wired by the ci-db-suite-wiring guard)'}`);
}

if (failed) process.exit(1);
console.log('\nCP-069 fulfillment display guard passed.');
