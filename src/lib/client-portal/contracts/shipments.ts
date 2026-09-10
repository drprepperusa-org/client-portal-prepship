import type { PortalItemIdentity } from './common';

/**
 * CP-069 — the customer fulfillment display contract for an OUTBOUND SHIPMENT row.
 *
 * Source: shipments.voided, plus the linked order's PrepShip effective lifecycle (order_id, or
 * order_number + client_id for rows synced without a linked order). Event clock: PrepShip's
 * fulfillment writes. Formula/owner: src/lib/client-portal/shipment-status.ts
 * (`portalShipmentStatusSql`) over src/lib/client-portal/order-lifecycle.ts.
 *
 *   shipped       — the order PrepShip links this label to is shipped.
 *   label_created — a label exists but PrepShip has not shipped the order (label-only).
 *   cancelled     — the linked order is cancelled (a synced label on an already-cancelled order,
 *                   or legacy rows — PrepShip never cancels a shipped order after the fact).
 *   voided        — the label was voided.
 *   unavailable   — no order can be linked, so fulfillment cannot be confirmed.
 *
 * Carrier telemetry is NOT an input; deliveredAt / tracking-status detail are deliberately not
 * part of this contract (they live only on the returns contract, CP-062).
 */
export const PORTAL_SHIPMENT_STATUSES = [
  'shipped',
  'label_created',
  'cancelled',
  'voided',
  'unavailable',
] as const;

export type PortalShipmentStatus = (typeof PORTAL_SHIPMENT_STATUSES)[number];

export interface PortalShipment {
  id: number;
  orderId: number | null;
  orderNumber: string | null;
  clientId: number | null;
  clientName: string | null;
  storeId: number | null;
  storeName: string | null;
  displayTrackingNumber: string | null;
  shipmentStatus: PortalShipmentStatus;
  trackingUrl: string | null;
  /** shipments.ship_date, else label_ship_date, else create_date (label creation time). */
  shipDate: string | null;
  items: PortalItemIdentity[];
  customerShippingRate: number | string | null;
  customerShippingRatePending: boolean;
}
