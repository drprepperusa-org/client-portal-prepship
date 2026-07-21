import { desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { inventory } from '../db/schema/inventory';
import { classifyStockStatus } from '../lib/inventory-stock-status';
import { offsetOf, paginated } from '../lib/pagination';
import { timedInventoryStep, type InventoryRouteTimings } from '../lib/inventory-timing';
import { computeInventoryQuantityForIds } from './inventory-stock-math';

/** Unified inventory list over the signed ledger quantity. */
export async function buildInventoryListPayload(input: {
  q: { page: number; pageSize: number };
  where: SQL | undefined;
  timings: InventoryRouteTimings;
  shouldRunLiveMetrics: boolean;
}) {
  const { q, where, timings } = input;
  const [rows, countRows] = await timedInventoryStep(timings, 'pageAndCount', () =>
    Promise.all([
      db
        .select()
        .from(inventory)
        .where(where)
        .orderBy(desc(inventory.updatedAt))
        .limit(q.pageSize)
        .offset(offsetOf(q)),
      db.select({ count: sql<number>`count(*)::int` }).from(inventory).where(where),
    ]),
  );
  const quantities = await timedInventoryStep(timings, 'inventoryQuantity', () =>
    computeInventoryQuantityForIds(rows.map((row) => row.id)),
  );

  const soldRows = rows.length
    ? await db.execute<{ inventory_id: number; sold_last_30_days: number }>(sql`
        select inventory_id, abs(coalesce(sum(qty), 0))::int as sold_last_30_days
        from inventory_ledger
        where inventory_id in (${sql.join(rows.map((row) => sql`${row.id}`), sql`, `)})
          and type = 'ship'
          and effective_at >= now() - interval '30 days'
        group by inventory_id
      `)
    : [];
  const soldById = new Map(soldRows.map((row) => [Number(row.inventory_id), Number(row.sold_last_30_days) || 0]));

  const response = paginated(
    rows.map((row) => {
      const quantity = quantities.get(row.id) ?? {
        inventoryQuantity: 0,
        totalReceived: 0,
        totalShipped: 0,
      };
      return {
        ...row,
        inventoryQuantity: quantity.inventoryQuantity,
        stockStatus: classifyStockStatus(quantity.inventoryQuantity, row.reorderLevel),
        soldLast7Days: 0,
        soldLast30Days: soldById.get(row.id) ?? 0,
        velocityPerDay: 0,
        daysSupply: null,
        restockQty: Math.max(0, row.reorderLevel - quantity.inventoryQuantity),
        totalReceived: quantity.totalReceived,
        totalSoldAllTime: quantity.totalShipped,
      };
    }),
    countRows[0]?.count ?? 0,
    q,
  );

  return {
    response,
    total: countRows[0]?.count ?? 0,
    rowCount: rows.length,
  };
}
