import type { PortalItemIdentity } from './common';

export type PortalOrderFulfillmentStatus =
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'voided';

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
