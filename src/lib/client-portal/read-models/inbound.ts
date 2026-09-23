import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { inboundItems, inboundShipments } from '../../../db/schema/inbound';
import type { Paginated } from '../contracts/common';
import type { PortalInbound } from '../contracts/inbound';
import { toPortalInboundDto } from '../dto';
import type { ClientPortalScope } from '../scope';

export type InboundListOptions = {
  clientId?: number;
  search?: string;
  status?: 'expected' | 'in_transit' | 'received' | 'cancelled';
  page: number;
  pageSize: number;
};

/** Canonical PO headers, with full item quantities owned by toPortalInboundDto.
 * List clock: created_at, then id. Scope intentionally remains client-assignment based.
 */
export async function listPortalInbound(scope: ClientPortalScope, options: InboundListOptions): Promise<Paginated<PortalInbound>> {
  const { clientId, search, status, pageSize } = options;
  const pattern = search ? `%${search.replace(/[\\%_]/g, '\\$&')}%` : undefined;
  const where = and(
    scope.isGlobal ? undefined : scope.clientIds.length ? inArray(inboundShipments.clientId, scope.clientIds) : sql`false`,
    clientId ? eq(inboundShipments.clientId, clientId) : undefined,
    status ? eq(inboundShipments.status, status) : undefined,
    pattern ? or(
      ilike(inboundShipments.reference, pattern), ilike(inboundShipments.supplier, pattern),
      ilike(inboundShipments.trackingNumber, pattern),
      sql`exists (select 1 from ${inboundItems} where ${inboundItems.inboundId} = ${inboundShipments.id} and ${inboundItems.sku} ilike ${pattern})`,
    ) : undefined,
  );
  // One snapshot keeps count, headers and item totals consistent during concurrent receiving.
  return db.transaction(async tx => {
    const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(inboundShipments).where(where);
    const total = Number(count?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(options.page, totalPages);
    const heads = await tx.select({ shipment: inboundShipments, clientName: clients.name })
      .from(inboundShipments).leftJoin(clients, eq(clients.id, inboundShipments.clientId)).where(where)
      .orderBy(desc(inboundShipments.createdAt), desc(inboundShipments.id)).limit(pageSize).offset((page - 1) * pageSize);
    const ids = heads.map(h => h.shipment.id);
    const items = ids.length ? await tx.select().from(inboundItems).where(inArray(inboundItems.inboundId, ids)).orderBy(inboundItems.id) : [];
    const byInbound = new Map<number, typeof items>();
    for (const item of items) {
      const list = byInbound.get(item.inboundId) ?? [];
      list.push(item); byInbound.set(item.inboundId, list);
    }
    return {
      data: heads.map(h => toPortalInboundDto({ ...h.shipment, clientName: h.clientName }, byInbound.get(h.shipment.id) ?? [])),
      pagination: { page, pageSize, total, totalPages },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
