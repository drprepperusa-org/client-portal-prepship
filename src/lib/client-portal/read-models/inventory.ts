import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { inventory } from '../../../db/schema/inventory';
import { packages } from '../../../db/schema/packages';
import { inventoryQuantitySql } from '../../../services/inventory-stock-math';
import { toPortalInventoryDto } from '../dto';
import { inventoryScopePredicate, inventorySearchPredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';

/** Client Portal inventory read model over the shared ledger quantity authority. */
export async function listPortalInventory(
  scope: ClientPortalScope,
  opts: {
    page: number;
    pageSize: number;
    clientId?: number | null;
    storeId?: number | null;
    search: string;
    lowStock: boolean;
  },
) {
  const { page, pageSize, clientId, storeId, search, lowStock } = opts;
  const quantity = inventoryQuantitySql(inventory.id);
  const where = and(
    eq(inventory.active, true),
    // An inventory row with no client cannot be attributed to anyone: blank
    // Client, zero stock, no image. 571 of these exist and 317 shadow a real SKU
    // that has all three, so the portal list showed the empty duplicates while
    // the genuine rows sat behind them.
    //
    // Display filter only — nothing is deleted and the rows stay queryable
    // elsewhere. The orphans are a separate data-integrity problem: something
    // writes inventory without a client_id, and that source still needs fixing.
    sql`${inventory.clientId} is not null`,
    inventoryScopePredicate(scope, { clientId, storeId }),
    inventorySearchPredicate(search),
    lowStock ? sql`${quantity} <= ${inventory.reorderLevel}` : undefined,
  );
  const offset = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    db
      .select({
        item: inventory,
        inventoryQuantity: quantity,
        clientName: clients.name,
        storeIds: clients.storeIds,
        pkgName: packages.name,
        pkgLength: packages.length,
        pkgWidth: packages.width,
        pkgHeight: packages.height,
      })
      .from(inventory)
      .leftJoin(clients, eq(clients.id, inventory.clientId))
      .leftJoin(packages, eq(packages.id, inventory.packageId))
      .where(where)
      .orderBy(desc(inventory.updatedAt), desc(inventory.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventory)
      .leftJoin(clients, eq(clients.id, inventory.clientId))
      .where(where),
  ]);

  const pageIds = rows.map((row) => row.item.id);
  const soldById = new Map<number, number>();
  if (pageIds.length) {
    const soldRows = await db.execute<{ inventory_id: number; sold: number }>(sql`
      select inventory_id, abs(coalesce(sum(qty), 0))::int as sold
      from inventory_ledger
      where inventory_id in (${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)})
        and lower(type) like 'ship%'
        and coalesce(effective_at, created_at) >= now() - interval '30 days'
      group by inventory_id
    `);
    for (const row of soldRows) soldById.set(Number(row.inventory_id), Number(row.sold) || 0);
  }

  return {
    data: rows.map((row) => toPortalInventoryDto({
      ...row.item,
      clientName: row.clientName,
      storeName: row.clientName,
      storeIds: row.storeIds,
      warehouseShipped30d: soldById.get(row.item.id) ?? 0,
      inventoryQuantity: Number(row.inventoryQuantity),
      pkg:
        row.pkgName != null || row.pkgLength != null
          ? { name: row.pkgName, length: row.pkgLength, width: row.pkgWidth, height: row.pkgHeight }
          : null,
    })),
    pagination: {
      page,
      pageSize,
      total: Number(countRows[0]?.count ?? rows.length),
      totalPages: Math.max(1, Math.ceil(Number(countRows[0]?.count ?? rows.length) / pageSize)),
    },
  };
}
