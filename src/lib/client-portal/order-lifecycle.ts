// CP-069 — the Client Portal's port of PrepShip's canonical order-lifecycle owner.
//
// The portal is a shadow renderer: a customer-facing "Shipped" must come from the SAME
// evidence PrepShip's own Orders list, daily counts, dashboard and billing use — never from
// carrier telemetry, tracking-number presence, or the existence of a label row. Everything in
// this module is a verbatim port of prepship-v4 @ dfc6809e456826599a28e8b530e3673911d4d3e9,
// pinned by contracts/prepship-order-lifecycle-display.json and proven by
// scripts/prepship-order-lifecycle-parity.mjs (rendered SQL + upstream blob SHAs):
//
//   src/services/order-lifecycle-status.ts
//     orderLifecycleEffectiveStatusSql / orderLifecycleEffectiveStatusAliasSql — THE CASE that
//     buckets an order as cancelled | shipped | <raw or awaiting_shipment>. PS 0057 builds
//     orders_effective_status_date_id_idx on this exact expression, so it must stay byte-identical.
//   src/services/shipping-workflow/shipped-label-display-state.ts
//     resolveShippedLabelDisplayState — for a SHIPPED order, whether its label truth is an active
//     label, an external label, a voided label with no replacement, or a missing shipment sync.
//   src/services/shipment-aggregate.ts
//     activeOutboundShipmentPredicate — "Returns and voided labels are never active outbound
//     evidence": voided = false AND is_return = false.
//
// Source inputs (all canonical DB truth): orders.order_status, orders.canonical_status
// (PrepShip's fulfillment outbox: shipped_pending_confirmation | shipped | confirmation_failed |
// cancelled), orders.externally_shipped, orders.raw->externallyFulfilled (ShipStation's own
// external-fulfilment flag), and the outbound rows of `shipments` (voided, is_return).
// Event clock: PrepShip's fulfillment writes (label purchase / mark-shipped / marketplace
// confirmation / cancellation). Owner: PrepShip. This module only reads.
//
// Deliberate deviations from PrepShip, all documented in the contract JSON:
//   - customer surfaces additionally exclude source = 'replacement' rows (PrepShip's own list
//     query excludes them when choosing an order's shipment; the Replace surface owns them);
//   - the order_number fallback for order_id-null rows is scoped to the same client_id
//     (PrepShip's orphan linker is unscoped; the portal is multi-tenant);
//   - hasExternalShipment is not fed: external_label and active_label both collapse to the
//     customer word "Shipped", so the distinction cannot change portal output.
import { sql, type SQL } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';

// ── 1. Effective lifecycle status (PS order-lifecycle-status.ts) ─────────────────────────

/**
 * PrepShip's effective order status. Verbatim `orderLifecycleEffectiveStatusSql()`:
 *   cancelled (local) > cancelled (canonical_status, "Cancelled upstream") > shipped (local)
 *   > shipped (externally_shipped) > the raw lower-cased status, '' → awaiting_shipment.
 * Bound to the `orders` table of the current query.
 */
export function orderLifecycleEffectiveStatusSql(): SQL<string> {
  return sql<string>`case
    when lower(coalesce(${orders.orderStatus}, '')) = 'cancelled' then 'cancelled'
    when lower(coalesce(${orders.canonicalStatus}, '')) = 'cancelled' then 'cancelled'
    when lower(coalesce(${orders.orderStatus}, '')) = 'shipped' then 'shipped'
    when coalesce(${orders.externallyShipped}, false) = true then 'shipped'
    else coalesce(nullif(lower(${orders.orderStatus}), ''), 'awaiting_shipment')
  end`;
}

