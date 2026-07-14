import type { PortalItemIdentity } from './common';

export const PORTAL_SHIPMENT_STATUSES = [
  'delivered',
  'in_transit',
  'exception',
  'attempted',
  'label_created',
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
  shipDate: string | null;
  shipmentStatusDetail: string | null;
  deliveredAt: string | null;
  items: PortalItemIdentity[];
  customerShippingRate: number | string | null;
  customerShippingRatePending: boolean;
}
