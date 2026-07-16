export interface PortalInboundItem {
  id: number;
  sku: string | null;
  name: string | null;
  expectedQty: number;
  receivedQty: number;
}

export interface PortalInbound {
  id: number;
  clientId: number | null;
  clientName: string | null;
  reference: string | null;
  supplier: string | null;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  expectedDate: string | null;
  receivedDate: string | null;
  notes: string | null;
  createdAt: string | null;
  expectedUnits: number;
  receivedUnits: number;
  items: PortalInboundItem[];
}

/** One canonical PrepShip inventory receipt ledger entry. */
export interface PortalInboundReceipt {
  id: number;
  inventoryId: number;
  clientId: number | null;
  clientName: string | null;
  sku: string;
  name: string | null;
  receivedUnits: number;
  receivedAt: string;
  note: string | null;
}

export interface NewInboundInput {
  clientId?: number;
  reference?: string;
  supplier?: string;
  status?: string;
  carrier?: string;
  trackingNumber?: string;
  expectedDate?: string;
  notes?: string;
  items?: Array<{ sku?: string; name?: string; expectedQty?: number }>;
}

export interface PortalInventoryReceiveInput {
  clientId: number;
  reference?: string;
  receivedAt: string;
  items: Array<{ inventoryId: number; qty: number }>;
}

export interface PortalInventoryReceiveResult {
  received: number;
  totalUnits: number;
}
