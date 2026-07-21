export interface PortalInventory {
  id: number;
  clientId: number | null;
  clientName: string | null;
  storeIds: number[];
  storeName: string | null;
  sku: string | null;
  name: string | null;
  inventoryQuantity: number;
  reorderLevel: number | null;
  active: boolean | null;
  imageUrl: string | null;
  warehouseShipped30d: number;
  stockStatus: 'out' | 'low' | 'in';
  isLow: boolean;
  isOut: boolean;
  updatedAt: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  cuFt: number | null;
  unitsPerPack: number;
  baseUnitQty: number;
  totalUnits: number;
  packageName: string | null;
  packageLength: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
}

export interface InventoryMovement {
  id: number;
  sku: string | null;
  name: string | null;
  clientName: string | null;
  type: string | null;
  qty: number | null;
  orderId: number | null;
  note: string | null;
  source: string | null;
  createdAt: string | null;
}
