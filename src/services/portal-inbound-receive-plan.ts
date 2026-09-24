import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { inboundItems, inboundShipments } from '../db/schema/inbound';
import { inventory } from '../db/schema/inventory';
import type { ClientPortalScope } from '../lib/client-portal/scope';
import type { InboundReceiveInput } from '../lib/client-portal/contracts/inbound';
import type { InboundReceivePreview, InboundReceivePreviewRow } from '../lib/client-portal/contracts/inbound-receive-preview';
import { validateInboundReceive } from '../lib/client-portal/contracts/inbound-receive-validation';
import type { InventoryMovementTransaction } from './inventory-movement';

export class InboundReceiveRejected extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) { super(message); }
}

/** Shared resolution for read-only preview and locked commit. Never expose internal match IDs. */
export async function planPortalInboundReceive(tx: InventoryMovementTransaction, scope: ClientPortalScope, id: number,
  input: InboundReceiveInput, lock = false) {
  if (!scope.userId || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) throw new InboundReceiveRejected('Admin access required', 403);
  if (Object.keys(validateInboundReceive(input)).length) throw new InboundReceiveRejected('Check the receiving quantities.', 400);
  const headQuery = tx.select().from(inboundShipments).where(eq(inboundShipments.id, id));
  const [head] = await (lock ? headQuery.for('update') : headQuery);
  if (!head) throw new InboundReceiveRejected('Inbound shipment not found', 404);
  if (!scope.isGlobal && (head.clientId == null || !scope.clientIds.includes(head.clientId))) {
    throw new InboundReceiveRejected('Inbound shipment is outside your access scope.', 403);
  }
  if (head.status === 'received' || head.status === 'cancelled') {
    throw new InboundReceiveRejected('This shipment is already received or cancelled. Close this form and refresh the list to check its saved status.', 409);
  }
  const itemQuery = tx.select().from(inboundItems).where(eq(inboundItems.inboundId, id)).orderBy(inboundItems.id);
  const items = await (lock ? itemQuery.for('update') : itemQuery);
  const quantities = new Map(input.items.map(item => [item.id, Number(item.receivedQty)]));
  if (quantities.size !== items.length || items.some(item => !quantities.has(item.id))) {
    throw new InboundReceiveRejected('The shipment items have changed. Close and reopen it before receiving.', 409);
  }
  const targets = new Map<number, number[]>();
  if (head.clientId != null) {
    const matchQuery = tx.select({ itemId: inboundItems.id, inventoryId: inventory.id }).from(inboundItems)
      .innerJoin(inventory, and(eq(inventory.clientId, head.clientId), sql`lower(${inventory.sku}) = lower(${inboundItems.sku})`))
      .where(eq(inboundItems.inboundId, id)).orderBy(inventory.id, inboundItems.id);
    const matches = await (lock ? matchQuery.for('share', { of: inventory }) : matchQuery);
    for (const match of matches) targets.set(match.itemId, [...(targets.get(match.itemId) ?? []), match.inventoryId]);
  }
  const rows: InboundReceivePreviewRow[] = items.map(item => {
    const receivedQty = quantities.get(item.id)!;
    const matches = targets.get(item.id) ?? [];
    const inventoryMatch = head.clientId == null ? 'unassigned' : !item.sku ? 'no_sku'
      : matches.length > 1 ? 'ambiguous' : matches.length === 1 ? 'matched' : 'missing';
    const issue = input.addToInventory && receivedQty > 0 && inventoryMatch !== 'matched'
      ? inventoryMatch === 'ambiguous' ? 'Multiple inventory items match this SKU. Resolve the duplicate before receiving.'
        : 'No unique inventory match. Correct the client or SKU, or choose to receive without adding inventory.' : null;
    const difference = receivedQty - item.expectedQty;
    return { id: item.id, sku: item.sku, name: item.name, expectedQty: item.expectedQty, receivedQty, difference,
      quantityStatus: difference < 0 ? 'short' : difference > 0 ? 'extra' : 'exact', inventoryMatch,
      inventoryUnits: input.addToInventory && inventoryMatch === 'matched' ? receivedQty : 0, issue };
  });
  const issues = input.addToInventory && head.clientId == null ? ['Assign a client before adding received units to inventory.'] : [];
  const canConfirm = !issues.length && rows.every(row => !row.issue);
  const fingerprint = canConfirm ? createHash('sha256').update(JSON.stringify({ id, clientId: head.clientId,
    reference: head.reference, status: head.status, addToInventory: input.addToInventory, rows,
    targets: [...targets.entries()].sort(([a], [b]) => a - b),
  })).digest('hex') : null;
  const preview: InboundReceivePreview = { reference: head.reference, addToInventory: input.addToInventory, rows, issues, canConfirm, fingerprint,
    expectedUnits: rows.reduce((sum, row) => sum + row.expectedQty, 0), receivedUnits: rows.reduce((sum, row) => sum + row.receivedQty, 0),
    inventoryUnits: rows.reduce((sum, row) => sum + row.inventoryUnits, 0) };
  return { head, items, targets, preview };
}

export async function previewPortalInboundReceive(scope: ClientPortalScope, id: number, input: InboundReceiveInput) {
  return db.transaction(async tx => (await planPortalInboundReceive(tx, scope, id, input)).preview,
    { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
