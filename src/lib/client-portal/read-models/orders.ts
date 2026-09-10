import { orderFulfillmentStatusSql } from '../order-status';
import { tableOrderBy, referenceOrder, type SortInput } from './table-sort';
import { orderFulfillmentSignalSelects } from '../order-fulfillment-signals';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderItems } from '../../../db/schema/order-items';
import { orderOverrides, orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import { toPortalOrderDto } from '../dto';
import { orderCustomerShippingRateSql } from '../customer-shipping-rate';
import {
  orderOutboundShipmentMatchSql,
  portalOrderFulfillmentBucketPredicateSql,
  type PortalOrderFulfillmentBucket,
} from '../order-lifecycle';
import {
  activeClientPredicate,
  orderScopePredicate,
  orderSearchPredicate,
  visibleAwaitingOrdersPredicate,
} from '../predicates';
import { orderReplacementBadgeSelects } from './replacements';
import { replacementsSchemaReady } from '../replacements-schema-readiness';
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

// CP-069: the order's display tracking identity comes from its latest ACTIVE OUTBOUND shipment
// (the shared PrepShip aggregate row set: matched by order_id or client-scoped order_number,
// voided = false, is_return = false). A return label's tracking number can never become the
// order's tracking number.
const activeShipmentTrackingNumberSql = () => sql<string | null>`(
  select coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), ''))
  from shipments s
  where ${orderOutboundShipmentMatchSql('s')}
    and coalesce(s.voided, false) = false
    and coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), '')) is not null
  order by s.id desc
  limit 1
)`;

const activeShipmentCarrierCodeSql = () => sql<string | null>`(
  select coalesce(nullif(trim(s.label_carrier), ''), nullif(trim(s.carrier_code), ''))
  from shipments s
  where ${orderOutboundShipmentMatchSql('s')}
    and coalesce(s.voided, false) = false
    and coalesce(nullif(trim(s.label_tracking), ''), nullif(trim(s.tracking_number), '')) is not null
  order by s.id desc
  limit 1
)`;

/**
 * CP-069 — the Orders tabs and the awaiting badge filter on PrepShip's effective lifecycle
 * (cancelled | shipped | pending buckets over orderLifecycleEffectiveStatusSql), the SAME
 * expression the DTO badge resolver mirrors in TypeScript, so a row can never sit in a tab
 * that contradicts its badge. Predicates render on the inner effective CASE so PrepShip 0057's
 * expression index on the shared database stays eligible. The tab ids are the API's historical
 * values: 'awaiting_shipment' is the pending bucket (awaiting, on hold, awaiting payment,
 * pending fulfillment) narrowed by the portal's own placeholder suppression
 * (visibleAwaitingOrdersPredicate — a portal rule; PrepShip's same-named eBay rule is not ported).
 */
export const PORTAL_ORDER_STATUS_FILTERS = ['awaiting_shipment', 'shipped', 'cancelled'] as const;
export type PortalOrderStatusFilter = (typeof PORTAL_ORDER_STATUS_FILTERS)[number];

export function isPortalOrderStatusFilter(value: unknown): value is PortalOrderStatusFilter {
  return typeof value === 'string' && (PORTAL_ORDER_STATUS_FILTERS as readonly string[]).includes(value);
}

const ORDER_FILTER_BUCKET: Record<PortalOrderStatusFilter, PortalOrderFulfillmentBucket> = {
  awaiting_shipment: 'pending',
  shipped: 'shipped',
  cancelled: 'cancelled',
};

export function orderStatusFilterPredicate(status: PortalOrderStatusFilter | null | undefined) {
  if (!status) return undefined;
  return and(
    portalOrderFulfillmentBucketPredicateSql(ORDER_FILTER_BUCKET[status]),
    status === 'awaiting_shipment' ? visibleAwaitingOrdersPredicate() : undefined,
  );
}

export async function listPortalOrders(
  scope: ClientPortalScope,
  opts: SortInput & { page: number; pageSize: number; status?: PortalOrderStatusFilter | null; clientId?: number | null; storeId?: number | null; search: string },
) {
  const { page, pageSize, status, clientId, storeId, search } = opts;
  // CP-061: badge selects must be constants while the shared prod DB lacks the
  // replacement tables — a live subquery there would 500 the whole list.
  const replacementsReady = await replacementsSchemaReady();
  const where = and(
    orderScopePredicate(scope, { clientId, storeId }),
    activeClientPredicate(),
    orderStatusFilterPredicate(status),
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
      // CP-069: canonical signals for the backend-owned order fulfillment status
      // (lib/client-portal/order-status.ts) — whether the order has an active / a voided
      // OUTBOUND shipment (PrepShip's aggregate rule: voided, is_return), from the ONE
      // projection PS-486 shares with the return-request recheck. Matched by the exact
      // order_id, or — for shipments synced without a linked order_id — by order_number
      // scoped to the SAME client (tenant isolation). Carrier tracking status is NOT read.
      ...orderFulfillmentSignalSelects(),
      // CP-061: backend-derived REPLACE badge — the frontend renders these
      // fields verbatim and never re-derives them from replacement rows.
      ...orderReplacementBadgeSelects(replacementsReady, sql`${orders.id}`),
    })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(where)
    .orderBy(...tableOrderBy(opts, {
      date: orders.orderDate, client: sql`lower(${clients.name})`,
      status: orderFulfillmentStatusSql(), order: referenceOrder(orders.orderNumber),
      items: sql`(select lower(oi.name) from order_items oi where oi.order_id = ${orders.id} order by oi.line_index limit 1)`,
      sku: sql`(select lower(oi.sku) from order_items oi where oi.order_id = ${orders.id} order by oi.line_index limit 1)`,
      qty: sql`coalesce((select sum(oi.quantity) from order_items oi where oi.order_id = ${orders.id}), 0)`,
      weight: scope.isGlobal ? orders.weightOz : undefined,
      total: scope.canViewFinancials ? orders.orderTotal : undefined,
      customerShipping: scope.canViewFinancials ? sql`(${orderCustomerShippingRateSql()})::numeric` : undefined,
    }, [desc(orders.orderDate), desc(orders.id)], orders.id))
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
          hasActiveOutboundShipment: row.hasActiveOutboundShipment,
          hasVoidedOutboundShipment: row.hasVoidedOutboundShipment,
          canonicalItems: canonicalItemsByOrder.get(row.order.id) ?? [],
          activeShipmentTrackingNumber: row.activeShipmentTrackingNumber,
          activeShipmentCarrierCode: row.activeShipmentCarrierCode,
          hasActiveReplacement: row.hasActiveReplacement,
          activeReplacementStatus: row.activeReplacementStatus,
          activeReplacementCount: row.activeReplacementCount,
          activeReplacementReference: row.activeReplacementReference,
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
  const replacementsReady = await replacementsSchemaReady();
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
      ...orderFulfillmentSignalSelects(),
      // CP-061: backend-derived REPLACE badge — the frontend renders these
      // fields verbatim and never re-derives them from replacement rows.
      ...orderReplacementBadgeSelects(replacementsReady, sql`${orders.id}`),
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
      hasActiveOutboundShipment: row.hasActiveOutboundShipment,
      hasVoidedOutboundShipment: row.hasVoidedOutboundShipment,
      canonicalItems: canonicalItemsByOrder.get(row.order.id) ?? [],
      activeShipmentTrackingNumber: row.activeShipmentTrackingNumber,
      activeShipmentCarrierCode: row.activeShipmentCarrierCode,
      hasActiveReplacement: row.hasActiveReplacement,
      activeReplacementStatus: row.activeReplacementStatus,
      activeReplacementCount: row.activeReplacementCount,
      activeReplacementReference: row.activeReplacementReference,
    },
    { includeFinancials: scope.canViewFinancials, includeWeight: scope.isGlobal },
  );
}

export async function awaitingActiveOrderCount(
  scope: ClientPortalScope,
  filters: { clientId?: number | null; storeId?: number | null },
) {
  // The sidebar/mobile Orders badge mirrors the Orders page's Awaiting shipment
  // tab count. CP-069: both use the ONE bucket predicate (PrepShip effective
  // lifecycle = pending + the portal's placeholder suppression) so users never see
  // rows in the table with a blank badge in the nav, or the reverse.
  const where = and(
    orderScopePredicate(scope, filters),
    activeClientPredicate(),
    orderStatusFilterPredicate('awaiting_shipment'),
  );
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);
  return Number(row?.count ?? 0);
}
