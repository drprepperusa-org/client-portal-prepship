import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orders } from '../../../db/schema/orders';
import { returns } from '../../../db/schema/returns';
import { shipments } from '../../../db/schema/shipments';
import type { ClientPortalScope } from '../../../lib/client-portal/scope';
import { tableOrderBy, referenceOrder } from '../../../lib/client-portal/read-models/table-sort';
import { validatedReturnCustomerShippingRateSql } from '../../../lib/client-portal/customer-shipping-rate';
import { returnReferenceSql } from '../../../services/return-reference';
import { returnScopePredicate, returnSearchPredicate } from './shared';
import { toClientSafeReturnRow } from './dto';

export interface PortalReturnListOptions {
  page: number; pageSize: number;
  clientId?: number | null; storeId?: number | null; orderId?: number | null;
  search?: string; status?: string; sortBy?: string; sortDir?: string;
  dateFrom?: string; dateTo?: string;
}

/** Shared list/export owner. Date bounds use returns.created_at, inclusive UTC instants. */
export async function listPortalReturns(scope: ClientPortalScope, opts: PortalReturnListOptions, reader: Pick<typeof db, 'select'> = db) {
  const { page, pageSize, clientId, storeId, orderId, search, status } = opts;
  const where = and(
    returnScopePredicate(scope, { clientId, storeId }),
    status ? eq(returns.status, status) : undefined,
    orderId ? eq(returns.orderId, orderId) : undefined,
    returnSearchPredicate(search ?? ''),
    opts.dateFrom ? gte(returns.createdAt, new Date(opts.dateFrom)) : undefined,
    opts.dateTo ? lte(returns.createdAt, new Date(opts.dateTo)) : undefined,
  );

  const pageRead = reader
    .select({
      ret: returns,
      orderNumber: orders.orderNumber,
      clientName: clients.name,
      returnTracking: sql<string | null>`coalesce(${shipments.labelTracking}, ${shipments.trackingNumber})`,
      returnCarrier: shipments.labelCarrier,
      returnLabelUrl: shipments.labelUrl,
      returnShipmentSource: shipments.source,
      returnShipmentVoided: shipments.voided,
      returnTrackingStatus: shipments.trackingStatus,
      returnDeliveredAt: shipments.deliveredAt,
      validatedReturnCustomerShippingRate: validatedReturnCustomerShippingRateSql(),
      returnedSkus: sql<string[]>`coalesce((
        select array_agg(ri.sku order by ri.id)
        from return_items ri
        where ri.return_id = ${returns.id}
      ), array[]::text[])`,
      returnedQuantity: sql<number>`coalesce((
        select sum(ri.quantity)::double precision
        from return_items ri
        where ri.return_id = ${returns.id}
      ), 0)`,
      recipientName: sql<string | null>`coalesce(
        nullif(btrim(${orders.raw}->'shipTo'->>'name'), ''),
        nullif(btrim(${orders.shipToName}), '')
      )`,
    })
    .from(returns)
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .leftJoin(clients, eq(clients.id, returns.clientId))
    .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
    .where(where)
    .orderBy(...tableOrderBy(opts, {
      returnReference: referenceOrder(returnReferenceSql(returns.returnReference, orders.orderNumber, returns.orderId)),
      order: referenceOrder(orders.orderNumber), client: sql`lower(${clients.name})`,
      recipientName: sql`coalesce(nullif(btrim(${orders.raw}->'shipTo'->>'name'), ''), nullif(btrim(${orders.shipToName}), ''))`,
      returnedSkus: sql`(select string_agg(ri.sku, ', ' order by ri.id) from return_items ri where ri.return_id = ${returns.id})`,
      returnedQuantity: sql`coalesce((select sum(ri.quantity) from return_items ri where ri.return_id = ${returns.id}), 0)`,
      status: returns.status, delivery: returns.deliveryMethod,
      tracking: sql`coalesce(${shipments.labelTracking}, ${shipments.trackingNumber})`,
      returnCustomerShippingRate: scope.canViewFinancials ? sql`(${validatedReturnCustomerShippingRateSql()})::numeric` : undefined,
      created: returns.createdAt,
    }, [desc(returns.createdAt), desc(returns.id)], returns.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const countRead = reader
    .select({ count: sql<number>`count(*)::int` })
    .from(returns)
    .leftJoin(orders, eq(orders.id, returns.orderId))
    .leftJoin(shipments, eq(shipments.id, returns.returnShipmentId))
    .where(where);
  // Independent scoped list reads; keep audit and DTO work after both complete.
  const [rows, countRows] = await Promise.all([pageRead, countRead]);
  const count = countRows[0]?.count ?? rows.length;

  return {
    data: await Promise.all(
      rows.map((row) => toClientSafeReturnRow(row, { includeFinancials: scope.canViewFinancials })),
    ),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  };
}
