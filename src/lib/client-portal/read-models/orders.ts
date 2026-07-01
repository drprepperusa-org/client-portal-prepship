import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orderOverrides, orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import { getProviderAccountNicknames } from '../../../services/rates';
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
      // Active (non-voided) shipment's billed account for this order — drives
      // the "Shipping Account" column for shipped/cancelled orders.
      shipAcctNickname: sql<string | null>`(
        select ${shipments.providerAccountNickname} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipAcctId: sql<number | null>`(
        select ${shipments.providerAccountId} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
          and ${shipments.providerAccountId} is not null
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipCarrierCode: sql<string | null>`(
        select coalesce(${shipments.labelCarrier}, ${shipments.carrierCode}) from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipServiceCode: sql<string | null>`(
        select ${shipments.serviceCode} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipServiceName: sql<string | null>`(
        select ${shipments.labelService} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipSelectedAmount: sql<string | null>`(
        select coalesce(${shipments.labelCost}, ${shipments.cost} + coalesce(${shipments.otherCost}, 0), ${shipments.cost})::text from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
      )`,
      shipSelectedRateJson: sql<Record<string, unknown> | null>`(
        select ${shipments.selectedRateJson} from ${shipments}
        where ${shipments.orderId} = ${orders.id} and ${shipments.voided} = false
        order by ${shipments.shipDate} desc nulls last, ${shipments.id} desc
        limit 1
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
  // Resolve numeric account ids → nicknames (cached carrier list + curated map).
  const accountNicknames = await getProviderAccountNicknames().catch(() => new Map<number, string>());
  return {
    data: rows.map((row) => {
      const shipmentAccount =
        row.shipAcctNickname ?? (row.shipAcctId != null ? accountNicknames.get(row.shipAcctId) ?? null : null);
      return toPortalOrderDto(
        {
          ...row.order,
          clientName: row.clientName,
          storeName: row.clientName,
          override: row.override,
          shipmentAccount,
          latestShipment: {
            carrierCode: row.shipCarrierCode,
            serviceCode: row.shipServiceCode,
            serviceName: row.shipServiceName,
            amount: row.shipSelectedAmount,
            selectedRateJson: row.shipSelectedRateJson,
          },
        },
        { includeFinancials: scope.canViewFinancials },
      );
    }),
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
    .select({ order: orders, override: orderOverrides, clientName: clients.name })
    .from(orders)
    .leftJoin(clients, eq(clients.id, orders.clientId))
    .leftJoin(orderOverrides, eq(orderOverrides.orderId, orders.id))
    .where(and(eq(orders.id, id), orderScopePredicate(scope), activeClientPredicate()))
    .limit(1);
  if (!row) return null;
  return toPortalOrderDto(
    { ...row.order, clientName: row.clientName, storeName: row.clientName, override: row.override },
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
