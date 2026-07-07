import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderOverrides, orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import { toPortalOrderDto } from '../dto';
import { orderCustomerShippingRateSql } from '../customer-shipping-rate';
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
      // CP-040: the ONE customer shipping value the Orders list needs — the backend
      // resolver's C. Shipping Rate (frozen billing_line_items shipping line per
      // shipment → live billing-config projection), summed over the order's
      // shipments. Never orders.shipping_amount (buyer-paid store shipping); never
      // the internal carrier / service / selected-rate.
      resolvedShippingRate: orderCustomerShippingRateSql(),
      // Canonical signals for the backend-owned order fulfillment status
      // (see lib/client-portal/order-status.ts): the latest ACTIVE (non-voided)
      // shipment's tracking status, plus whether the order has any active / any
      // voided shipment. Matched by the exact order_id, or — for shipments
      // synced without a linked order_id — by order_number scoped to the SAME
      // client (s.client_id = orders.client_id). The client scope on the
      // order_number fallback is required for tenant isolation: two clients can
      // share an order number, so an unscoped order_number match could surface a
      // different client's shipment status.
      activeTrackingStatus: sql<string | null>`(
        select s.tracking_status from shipments s
        where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
          and coalesce(s.voided, false) = false
        order by s.id desc
        limit 1
      )`,
      hasActiveShipment: sql<boolean>`exists (
        select 1 from shipments s
        where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
          and coalesce(s.voided, false) = false
      )`,
      hasVoidedShipment: sql<boolean>`exists (
        select 1 from shipments s
        where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
          and coalesce(s.voided, false) = true
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
          // CP-040: list provides the resolved customer shipping rate.
          shippingCharged: row.resolvedShippingRate,
          activeTrackingStatus: row.activeTrackingStatus,
          hasActiveShipment: row.hasActiveShipment,
          hasVoidedShipment: row.hasVoidedShipment,
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
      // CP-040: resolved customer shipping rate (frozen billing line → projection),
      // summed over the order's shipments — the SAME resolver the Shipments surface
      // uses. Never orders.shipping_amount.
      resolvedShippingRate: orderCustomerShippingRateSql(),
      // Canonical signals for the backend-owned order fulfillment status
      // (see lib/client-portal/order-status.ts).
      activeTrackingStatus: sql<string | null>`(
        select s.tracking_status from shipments s
        where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
          and coalesce(s.voided, false) = false
        order by s.id desc
        limit 1
      )`,
      hasActiveShipment: sql<boolean>`exists (
        select 1 from shipments s
        where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
          and coalesce(s.voided, false) = false
      )`,
      hasVoidedShipment: sql<boolean>`exists (
        select 1 from shipments s
        where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
          and coalesce(s.voided, false) = true
      )`,
    })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(and(eq(orders.id, id), orderScopePredicate(scope), activeClientPredicate()))
    .limit(1);
  if (!row) return null;
  return toPortalOrderDto(
    {
      ...row.order,
      clientName: row.clientName,
      storeName: row.clientName,
      override: row.override,
      shippingCharged: row.resolvedShippingRate,
      activeTrackingStatus: row.activeTrackingStatus,
      hasActiveShipment: row.hasActiveShipment,
      hasVoidedShipment: row.hasVoidedShipment,
    },
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
