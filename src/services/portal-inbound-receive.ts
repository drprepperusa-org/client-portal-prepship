import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { inboundItems, inboundShipments } from '../db/schema/inbound';
import type { ClientPortalScope } from '../lib/client-portal/scope';
import type { InboundReceiveConfirmation } from '../lib/client-portal/contracts/inbound-receive-preview';
import { planPortalInboundReceive, InboundReceiveRejected } from './portal-inbound-receive-plan';
export { InboundReceiveRejected } from './portal-inbound-receive-plan';
import { applyInventoryMovementInTransaction } from './inventory-movement';

/** Header, item quantities and canonical ledger movements commit together. */
export async function receivePortalInbound(scope: ClientPortalScope, id: number, input: InboundReceiveConfirmation) {
  return db.transaction(async tx => {
    const { head, items, targets, preview } = await planPortalInboundReceive(tx, scope, id, input, true);
    if (!preview.canConfirm) throw new InboundReceiveRejected('Resolve the highlighted inventory matches and preview again before receiving.', 409);
    if (!input.previewFingerprint || input.previewFingerprint !== preview.fingerprint) {
      throw new InboundReceiveRejected('The receiving preview has changed. Preview the shipment again before confirming.', 409);
    }
    const quantities = new Map(preview.rows.map(row => [row.id, row.receivedQty]));
    const bumps: Array<{ sku: string; qty: number; matched: boolean }> = [];
    const receivedAt = new Date();
    for (const item of items) {
      const qty = quantities.get(item.id)!;
      await tx.update(inboundItems).set({ receivedQty: qty }).where(eq(inboundItems.id, item.id));
      if (!input.addToInventory || qty <= 0) continue;
      const inventoryId = targets.get(item.id)![0]!;
      await applyInventoryMovementInTransaction(tx, {
        inventoryId, type: 'receive', qty,
        note: `Inbound ${head.reference ?? `#${head.id}`}`, createdBy: scope.email ?? scope.userId, effectiveAt: receivedAt,
        idempotencyKey: `portal-inbound:${head.id}:item:${item.id}:receive`, sourceEntity: 'client_portal_inbound', sourceId: `${head.id}:item:${item.id}`,
      });
      bumps.push({ sku: item.sku!, qty, matched: true });
    }
    await tx.update(inboundShipments).set({ status: 'received', receivedDate: receivedAt, updatedAt: receivedAt }).where(eq(inboundShipments.id, id));
    return { id, reference: head.reference, status: 'received' as const, bumps };
  });
}
