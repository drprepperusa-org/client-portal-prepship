import { desc, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { inventory, inventoryLedger } from '../db/schema/inventory';
import { orderItems } from '../db/schema/order-items';
import { orders } from '../db/schema/orders';
import { offsetOf, paginated } from '../lib/pagination';
import { timedInventoryStep, type InventoryRouteTimings } from '../lib/inventory-timing';
import { getFreshInventoryRiskMetricMap } from './reporting-metrics';

/**
 * Stock-levels list pipeline (extracted verbatim from routes/inventory.ts).
 * The route stays responsible for scope construction, the WHERE composition
 * (client/store scope predicates), and slow-route logging.
 */
export async function buildInventoryListPayload(input: {
  q: { page: number; pageSize: number };
  where: SQL | undefined;
  timings: InventoryRouteTimings;
  shouldRunLiveMetrics: boolean;
}) {
  const { q, where, timings, shouldRunLiveMetrics } = input;

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
    ])
  );

  const metricByInventoryId = rows.length
    ? await timedInventoryStep(timings, 'reportingMetrics', () =>
        getFreshInventoryRiskMetricMap(rows.map((row) => row.id), { maxAgeMinutes: 45 })
          .catch((err) => {
            console.warn(
              '[inventory:list] reporting metrics unavailable:',
              err instanceof Error ? err.message : err
            );
            return new Map();
          })
      )
    : new Map();
  const hasFreshMetrics = rows.length > 0 && metricByInventoryId.size === rows.length;

  const soldRows = rows.length && !hasFreshMetrics && shouldRunLiveMetrics
    ? await timedInventoryStep(timings, 'soldLast30Days', () =>
        db.execute<{ inventory_id: number; sold_last_30_days: number }>(sql`
        select
          i.id as inventory_id,
          coalesce(sum(oi.quantity), 0)::int as sold_last_30_days
        from ${inventory} i
        join ${orderItems} oi
          on lower(oi.sku) = lower(i.sku)
        join ${orders} o
          on (
            o.id = oi.order_id
            and (
            (i.client_id is null and o.client_id is null)
            or i.client_id = o.client_id
            )
          )
        where i.id in (${sql.join(rows.map((row) => sql`${row.id}`), sql`, `)})
          and oi.quantity > 0
          and o.order_date >= now() - interval '30 days'
          and coalesce(o.order_status, '') <> 'cancelled'
        group by i.id
      `)
      )
    : [];
  const soldByInventoryId = new Map(
    soldRows.map((row) => [row.inventory_id, Number(row.sold_last_30_days) || 0])
  );

  // 2026-05-13 / refined 2026-05-14 (a+b+c): operator reported the
  // STOCK column shows numbers that don't match -SOLD. Root cause:
  // `stockQty` is only mutated by the auto-deduct path, which
  // didn't track historical orders shipped before the system came
  // online and skips edge cases like external labels.
  //
  // Definition (current — revision (c) 2026-05-14):
  //
  //   effective_stock = total_received − total_sold_shipped_all_time
  //
  // The one non-obvious filter on the sold counter:
  //   Only count `order_status = 'shipped'` (NOT "any non-
  //   cancelled order"). An awaiting_shipment order represents a
  //   future commitment, not inventory that has physically left
  //   the building. STOCK is meant to reflect what we actually
  //   have on the floor right now.
  //
  // History of attempts:
  //   (a) sum of all non-cancelled order quantities — inflated by
  //       awaiting_shipment orders, didn't match operator's "what
  //       has actually gone out" mental model.
  //   (b) anchored sold counter at inventory.created_at — backfired
  //       on auto-synced SKUs whose created_at is TODAY but whose
  //       order history goes back further. Most SKUs are auto-
  //       synced, so most rows came out wrong.
  //   (c) (current) no created_at anchor. For an operator who hasn't
  //       received anything, STOCK = −(every order they've ever
  //       shipped for this SKU). Matches their mental model
  //       exactly: "we haven't received any, so STOCK should be
  //       what's gone."
  //
  // Returns: if a shipment carries `isReturn=true` we should
  // technically add the qty back. We don't yet — returns are rare
  // and the shipments table doesn't break down qty per item.
  //
  // SOLD 30D stays unrelated to this — it's an unbounded "last 30
  // days regardless of status" window by design, used as a "recent
  // velocity" indicator, not a stock signal.
  //
  // The cached stockQty stays in the response as `currentStock` for
  // backward-compat; the new `effectiveStock` is what the operator
  // sees in the STOCK column. A separate admin endpoint
  // POST /admin/reconcile-inventory-stock can backfill stockQty to
  // match effectiveStock for every row (see admin.ts).
  //
  // Allowed under the shipped-data lockdown: this is a READ-only
  // analytics computation. No locked rows are mutated.
  const effectiveRows = rows.length && !hasFreshMetrics && shouldRunLiveMetrics
    ? await timedInventoryStep(timings, 'effectiveStock', () =>
        db.execute<{
          inventory_id: number
          total_received: number
          total_sold: number
        }>(sql`
        with ids as (
          select unnest(array[${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)}]::int[]) as id
        ),
        receives as (
          select l.inventory_id as id, coalesce(sum(l.qty), 0)::int as total_received
          from ${inventoryLedger} l
          where l.inventory_id in (select id from ids)
            and l.type = 'receive'
          group by l.inventory_id
        ),
        sells as (
          select i.id as id, coalesce(sum(oi.quantity), 0)::int as total_sold
          from ${inventory} i
          join ${orderItems} oi
            on lower(oi.sku) = lower(i.sku)
          join ${orders} o
            on (
              o.id = oi.order_id
              and (
              (i.client_id is null and o.client_id is null)
              or i.client_id = o.client_id
              )
            )
          where i.id in (select id from ids)
            and oi.quantity > 0
            -- Only physically-shipped orders count toward sold.
            -- awaiting_shipment = future commitment, not gone.
            -- cancelled = never went out. shipped = left the floor.
            -- (Revision (c): the created_at anchor that lived here
            -- was removed — it backfired on auto-synced SKUs whose
            -- created_at is TODAY but whose order history is
            -- older. See the long comment block above for the
            -- full reasoning.)
            and o.order_status = 'shipped'
          group by i.id
        )
        select
          ids.id as inventory_id,
          coalesce(receives.total_received, 0)::int as total_received,
          coalesce(sells.total_sold, 0)::int as total_sold
        from ids
        left join receives on receives.id = ids.id
        left join sells on sells.id = ids.id
      `)
      )
    : [];
  const effectiveByInventoryId = new Map(
    effectiveRows.map((row) => [
      row.inventory_id,
      {
        totalReceived: Number(row.total_received) || 0,
        totalSold: Number(row.total_sold) || 0,
        effectiveStock: (Number(row.total_received) || 0) - (Number(row.total_sold) || 0),
      },
    ])
  );

  const response = paginated(
    rows.map((row) => {
      const metric = metricByInventoryId.get(row.id);
      if (metric) {
        return {
          ...row,
          soldLast7Days: metric.soldLast7Days,
          soldLast30Days: metric.soldLast30Days,
          velocityPerDay: metric.velocityPerDay,
          daysSupply: metric.daysSupply,
          restockQty: metric.restockQty,
          totalReceived: metric.totalReceived,
          totalSoldAllTime: metric.totalSoldAllTime,
          effectiveStock: metric.effectiveStock,
        };
      }
      const stockQty = Number(row.stockQty ?? 0) || 0;
      const reorderLevel = Number(row.reorderLevel ?? 0) || 0;
      const eff = effectiveByInventoryId.get(row.id) ?? {
        totalReceived: 0,
        totalSold: 0,
        effectiveStock: stockQty,
      };
      return {
        ...row,
        soldLast7Days: 0,
        soldLast30Days: soldByInventoryId.get(row.id) ?? 0,
        velocityPerDay: 0,
        daysSupply: null,
        restockQty: Math.max(0, reorderLevel - stockQty),
        // NEW fields — see comment block above the SQL.
        totalReceived: eff.totalReceived,
        totalSoldAllTime: eff.totalSold,
        effectiveStock: eff.effectiveStock,
      };
    }),
    countRows[0]?.count ?? 0,
    q
  );

  return {
    response,
    total: countRows[0]?.count ?? 0,
    rowCount: rows.length,
  };
}
