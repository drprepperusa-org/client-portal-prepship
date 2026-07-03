import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderOverrides, orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import { toPortalOrderDto } from '../dto';
import {
  activeClientPredicate,
  orderScopePredicate,
  orderSearchPredicate,
  visibleAwaitingOrdersPredicate,
} from '../predicates';
import type { ClientPortalScope } from '../scope';

/**
 * Orders read-model (extracted from routes/client-portal.ts): scoped list,
 * single-order detail, and the live awaiting count. Routes stay responsible
 * for param parsing, RBAC/scope resolution, auditing, and HTTP shaping.
 */

function liveAwaitingSince() {
  return new Date(Date.now() - 30 * 86_400_000);
}

export async function listPortalOrders(
  scope: ClientPortalScope,
  opts: { page: number; pageSize: number; status?: string | null; clientId?: number | null; storeId?: number | null; search: string },
) {
  const { page, pageSize, status, clientId, storeId, search } = opts;
  const where = and(
    orderScopePredicate(scope, { clientId, storeId }),
    activeClientPredicate(),
    status ? eq(orders.orderStatus, status) : undefined,
    status === 'awaiting_shipment' ? visibleAwaitingOrdersPredicate() : undefined,
    orderSearchPredicate(search),
  );
  const rows = await db
    .select({
      order: orders,
      override: orderOverrides,
      clientName: clients.name,
      storeIds: clients.storeIds,
      // CP-018: billed customer shipping (Σ billing_line_items line_type='shipping')
      // — the ONLY shipping value the Orders list needs. The internal carrier /
      // service / selected-rate / provider-account subqueries were removed: none
      // of that data is exposed to the client any more, so we no longer fetch it.
      billedShipping: sql<string | null>`(
        select coalesce(sum(bli.total_cost), 0)::text
        from billing_line_items bli
        where bli.order_id = ${orders.id} and bli.line_type = 'shipping'
      )`,
    })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(where)
    .orderBy(desc(orders.orderDate), desc(orders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  return {
    data: rows.map((row) =>
      toPortalOrderDto(
        {
          ...row.order,
          clientName: row.clientName,
          storeName: row.clientName,
          override: row.override,
          // CP-018: list now provides the billed customer shipping charge.
          shippingCharged: row.billedShipping,
        },
        { includeFinancials: scope.canViewFinancials },
      ),
    ),
    pagination: {
      page,
      pageSize,
      total: Number(count),
      totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)),
    },
  };
}

export async function getPortalOrder(scope: ClientPortalScope, id: number) {
  const [row] = await db
    .select({
      order: orders,
      override: orderOverrides,
      clientName: clients.name,
      // Billed shipping for this order (customer-facing shipping charge) — the
      // same billed shipping the Billing surfaces show, never the internal cost.
      billedShipping: sql<string | null>`(
        select coalesce(sum(bli.total_cost), 0)::text
        from billing_line_items bli
        where bli.order_id = ${orders.id} and bli.line_type = 'shipping'
      )`,
    })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(and(eq(orders.id, id), orderScopePredicate(scope), activeClientPredicate()))
    .limit(1);
  if (!row) return null;
  return toPortalOrderDto(
    { ...row.order, clientName: row.clientName, storeName: row.clientName, override: row.override, shippingCharged: row.billedShipping },
    { includeFinancials: scope.canViewFinancials },
  );
}

export async function awaitingActiveOrderCount(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null },
) {
  const where = and(
    orderScopePredicate(scope, filters),
    activeClientPredicate(),
    eq(orders.orderStatus, 'awaiting_shipment'),
    visibleAwaitingOrdersPredicate(),
    gte(orders.orderDate, liveAwaitingSince()),
    eq(orders.externallyShipped, false),
    sql`coalesce((${orders.raw}->>'externallyFulfilled')::boolean, false) = false`,
    sql`jsonb_array_length(coalesce(${orders.items}, '[]'::jsonb)) > 0`,
    sql`not exists (
      select 1
      from ${shipments} active_shipment
      where active_shipment.order_id = ${orders.id}
        and active_shipment.voided = false
    )`,
  );
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);
  return Number(row?.count ?? 0);
}