function aliasColumn(alias: string, columnName: string): SQL {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Unsafe SQL alias for order lifecycle status: ${alias}`);
  }
  return sql.raw(`${alias}.${columnName}`);
}

/** The same CASE over an aliased `orders` row (verbatim `orderLifecycleEffectiveStatusAliasSql`). */
export function orderLifecycleEffectiveStatusAliasSql(alias: string): SQL<string> {
  const orderStatus = aliasColumn(alias, 'order_status');
  const canonicalStatus = aliasColumn(alias, 'canonical_status');
  const externallyShipped = aliasColumn(alias, 'externally_shipped');
  return sql<string>`case
    when lower(coalesce(${orderStatus}, '')) = 'cancelled' then 'cancelled'
    when lower(coalesce(${canonicalStatus}, '')) = 'cancelled' then 'cancelled'
    when lower(coalesce(${orderStatus}, '')) = 'shipped' then 'shipped'
    when coalesce(${externallyShipped}, false) = true then 'shipped'
    else coalesce(nullif(lower(${orderStatus}), ''), 'awaiting_shipment')
  end`;
}

export interface OrderLifecycleInput {
  /** orders.order_status */
  orderStatus: string | null | undefined;
  /** orders.canonical_status (PrepShip fulfillment outbox; null when never written). */
  canonicalStatus: string | null | undefined;
  /** orders.externally_shipped */
  externallyShipped: boolean | null | undefined;
}

/**
 * TypeScript twin of the SQL CASE above — the same branches in the same order, over the same
 * lower-cased inputs (no trimming, exactly as the SQL), so a row classified in SQL and the same
 * row classified in TS can never disagree. Proven by the CP-069 guard and the integration suite.
 */
export function resolveOrderLifecycleEffectiveStatus(input: OrderLifecycleInput): string {
  const orderStatus = String(input.orderStatus ?? '').toLowerCase();
  const canonicalStatus = String(input.canonicalStatus ?? '').toLowerCase();
  if (orderStatus === 'cancelled') return 'cancelled';
  if (canonicalStatus === 'cancelled') return 'cancelled';
  if (orderStatus === 'shipped') return 'shipped';
  if (input.externallyShipped === true) return 'shipped';
  return orderStatus || 'awaiting_shipment';
}

// ── 2. Customer fulfillment bucket ────────────────────────────────────────────────────────

/**
 * The three customer buckets of the effective status: cancelled | shipped | pending, where
 * pending is the COMPLEMENT of the terminal two (awaiting_shipment, on_hold, awaiting_payment,
 * pending_fulfillment, anything else PrepShip has not shipped or cancelled). One expression
 * feeds the Orders badge (via the resolver twin), the Orders tabs, and the awaiting count, so a
 * row can never sit in a tab that contradicts its own badge.
 */
export type PortalOrderFulfillmentBucket = 'pending' | 'shipped' | 'cancelled';

export const PORTAL_ORDER_FULFILLMENT_BUCKETS: readonly PortalOrderFulfillmentBucket[] = [
  'pending',
  'shipped',
  'cancelled',
] as const;

function bucketOf(effective: SQL<string>): SQL<PortalOrderFulfillmentBucket> {
  return sql<PortalOrderFulfillmentBucket>`case
    when ${effective} = 'cancelled' then 'cancelled'
    when ${effective} = 'shipped' then 'shipped'
    else 'pending'
  end`;
}

export function portalOrderFulfillmentBucketSql(): SQL<PortalOrderFulfillmentBucket> {
  return bucketOf(orderLifecycleEffectiveStatusSql());
}

export function portalOrderFulfillmentBucketAliasSql(alias: string): SQL<PortalOrderFulfillmentBucket> {
  return bucketOf(orderLifecycleEffectiveStatusAliasSql(alias));
}

/** TS twin of portalOrderFulfillmentBucketSql. */
export function resolvePortalOrderFulfillmentBucket(input: OrderLifecycleInput): PortalOrderFulfillmentBucket {
  const effective = resolveOrderLifecycleEffectiveStatus(input);
  if (effective === 'cancelled') return 'cancelled';
  if (effective === 'shipped') return 'shipped';
  return 'pending';
}

/**
 * A WHERE predicate for one bucket, rendered on the INNER effective CASE (never on the wrapping
 * bucket CASE). PrepShip 0057 builds orders_effective_status_date_id_idx on exactly the
 * effective-status expression, so the equality filters `effective = 'shipped'` and
 * `effective = 'cancelled'` are index-eligible on the shared production database. The pending
 * filter is the COMPLEMENT (`effective not in ('shipped', 'cancelled')`) so that the tab and the
 * badge can never disagree — and a btree cannot serve a negation, so for a GLOBAL (admin) scope
 * the awaiting tab/count scans the orders it is allowed to see; client-scoped callers (every
 * customer) are served by the client_id indexes either way. Measured cost: one CASE per row of
 * the scope; if the admin-scope awaiting count ever matters, add an expression index on this
 * predicate or switch to PrepShip's explicit non-terminal list (an owner decision — see the
 * design doc). The bucket CASE above is for projection only.
 */
function bucketPredicate(effective: SQL<string>, bucket: PortalOrderFulfillmentBucket): SQL {
  if (bucket === 'shipped') return sql`${effective} = 'shipped'`;
  if (bucket === 'cancelled') return sql`${effective} = 'cancelled'`;
  return sql`${effective} not in ('shipped', 'cancelled')`;
}

export function portalOrderFulfillmentBucketPredicateSql(bucket: PortalOrderFulfillmentBucket): SQL {
  return bucketPredicate(orderLifecycleEffectiveStatusSql(), bucket);
}

export function portalOrderFulfillmentBucketAliasPredicateSql(alias: string, bucket: PortalOrderFulfillmentBucket): SQL {
  return bucketPredicate(orderLifecycleEffectiveStatusAliasSql(alias), bucket);
}

// ── 3. Shipped-label display state (PS shipped-label-display-state.ts) ────────────────────

export type ShippedLabelDisplayState =
  | 'active_label' //          a non-voided outbound shipment exists — the active truth
  | 'voided_label' //          the label is voided with no active replacement
  | 'external_label' //        a true marketplace/client external label (explicit external truth)
  | 'missing_shipment_sync'; // shipped, no active shipment, and NOT a true external label

export interface ShippedLabelDisplayInput {
  /** orders.externally_shipped — the operator/PrepShip "shipped outside PrepShip" override. */
  externallyShipped: boolean;
  /** raw ShipStation externallyFulfilled — the genuine marketplace/client-label signal. */
  externallyFulfilled: boolean | null;
  /** a NON-voided OUTBOUND shipment row exists for this order (the active label truth). */
  hasActiveShipment: boolean;
  /** PS-489: every active row is an external-fulfillment RECORD (shipments.source = 'external'). */
  hasExternalShipment?: boolean;
  /** a voided OUTBOUND shipment row exists for this order. */
  hasVoidedShipment: boolean;
}

/**
 * Verbatim port. Callers gate on effective status === 'shipped' before calling. Precedence:
 *   1. active PrepShip label       -> active_label   (a real non-voided label wins, always)
 *   2. active external record      -> external_label (PS-489: the record IS the external truth)
 *   3. voided + not truly external -> voided_label  (#1298: beats the externally_shipped flag)
 *   4. explicit external signal    -> external_label (raw externallyFulfilled, or the override)
 *   5. otherwise                   -> missing_shipment_sync
 */
export function resolveShippedLabelDisplayState(input: ShippedLabelDisplayInput): ShippedLabelDisplayState {
  if (input.hasActiveShipment && input.hasExternalShipment === true) return 'external_label';
  if (input.hasActiveShipment) return 'active_label';
  if (input.hasVoidedShipment && input.externallyFulfilled !== true) return 'voided_label';
  if (input.externallyFulfilled === true || input.externallyShipped) return 'external_label';
  return 'missing_shipment_sync';
}

/** PrepShip orders-dto-primitives.booleanOrNull: only a real JSON boolean counts. */
export function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/**
 * orders.raw->externallyFulfilled, read in TypeScript exactly as PrepShip reads it
 * (booleanOrNull over the raw record). NEVER cast in SQL: `(raw->>'externallyFulfilled')::boolean`
 * throws on any non-boolean payload and would take the whole Orders list down.
 */
export function rawExternallyFulfilled(raw: unknown): boolean | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return booleanOrNull((raw as Record<string, unknown>).externallyFulfilled);
}

// ── 4. Outbound shipment rows (PS shipment-aggregate.ts) ─────────────────────────────────

/**
 * PrepShip's active-outbound rule is `voided = false AND is_return = false` (return labels are
 * never outbound evidence). The portal's CUSTOMER surfaces also exclude source = 'replacement'
 * rows: PrepShip's Orders list excludes them when choosing an order's shipment, they are
 * orderless ('<order>-REPLACE' rows with order_id NULL) and belong to the Replace surface
 * (CP-061), so they must never render as an 'Unavailable' outbound parcel.
 */
export function outboundShipmentPredicate(): SQL {
  return sql`(
    coalesce(${shipments.isReturn}, false) = false
    and coalesce(${shipments.source}, '') <> 'replacement'
  )`;
}

/**
 * The order-grain shipment row set, aliased (`s`), matched to the current `orders` row by
 * order_id, or — for shipments synced without a linked order_id — by order_number scoped to the
 * SAME client (two clients can share an order number; the portal is multi-tenant). Only
 * PrepShip's aggregate rule applies here (voided/is_return); a replacement label linked to an
 * order IS active outbound evidence for that order, exactly as PrepShip's aggregate counts it.
 */
export function orderOutboundShipmentMatchSql(alias = 's'): SQL {
  const orderId = aliasColumn(alias, 'order_id');
  const orderNumber = aliasColumn(alias, 'order_number');
  const clientId = aliasColumn(alias, 'client_id');
  const isReturn = aliasColumn(alias, 'is_return');
  return sql`(
    (${orderId} = ${orders.id} or (${orderId} is null and ${orderNumber} = ${orders.orderNumber} and ${clientId} = ${orders.clientId}))
    and coalesce(${isReturn}, false) = false
  )`;
}

/** exists(): the order has a non-voided outbound shipment. */
export function hasActiveOutboundShipmentSql(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from shipments s
    where ${orderOutboundShipmentMatchSql('s')}
      and coalesce(s.voided, false) = false
  )`;
}

/** exists(): the order has a voided outbound shipment. */
export function hasVoidedOutboundShipmentSql(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from shipments s
    where ${orderOutboundShipmentMatchSql('s')}
      and coalesce(s.voided, false) = true
  )`;
}
