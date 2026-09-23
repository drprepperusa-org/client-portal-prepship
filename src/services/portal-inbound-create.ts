import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { clients } from '../db/schema/clients';
import { inboundItems, inboundShipments } from '../db/schema/inbound';
import { portalInboundCreateRequests as requests } from '../db/schema/portal-inbound-create-requests';
import type { NewInboundInput } from '../lib/client-portal/contracts/inbound';
import type { ClientPortalScope } from '../lib/client-portal/scope';
import { toPortalInboundDto } from '../lib/client-portal/dto';

export class InboundCreateRejected extends Error {
  constructor(message: string, readonly status: 403 | 409) { super(message); }
}

/** Called after request-syntax validation. Owns atomic persistence and retry identity. */
export async function createPortalInbound(scope: ClientPortalScope, input: NewInboundInput) {
  if ((!scope.isGlobal && !scope.permissions.includes('settings:write')) || (input.idempotencyKey && !scope.userId)) {
    throw new InboundCreateRejected('Admin access required', 403);
  }
  const requireClient = (clientId: number | null) => {
    if (!scope.isGlobal && (clientId == null || !scope.clientIds.includes(clientId))) {
      throw new InboundCreateRejected('Requested client is outside your access scope.', 403);
    }
  };
  const header = {
    clientId: input.clientId ?? null,
    reference: input.reference?.trim() || null,
    supplier: input.supplier?.trim() || null,
    status: input.status || 'expected',
    carrier: input.carrier?.trim() || null,
    trackingNumber: input.trackingNumber?.trim() || null,
    expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
    notes: input.notes?.trim() || null,
  };
  requireClient(header.clientId);
  const items = (input.items ?? []).filter(item => item.sku?.trim() || item.name?.trim()).map(item => ({
    sku: item.sku?.trim() || null, name: item.name?.trim() || null,
    expectedQty: Number(item.expectedQty) || 0, receivedQty: Number(item.receivedQty) || 0,
  }));
  const key = input.idempotencyKey?.toLowerCase();
  const requestHash = createHash('sha256').update(JSON.stringify({ header, items })).digest('hex');
  return db.transaction(async tx => {
    let replayed = false;
    let inboundId: number | undefined;
    if (key) {
      // Same actor/key waits for commit or rollback, including requests on different API instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['portal-inbound-create', scope.userId, key])}, 0))`);
      const [previous] = await tx.select().from(requests)
        .where(and(eq(requests.actorUserId, scope.userId), eq(requests.requestKey, key))).limit(1);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new InboundCreateRejected('This save was already used with different details. Retry the original request.', 409);
        if (previous.inboundId == null) throw new InboundCreateRejected('The saved shipment is no longer available. This request cannot create it again.', 409);
        inboundId = previous.inboundId;
        replayed = true;
      }
    }
    if (!replayed) {
      const [created] = await tx.insert(inboundShipments).values({
        ...header, receivedDate: header.status === 'received' ? new Date() : null, updatedAt: new Date(),
      }).returning({ id: inboundShipments.id });
      inboundId = created!.id;
      if (items.length) await tx.insert(inboundItems).values(items.map(item => ({ ...item, inboundId: inboundId! })));
      if (key) await tx.insert(requests).values({ actorUserId: scope.userId, requestKey: key, requestHash, inboundId });
    }
    const [saved] = await tx.select({ shipment: inboundShipments, clientName: clients.name }).from(inboundShipments)
      .leftJoin(clients, eq(clients.id, inboundShipments.clientId)).where(eq(inboundShipments.id, inboundId!)).limit(1);
    if (!saved) throw new InboundCreateRejected('The saved shipment is no longer available.', 409);
    requireClient(saved.shipment.clientId);
    const savedItems = await tx.select().from(inboundItems).where(eq(inboundItems.inboundId, inboundId!)).orderBy(inboundItems.id);
    return { data: toPortalInboundDto({ ...saved.shipment, clientName: saved.clientName }, savedItems), replayed };
  });
}
