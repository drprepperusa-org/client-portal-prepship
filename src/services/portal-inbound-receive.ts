import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { inboundItems, inboundShipments } from '../db/schema/inbound';
import { inventory } from '../db/schema/inventory';
import type { ClientPortalScope } from '../lib/client-portal/scope';
import type { InboundReceiveInput } from '../lib/client-portal/contracts/inbound';
import { validateInboundReceive } from '../lib/client-portal/contracts/inbound-receive-validation';
import { applyInventoryMovementInTransaction } from './inventory-movement';

export class InboundReceiveRejected extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409) { super(message); }
}

/** Header, item quantities and canonical ledger movements commit together. */
export async function receivePortalInbound(scope: ClientPortalScope, id: number, input: InboundReceiveInput) {
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) throw new InboundReceiveRejected('Admin access required', 403);
  if (Object.keys(validateInboundReceive(input)).length) throw new InboundReceiveRejected('Check the receiving quantities.', 400);
  return db.transaction(async tx => {
    const [head] = await tx.select().from(inboundShipments).where(eq(inboundShipments.id, id)).for('update');
    if (!head) throw new InboundReceiveRejected('Inbound shipment not found', 404);
    if (!scope.isGlobal && (head.clientId == null || !scope.clientIds.includes(head.clientId))) {
      throw new InboundReceiveRejected('Inbound shipment is outside your access scope.', 403);
    }
    if (head.status === 'received' || head.status === 'cancelled') {
      throw new InboundReceiveRejected('This shipment is already received or cancelled. Close this form and refresh the list to check its saved status.', 409);
    }
    if (input.addToInventory && head.clientId == null) throw new InboundReceiveRejected('Assign a client before adding received units to inventory.', 409);
    const items = await tx.select().from(inboundItems).where(eq(inboundItems.inboundId, id)).orderBy(inboundItems.id).for('update');
    const quantities = new Map(input.items.map(item => [item.id, Number(item.receivedQty)]));
    if (quantities.size !== items.length || items.some(item => !quantities.has(item.id))) {
      throw new InboundReceiveRejected('The shipment items have changed. Close and reopen it before receiving.', 409);
    }
    const bumps: Array<{ sku: string; qty: number; matched: boolean }> = [];
    const receivedAt = new Date();
    for (const item of items) {
      const qty = quantities.get(item.id)!;
      await tx.update(inboundItems).set({ receivedQty: qty }).where(eq(inboundItems.id, item.id));
      if (!input.addToInventory || qty <= 0) continue;
      const matches = item.sku ? await tx.select({ id: inventory.id }).from(inventory)
        .where(and(eq(inventory.clientId, head.clientId!), sql`lower(${inventory.sku}) = lower(${item.sku})`)).limit(2) : [];
      if (matches.length > 1) throw new InboundReceiveRejected('More than one inventory item matches a shipment SKU. Resolve the duplicate before receiving.', 409);
      const inv = matches[0];
      if (!inv) { bumps.push({ sku: item.sku ?? '(No SKU)', qty, matched: false }); continue; }
      await applyInventoryMovementInTransaction(tx, {
        inventoryId: inv.id, type: 'receive', qty,
        note: `Inbound ${head.reference ?? `#${head.id}`}`, createdBy: scope.email ?? scope.userId, effectiveAt: receivedAt,
        idempotencyKey: `portal-inbound:${head.id}:item:${item.id}:receive`, sourceEntity: 'client_portal_inbound', sourceId: `${head.id}:item:${item.id}`,
      });
      bumps.push({ sku: item.sku!, qty, matched: true });
    }
    await tx.update(inboundShipments).set({ status: 'received', receivedDate: receivedAt, updatedAt: receivedAt }).where(eq(inboundShipments.id, id));
    return { id, reference: head.reference, status: 'received' as const, bumps };
  });
}
