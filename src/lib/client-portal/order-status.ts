// Order fulfillment status — the ONE backend-owned resolver for the customer-
// facing order lifecycle status shown in the Client Portal Orders table.
//
// Shadow-renderer / SOT law: the Client Portal must NOT derive this status in
// React. It renders the enum this resolver returns; PrepShip and the Portal
// share this one definition so the two can never drift.
//
// Source inputs (all canonical DB truth — no invented data):
//   - orders.order_status         : marketplace / PrepShip order status.
//   - shipments.tracking_status   : carrier-normalized tracking of the order's
//                                   latest ACTIVE (non-voided) shipment.
//   - hasActiveShipment           : the order has a non-voided shipment.
//   - hasVoidedShipment           : the order has a voided shipment.
// Event clock: the order status + its latest shipment state as synced by the
//   backend worker. There is no separate portal clock.
// Owner: this module. The value set AND the precedence live here only.
//
// Precedence (top wins): cancelled > voided > delivered > in_transit > pending.
//   cancelled  — the order was cancelled at the marketplace / PrepShip level.
//   voided     — the label/shipment was voided and no active replacement exists.
//   delivered  — the active shipment's carrier tracking reports delivery.
//   in_transit — the order is shipped OR has an active label in the carrier
//                network but is not yet delivered ("Shipped = In Transit").
//   pending    — not yet shipped (awaiting_shipment / on_hold / no shipment).

export type OrderFulfillmentStatus =
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'voided';

/** Canonical order set for the fulfillment status (rendering + guard reference). */
export const ORDER_FULFILLMENT_STATUSES: readonly OrderFulfillmentStatus[] = [
  'pending',
  'in_transit',
  'delivered',
  'cancelled',
  'voided',
] as const;

export interface OrderFulfillmentSignals {
  /** orders.order_status (raw marketplace / PrepShip status). */
  orderStatus: string | null | undefined;
  /** tracking_status of the latest non-voided shipment, or null when none. */
  activeTrackingStatus: string | null | undefined;
  /** Whether the order has any non-voided (active) shipment. */
  hasActiveShipment: boolean;
  /** Whether the order has any voided shipment. */
  hasVoidedShipment: boolean;
}

export function resolveOrderFulfillmentStatus(
  signals: OrderFulfillmentSignals,
): OrderFulfillmentStatus {
  const status = String(signals.orderStatus ?? '').toLowerCase();
  const tracking = String(signals.activeTrackingStatus ?? '').toLowerCase();

  // 1. Order-level cancellation / refund wins over everything. 'refunded' is
  //    grouped with cancelled here to match how the cost summary treats it
  //    (dto.ts buildCostSummary) — a refunded order is not "pending shipment".
  if (status === 'cancelled' || status === 'canceled' || status === 'refunded') return 'cancelled';
  // 2. The label was voided and there is no active replacement shipment.
  if (signals.hasVoidedShipment && !signals.hasActiveShipment) return 'voided';
  // 3. Carrier confirms delivery of the active shipment.
  if (tracking === 'delivered') return 'delivered';
  // 4. Shipped, or an active label is in the carrier network, not yet delivered.
  if (signals.hasActiveShipment || status === 'shipped') return 'in_transit';
  // 5. Not yet shipped.
  return 'pending';
}
