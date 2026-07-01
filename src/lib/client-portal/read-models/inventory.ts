import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { inventory } from '../../../db/schema/inventory';
import { packages } from '../../../db/schema/packages';
import { toPortalInventoryDto } from '../dto';
import { inventoryScopePredicate, inventorySearchPredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';

/** Inventory read-model (extracted from routes/client-portal.ts). */
export async function listPortalInventory(
  scope: ClientPortalScope,
  opts: {
    page: number;
    pageSize: number;
    clientId?: number | null;
    storeId?: number | null;
    search: string;
    /** Low/Out-only filter (Stock Levels checkbox): out of stock, or at/below a
     *  set reorder threshold. Optional + additive — default listing unchanged. */
    lowStock: boolean;
  },
) {
  const { page, pageSize, clientId, storeId, search, lowStock } = opts;
  const where = and(
    eq(inventory.active, true),
    inventoryScopePredicate(scope, { clientId, storeId }),
    inventorySearchPredicate(search),
    lowStock
      ? sql`(${inventory.stockQty} <= 0 or (${inventory.reorderLevel} > 0 and ${inventory.stockQty} <= ${inventory.reorderLevel}))`
      : undefined,
  );
  const rows = await db
    .select({
      item: inventory,
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
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventory)
    .leftJoin(clients, eq(clients.id, inventory.clientId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;

  // Sold-30d per SKU is derived from the ledger ('Ship' rows are negative qty,
  // so we negate the sum). One grouped query over just this page's rows.
  const pageIds = rows.map((r) => r.item.id);
  const soldById = new Map<number, number>();
  if (pageIds.length) {
    const soldRows = await db.execute<{ inventory_id: number; sold: number }>(sql`
      select inventory_id, coalesce(-sum(qty), 0)::int as sold
      from inventory_ledger
      where inventory_id in (${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)})
        and lower(type) like 'ship%'
        and created_at >= now() - interval '30 days'
      group by inventory_id
    `);
    for (const r of soldRows) soldById.set(r.inventory_id, Number(r.sold) || 0);
  }

  return {
    data: rows.map((row) =>
      toPortalInventoryDto({
        ...row.item,
        clientName: row.clientName,
        storeName: row.clientName,
        storeIds: row.storeIds,
        soldLast30Days: soldById.get(row.item.id) ?? 0,
        pkg: row.pkgName != null || row.pkgLength != null ? { name: row.pkgName, length: row.pkgLength, width: row.pkgWidth, height: row.pkgHeight } : null,
      }),
    ),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  };
}
