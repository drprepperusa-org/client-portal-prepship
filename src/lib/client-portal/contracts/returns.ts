export interface PortalReturnRow {
  id: number;
  orderId: number | null;
  orderNumber: string | null;
  returnReference: string;
  clientId: number | null;
  clientName: string | null;
  status: string;
  initiatedBy: string;
  reason: string | null;
  deliveryMethod: string | null;
  deliveryStatus: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  pdfAvailable: boolean;
  returnCustomerShippingRate: number | null;
  createdAt: string | null;
}

export interface PortalReturnItem {
  id: number;
  sku: string;
  name: string | null;
  quantity: number;
  orderItemId: number | null;
}

export interface PortalReturnInspectionMedia {
  id: number;
  mediaType: string;
  url: string | null;
  contentType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  capturedAt: string | null;
  uploadedAt: string | null;
}

export interface PortalReturnInspection {
  id: number;
  status: string;
  condition: string | null;
  comments: string | null;
  receivedAt: string | null;
  actorLabel: string;
  createdAt: string | null;
  updatedAt: string | null;
  media: PortalReturnInspectionMedia[];
}

export interface PortalReturnActivity {
  id: number;
  eventType: string;
  status: string | null;
  detail: string | null;
  actorLabel: string;
  eventAt: string;
}

export interface PortalReturnDetail extends PortalReturnRow {
  trackingStatus: string | null;
  deliveryError: string | null;
  returnToLocationId: number | null;
  pdfUrl: string | null;
  requestedAt: string | null;
  closedAt: string | null;
  items: PortalReturnItem[];
  inspections: PortalReturnInspection[];
  activity: PortalReturnActivity[];
  orderActivity: PortalReturnActivity[];
}

export interface ReturnLabelResult {
  returnCustomerShippingRate: number;
  trackingNumber: string | null;
  trackingStatus: string | null;
  labelAvailable: boolean;
  pdfAvailable: boolean;
  returnShipmentId: number | null;
  createdAt: string;
}

export interface ReturnDeliveryResult {
  deliveryMethod: 'shopify_native' | 'manual_pdf';
  deliveryStatus: 'pending' | 'delivered' | 'failed';
  pdfAvailable: boolean;
  pdfUrl: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
}

export interface NewReturnInput {
  orderId: number;
  reason?: string;
  items: Array<{ sku: string; name?: string; quantity: number; orderItemId?: number }>;
}

export interface PortalReturnReceivingRow extends Pick<
  PortalReturnRow,
  'id' | 'orderId' | 'orderNumber' | 'returnReference' | 'clientName' | 'status' | 'trackingNumber'
> {
  returnToLocation: string | null;
  requestedAt: string | null;
}

export type ReturnInspectionCondition =
  | 'sealed_new'
  | 'opened_good'
  | 'damaged'
  | 'missing_item'
  | 'wrong_item'
  | 'other';

export interface NewInspectionInput {
  receivedAt?: string;
  condition?: ReturnInspectionCondition;
  status?: 'pending' | 'passed' | 'failed';
  comments?: string;
}
