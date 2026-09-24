import type { InboundReceiveInput } from './inbound';

/** Backend receiving plan over canonical shipment/items and same-client SKU matches.
 * Quantities entered by the operator are intent until committed. Difference = received - expected.
 * Inventory units are additions, not current or projected stock balances. */
export interface InboundReceivePreviewRow {
  id: number;
  sku: string | null;
  name: string | null;
  expectedQty: number;
  receivedQty: number;
  difference: number;
  quantityStatus: 'short' | 'extra' | 'exact';
  inventoryMatch: 'matched' | 'missing' | 'ambiguous' | 'no_sku' | 'unassigned';
  inventoryUnits: number;
  issue: string | null;
}
export interface InboundReceivePreview {
  reference: string | null;
  addToInventory: boolean;
  rows: InboundReceivePreviewRow[];
  expectedUnits: number;
  receivedUnits: number;
  inventoryUnits: number;
  issues: string[];
  canConfirm: boolean;
  fingerprint: string | null;
}
export interface InboundReceiveConfirmation extends InboundReceiveInput { previewFingerprint: string }
