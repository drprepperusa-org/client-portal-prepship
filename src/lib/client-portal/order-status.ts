// Order fulfillment status — the ONE backend-owned resolver for the customer-facing order
// lifecycle badge shown in the Client Portal Orders table and order detail.
//
// Shadow-renderer / SOT law: the Client Portal must NOT derive this status in React. It
// renders the enum this resolver returns; PrepShip and the Portal share one definition so the
// two can never drift.
//
// CP-069: the value is PrepShip's own fulfillment evidence, nothing else.
//
// Source inputs (all canonical DB truth — no invented data):
//   - orders.order_status                : marketplace / PrepShip order status.
//   - orders.canonical_status            : PrepShip's fulfillment-outbox status (cancelled upstream
//                                          outranks a local awaiting/shipped status).
//   - orders.externally_shipped          : marked shipped outside PrepShip.
//   - orders.raw->externallyFulfilled    : ShipStation's own external-fulfilment flag.
//   - hasActiveOutboundShipment          : a non-voided, non-return shipment row exists.
//   - hasVoidedOutboundShipment          : a voided, non-return shipment row exists.
// Event clock: PrepShip's fulfillment writes (label purchase, mark shipped, marketplace
//   confirmation, cancellation). There is no separate portal clock.
// Owner: src/lib/client-portal/order-lifecycle.ts (pinned port of prepship-v4
//   order-lifecycle-status.ts + shipped-label-display-state.ts + shipment-aggregate.ts).
//
// Formula (top wins):
//   cancelled — PrepShip effective status 'cancelled'.
//   voided    — order_status 'shipped' (not merely externally_shipped), no canonical
//               confirmation state pending/failed, AND shipped-label display state 'voided_label'
//               (only voided outbound labels, no replacement, not a true external label). This
//               is exactly where PrepShip's resolveOrderLifecycleStatus consults the display
//               state: inside its `orderStatus === 'shipped'` branch, after the
//               confirmation_failed / shipped_pending_confirmation checks. An externally-shipped
//               order that is not locally shipped, or a shipped order whose marketplace
//               confirmation is pending/failed, is 'Externally shipped' / 'Shipped pending
//               confirmation' / 'Confirmation failed' to PrepShip — all "Shipped" here — even
//               when its only PrepShip label rows are voided.
//   shipped   — effective 'shipped' otherwise (active label, external label, or a shipped order
//               whose shipment sync is missing — all "Shipped" to the customer).
//   pending   — everything PrepShip has not shipped or cancelled.
//
// NOT inputs, by design: shipments.tracking_status / delivered_at (carrier telemetry),
// tracking-number presence, ship dates, elapsed time, active-shipment existence on its own.
import { sql, type SQL } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import { orderFulfillmentSignalSelects } from './order-fulfillment-signals';
import {
  orderLifecycleEffectiveStatusSql,
  resolvePortalOrderFulfillmentBucket,
  resolveShippedLabelDisplayState,
} from './order-lifecycle';

export type OrderFulfillmentStatus = 'pending' | 'shipped' | 'cancelled' | 'voided';

/** Canonical order set for the fulfillment status (rendering + guard reference). */
export const ORDER_FULFILLMENT_STATUSES: readonly OrderFulfillmentStatus[] = [
  'pending',
  'shipped',
  'cancelled',
  'voided',
] as const;

export interface OrderFulfillmentSignals {
  /** orders.order_status (raw marketplace / PrepShip status). */
  orderStatus: string | null | undefined;
  /** orders.canonical_status (PrepShip fulfillment outbox), null when never written. */
  canonicalStatus: string | null | undefined;
  /** orders.externally_shipped */
  externallyShipped: boolean | null | undefined;
  /** orders.raw->externallyFulfilled, read via rawExternallyFulfilled() (boolean or null). */
  externallyFulfilled: boolean | null | undefined;
  /** A non-voided OUTBOUND (is_return = false) shipment row exists for the order. */
  hasActiveOutboundShipment: boolean;
  /** A voided OUTBOUND shipment row exists for the order. */
  hasVoidedOutboundShipment: boolean;
}

export function resolveOrderFulfillmentStatus(signals: OrderFulfillmentSignals): OrderFulfillmentStatus {
  const bucket = resolvePortalOrderFulfillmentBucket({
    orderStatus: signals.orderStatus,
    canonicalStatus: signals.canonicalStatus,
    externallyShipped: signals.externallyShipped,
  });
  if (bucket === 'cancelled') return 'cancelled';
  if (bucket === 'shipped') {
    // PrepShip order-lifecycle-status.ts:93-165 — the display state is consulted ONLY when the
    // local order_status is 'shipped', and only after the canonical confirmation states.
    const orderStatus = String(signals.orderStatus ?? '').toLowerCase();
    const canonicalStatus = String(signals.canonicalStatus ?? '').toLowerCase();
    if (orderStatus !== 'shipped') return 'shipped'; // externally_shipped=true → 'Externally shipped'
    if (canonicalStatus === 'confirmation_failed' || canonicalStatus === 'shipped_pending_confirmation') {
      return 'shipped';
    }
    const display = resolveShippedLabelDisplayState({
      externallyShipped: signals.externallyShipped === true,
      externallyFulfilled: signals.externallyFulfilled ?? null,
      hasActiveShipment: signals.hasActiveOutboundShipment,
      hasVoidedShipment: signals.hasVoidedOutboundShipment,
    });
    return display === 'voided_label' ? 'voided' : 'shipped';
  }
  return 'pending';
}

/**
 * PS-486 / CP-069: SQL projection of this owner's exact precedence, for ORDER BY on the Orders
 * table's Status column before pagination. It is the resolver above written in SQL over the
 * same inputs — PrepShip's effective lifecycle CASE, the two OUTBOUND row signals, and
 * orders.raw->externallyFulfilled read with booleanOrNull semantics (only a JSON boolean true
 * counts; never a `::boolean` cast) — and the table-sort guard executes both forms over an
 * exhaustive signal matrix to prove they agree.
 */
export function orderFulfillmentStatusSql(): SQL<OrderFulfillmentStatus> {
  const effective = orderLifecycleEffectiveStatusSql();
  const signals = orderFulfillmentSignalSelects();
  const externallyFulfilledTrue = sql`(
    jsonb_typeof(${orders.raw}->'externallyFulfilled') = 'boolean'
    and (${orders.raw}->'externallyFulfilled')::text = 'true'
  )`;
  return sql<OrderFulfillmentStatus>`case
    when ${effective} = 'cancelled' then 'cancelled'
    when ${effective} = 'shipped' then (case
      when lower(coalesce(${orders.orderStatus}, '')) <> 'shipped' then 'shipped'
      when lower(coalesce(${orders.canonicalStatus}, '')) in ('confirmation_failed', 'shipped_pending_confirmation') then 'shipped'
      when ${signals.hasActiveOutboundShipment} then 'shipped'
      when ${signals.hasVoidedOutboundShipment} and not ${externallyFulfilledTrue} then 'voided'
      else 'shipped'
    end)
    else 'pending'
  end`;
}
