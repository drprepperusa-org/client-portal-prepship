import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderItems } from '../../../db/schema/order-items';
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

type CanonicalOrderItemRow = {
  orderId: number;
  sku: string;
  name: string | null;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  imageUrl: string | null;
};

async function loadCanonicalOrderItems(orderIds: number[]): Promise<Map<number, CanonicalOrderItemRow[]>> {
  const byOrder = new Map<number, CanonicalOrderItemRow[]>();
  if (orderIds.length === 0) return byOrder;

  const rows = await db
    .select({
      orderId: orderItems.orderId,
      sku: orderItems.sku,
      name: orderItems.name,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      lineTotal: orderItems.lineTotal,
      imageUrl: orderItems.imageUrl,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.orderId), asc(orderItems.lineIndex));

  for (const row of rows) {
    const items = byOrder.get(row.orderId) ?? [];
    items.push(row);
    byOrder.set(row.orderId, items);
  }
  return byOrder;
}

const activeShipmentTrackingNumberSql = () => sql<string | null>`(
  select coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), ''))
  from shipments s
  where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
    and coalesce(s.voided, false) = false
    and coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), '')) is not null
  order by s.id desc
  limit 1
)`;

const activeShipmentCarrierCodeSql = () => sql<string | null>`(
  select coalesce(nullif(trim(s.label_carrier), ''), nullif(trim(s.carrier_code), ''))
  from shipments s
  where (s.order_id = ${orders.id} or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId}))
    and coalesce(s.voided, false) = false
    and coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), '')) is not null
  order by s.id desc
  limit 1
)`;

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
      activeShipmentTrackingNumber: activeShipmentTrackingNumberSql(),
      activeShipmentCarrierCode: activeShipmentCarrierCodeSql(),
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
  const [countRows, canonicalItemsByOrder] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .leftJoin(clients, eq(clients.id, orders.clientId))
      .where(where),
    loadCanonicalOrderItems(rows.map((row) => row.order.id)),
  ]);
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
          canonicalItems: canonicalItemsByOrder.get(row.order.id) ?? [],
          activeShipmentTrackingNumber: row.activeShipmentTrackingNumber,
          activeShipmentCarrierCode: row.activeShipmentCarrierCode,
        },
        { includeFinancials: scope.canViewFinancials, includeWeight: scope.isGlobal },
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
      activeShipmentTrackingNumber: activeShipmentTrackingNumberSql(),
      activeShipmentCarrierCode: activeShipmentCarrierCodeSql(),
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
  const canonicalItemsByOrder = await loadCanonicalOrderItems([row.order.id]);
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
      canonicalItems: canonicalItemsByOrder.get(row.order.id) ?? [],
      activeShipmentTrackingNumber: row.activeShipmentTrackingNumber,
      activeShipmentCarrierCode: row.activeShipmentCarrierCode,
    },
    { includeFinancials: scope.canViewFinancials, includeWeight: scope.isGlobal },
  );
}

export async function awaitingActiveOrderCount(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null },
) {
  // The sidebar/mobile Orders badge mirrors the Orders page's Awaiting shipment
  // tab count. Keep this predicate aligned with listPortalOrders(status:
  // 'awaiting_shipment') so users do not see rows in the table with a blank
  // badge in the nav.
  const where = and(
    orderScopePredicate(scope, filters),
    activeClientPredicate(),
    eq(orders.orderStatus, 'awaiting_shipment'),
    visibleAwaitingOrdersPredicate(),
  );
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);
  return Number(row?.count ?? 0);
}
