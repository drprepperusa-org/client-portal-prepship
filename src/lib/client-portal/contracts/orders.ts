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
