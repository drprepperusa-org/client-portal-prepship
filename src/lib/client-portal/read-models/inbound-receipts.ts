import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { inventory, inventoryLedger } from '../../../db/schema/inventory';
import type { Paginated } from '../contracts/common';
import type { PortalInboundReceipt } from '../contracts/inbound';
import { inventoryScopePredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';

type ReceiptListOptions = {
  page: number;
  pageSize: number;
  clientId?: number | null;
  storeId?: number | null;
};

/**
 * Received-inventory read model.
 *
 * Source: inventory_ledger rows whose canonical movement type is `receive`.
 * Clock: effective_at (operator-entered received date), then created_at.
 * Quantity: inventory_ledger.qty verbatim. CP never reconstructs receipt batches.
 */
export async function listPortalInboundReceipts(
  scope: ClientPortalScope,
  options: ReceiptListOptions,
): Promise<Paginated<PortalInboundReceipt>> {
  const { page, pageSize, clientId, storeId } = options;
  const receivedAt = sql<Date | string>`coalesce(${inventoryLedger.effectiveAt}, ${inventoryLedger.createdAt})`;
  const where = and(
    eq(inventoryLedger.type, 'receive'),
    inventoryScopePredicate(scope),
    clientId ? eq(inventory.clientId, clientId) : undefined,
    storeId ? sql`${clients.storeIds} && array[${storeId}]::integer[]` : undefined,
  );

  const base = db
    .select({
      id: inventoryLedger.id,
      inventoryId: inventoryLedger.inventoryId,
      clientId: inventory.clientId,
      clientName: clients.name,
      sku: inventory.sku,
      name: inventory.name,
      receivedUnits: inventoryLedger.qty,
      receivedAt,
      note: inventoryLedger.note,
    })
    .from(inventoryLedger)
    .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
    .leftJoin(clients, eq(clients.id, inventory.clientId));

  const [rows, countRows] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(receivedAt), desc(inventoryLedger.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryLedger)
      .innerJoin(inventory, eq(inventory.id, inventoryLedger.inventoryId))
      .leftJoin(clients, eq(clients.id, inventory.clientId))
      .where(where),
  ]);
  const total = Number(countRows[0]?.count ?? rows.length);

  return {
    data: rows.map((row) => ({
      ...row,
      receivedAt: row.receivedAt instanceof Date
        ? row.receivedAt.toISOString()
        : new Date(row.receivedAt).toISOString(),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
