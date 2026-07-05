import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { inventory } from '../../../db/schema/inventory';
import { packages } from '../../../db/schema/packages';
import {
  computeEffectiveStockForIds,
  type EffectiveStockEntry,
} from '../../../services/inventory-stock-math';
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
     *  set reorder threshold. Optional + additive; default listing unchanged. */
    lowStock: boolean;
  },
) {
  const { page, pageSize, clientId, storeId, search, lowStock } = opts;
  const where = and(
    eq(inventory.active, true),
    inventoryScopePredicate(scope, { clientId, storeId }),
    inventorySearchPredicate(search),
  );
  const offset = (page - 1) * pageSize;

  const baseRowsQuery = (filter: SQL | undefined) =>
    db
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
      .where(filter)
      .orderBy(desc(inventory.updatedAt), desc(inventory.id));

  const stockFor = (
    row: { item: { id: number; stockQty: number | null; reorderLevel: number | null } },
    effectiveById: Map<number, EffectiveStockEntry>,
  ) => {
    const effective = effectiveById.get(row.item.id);
    return effective?.effectiveStock ?? Number(row.item.stockQty ?? 0);
  };
  const isLowOrOut = (
    row: { item: { id: number; stockQty: number | null; reorderLevel: number | null } },
    effectiveById: Map<number, EffectiveStockEntry>,
  ) => {
    const stock = stockFor(row, effectiveById);
    const reorder = Number(row.item.reorderLevel ?? 0);
    return stock <= 0 || (reorder > 0 && stock <= reorder);
  };

  let rows;
  let count: number;
  let effectiveById: Map<number, EffectiveStockEntry>;

  if (lowStock) {
    const candidateRows = await baseRowsQuery(where);
    effectiveById = await computeEffectiveStockForIds(candidateRows.map((row) => row.item.id));
    const filteredRows = candidateRows.filter((row) => isLowOrOut(row, effectiveById));
    count = filteredRows.length;
    rows = filteredRows.slice(offset, offset + pageSize);
  } else {
    const [pageRows, countRows] = await Promise.all([
      baseRowsQuery(where).limit(pageSize).offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(inventory)
        .leftJoin(clients, eq(clients.id, inventory.clientId))
        .where(where),
    ]);
    rows = pageRows;
    count = Number(countRows[0]?.count ?? pageRows.length);
    effectiveById = await computeEffectiveStockForIds(pageRows.map((row) => row.item.id));
  }

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
    data: rows.map((row) => {
      const effective = effectiveById.get(row.item.id);
      return toPortalInventoryDto({
        ...row.item,
        clientName: row.clientName,
        storeName: row.clientName,
        storeIds: row.storeIds,
        warehouseShipped30d: soldById.get(row.item.id) ?? 0,
        effectiveStock: effective?.effectiveStock ?? Number(row.item.stockQty ?? 0),
        pkg:
          row.pkgName != null || row.pkgLength != null
            ? { name: row.pkgName, length: row.pkgLength, width: row.pkgWidth, height: row.pkgHeight }
            : null,
      });
    }),
    pagination: { page, pageSize, total: count, totalPages: Math.max(1, Math.ceil(count / pageSize)) },
  };
}
