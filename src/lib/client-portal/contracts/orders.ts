import type { PortalItemIdentity } from './common';
import type { ReturnEligibility } from '../../../services/return-eligibility';

/**
 * CP-069 — the customer fulfillment display contract for an ORDER.
 *
 * Source: PrepShip's effective order lifecycle (orders.order_status, orders.canonical_status,
 * orders.externally_shipped) collapsed to the customer vocabulary, plus PrepShip's shipped-label
 * display state over the order's OUTBOUND shipment rows (voided / is_return) for the voided case.
 * Event clock: PrepShip's fulfillment writes. Formula/owner: src/lib/client-portal/order-status.ts
 * over src/lib/client-portal/order-lifecycle.ts (a pinned port of prepship-v4).
 *
 *   pending   — PrepShip has neither shipped nor cancelled the order (awaiting_shipment, on_hold,
 *               awaiting_payment, pending_fulfillment, …). A label row, a tracking number, a ship
 *               date or elapsed time alone never promote an order out of this bucket.
 *   shipped   — PrepShip's effective status is shipped (order_status = shipped, or marked shipped
 *               externally), including orders whose marketplace confirmation is still pending or
 *               failed, and orders shipped outside PrepShip.
 *   cancelled — PrepShip's effective status is cancelled (local, or cancelled upstream by the
 *               marketplace while still awaiting locally).
 *   voided    — shipped, but the only outbound label(s) were voided and nothing replaced them
 *               (PrepShip's 'voided_label' display state).
 *
 * Carrier telemetry (shipments.tracking_status / delivered_at) is NOT an input: the portal never
 * promises "In Transit" or "Delivered" as a carrier-tracking service.
 */
export type PortalOrderFulfillmentStatus = 'pending' | 'shipped' | 'cancelled' | 'voided';

export interface PortalOrderCostSummaryRow {
  label: string;
  amount: number;
  kind: 'subtotal' | 'discount' | 'shipping' | 'tax' | 'adjustment' | 'refund' | 'total';
}

export interface PortalOrder {
  id: number;
  clientId: number | null;
  clientName: string | null;
  storeId: number | null;
  storeName: string | null;
  orderNumber: string | null;
  externalOrderId: string | null;
  sourceProvider: string | null;
  sourceStoreId: string | null;
  orderStatus: string | null;
  fulfillmentStatus: PortalOrderFulfillmentStatus;
  /** Backend return-request policy; the create endpoint revalidates current facts. */
  returnEligibility: ReturnEligibility;
  /** CP-061: backend-derived REPLACE badge — render verbatim, never re-derive. */
  /**
   * REPLACE badge, backend-derived. Source: canonical `replacements` rows owned
   * by PrepShip (PS-502). Event clock: `replacements.requested_at`. Formula: the
   * order has a replacement whose status is NOT in PS-502's frozen terminal set
   * (completed | rejected | cancelled — replacement-state-machine.ts:45-49);
   * status/reference are the newest such row. Owner: PrepShip.
   *
   * Named `active*` on purpose. Upstream already owns `replacementCount` with a
   * DIFFERENT meaning — an invoice-scoped count(distinct replacement_id) over
   * billing_line_items (prepship-v4 billing-invoice-totals.ts:20) — and
   * `replacementReference` as the label/shipment identity string. Two numbers of
   * the same name meaning different things is what CLAUDE.md forbids.
   */
  hasActiveReplacement: boolean;
  activeReplacementStatus: string | null;
  activeReplacementCount: number;
  activeReplacementReference: string | null;
  orderDate: string | null;
  shipToName: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  displayTrackingNumber: string | null;
  trackingUrl: string | null;
  items: PortalItemIdentity[];
  orderedUnits: number;
  weightOz?: number | string | null;
  orderTotal?: number | string | null;
  shippingCharged?: number | string | null;
  customerShippingRate?: number | string | null;
  customerShippingRatePending?: boolean;
  productSubtotal?: number | string | null;
  chargeSummary?: PortalOrderCostSummaryRow[];
}
