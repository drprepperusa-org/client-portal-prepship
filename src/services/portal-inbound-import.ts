import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { clients } from '../db/schema/clients';
import { inboundItems, inboundShipments } from '../db/schema/inbound';
import { portalInboundCreateRequests as requests } from '../db/schema/portal-inbound-create-requests';
import type { ClientPortalScope } from '../lib/client-portal/scope';
import type { InboundImportInput, InboundImportResult } from '../lib/client-portal/contracts/inbound-import';
import { parseInboundImport } from '../lib/client-portal/inbound-import-csv';

export class InboundImportRejected extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409) { super(message); }
}
function authorize(scope: ClientPortalScope) {
  if (!scope.userId || (!scope.isGlobal && !scope.permissions.includes('settings:write'))) throw new InboundImportRejected('Admin access required', 403);
}
async function parse(scope: ClientPortalScope, csv: string, reader: Pick<typeof db, 'select'>) {
  const allowed = await reader.select({ id: clients.id, name: clients.name }).from(clients)
    .where(and(eq(clients.active, true), scope.isGlobal ? undefined : scope.clientIds.length ? inArray(clients.id, scope.clientIds) : sql`false`));
  return parseInboundImport(csv, allowed);
}
export async function previewPortalInboundImport(scope: ClientPortalScope, csv: string) {
  authorize(scope); return (await parse(scope, csv, db)).preview;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function childKey(key: string, index: number) {
  if (index === 0) return key;
  const hex = digest(`portal-inbound-import:${key}:${index}`).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One atomic batch, with durable actor-scoped receipts in the existing private request table. */
export async function importPortalInbound(scope: ClientPortalScope, input: InboundImportInput): Promise<InboundImportResult> {
  authorize(scope);
  const key = input.idempotencyKey.toLowerCase();
  const hash = digest(JSON.stringify(['portal-inbound-import', key, input.csv, input.fingerprint]));
  return db.transaction(async tx => {
    // Share the create lock namespace, so a key cannot race with single-shipment creation.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['portal-inbound-create', scope.userId, key])}, 0))`);
    const [previous] = await tx.select().from(requests).where(and(eq(requests.actorUserId, scope.userId), eq(requests.requestKey, key)));
    if (previous) {
      if (previous.requestHash !== hash) throw new InboundImportRejected('This import request was already used with different data. Retry the original import.', 409);
      const receipts = await tx.select({ inboundId: requests.inboundId, clientId: inboundShipments.clientId }).from(requests)
        .leftJoin(inboundShipments, eq(inboundShipments.id, requests.inboundId))
        .where(and(eq(requests.actorUserId, scope.userId), eq(requests.requestHash, hash)));
      if (receipts.some(row => row.inboundId == null)) throw new InboundImportRejected('An imported shipment was deleted. This request cannot create it again.', 409);
      if (!scope.isGlobal && receipts.some(row => row.clientId == null || !scope.clientIds.includes(row.clientId))) {
        throw new InboundImportRejected('An imported shipment is outside your current access.', 403);
      }
      const ids = receipts.map(row => row.inboundId!);
      const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(inboundItems).where(inArray(inboundItems.inboundId, ids));
      return { created: ids.length, itemsCreated: Number(count?.total ?? 0), skipped: 0, replayed: true };
    }
    const { preview, shipments } = await parse(scope, input.csv, tx);
    if (!preview.valid) throw new InboundImportRejected('The CSV has errors. Preview it again and correct the highlighted rows.', 400);
    if (preview.fingerprint !== input.fingerprint) throw new InboundImportRejected('The preview has changed. Preview the CSV again before importing.', 409);
    const heads = await tx.insert(inboundShipments).values(shipments.map(({ items: _items, ...header }) => ({
      ...header, expectedDate: header.expectedDate ? new Date(header.expectedDate) : null, updatedAt: new Date(),
    }))).returning({ id: inboundShipments.id, clientId: inboundShipments.clientId, reference: inboundShipments.reference });
    const byGroup = new Map(heads.map(head => [JSON.stringify([head.clientId, head.reference]), head.id]));
    const rows = shipments.flatMap(shipment => shipment.items!.map(item => ({ ...item,
      inboundId: byGroup.get(JSON.stringify([shipment.clientId, shipment.reference]))!, receivedQty: 0,
    })));
    // Keep each statement comfortably below the PostgreSQL parameter limit.
    for (let offset = 0; offset < rows.length; offset += 500) await tx.insert(inboundItems).values(rows.slice(offset, offset + 500));
    await tx.insert(requests).values(shipments.map((shipment, index) => ({
      actorUserId: scope.userId, requestKey: childKey(key, index), requestHash: hash,
      inboundId: byGroup.get(JSON.stringify([shipment.clientId, shipment.reference]))!,
    })));
    return { created: heads.length, itemsCreated: rows.length, skipped: 0, replayed: false };
  });
}
