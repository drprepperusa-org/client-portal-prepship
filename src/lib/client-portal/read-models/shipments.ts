import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import { toPortalShipmentDto } from '../dto';
import { shipmentScopePredicate, shipmentSearchPredicate } from '../predicates';
import type { ClientPortalScope } from '../scope';

export const SHIPMENT_STATUS_FILTERS = new Set([
  'delivered',
  'in_transit',
  'exception',
  'attempted',
  'label_created',
  'voided',
]);

/** Server-side status filter matching the portal's shipmentStatusMeta derivation. */
function shipmentStatusFilterPredicate(status?: string | null): SQL | undefined {
  const hasTracking = or(
    sql`${shipments.trackingNumber} is not null`,
    sql`${shipments.labelTracking} is not null`,
  );
  switch (status) {
    case 'delivered':
      return eq(shipments.trackingStatus, 'delivered');
    case 'exception':
      return eq(shipments.trackingStatus, 'exception');
    case 'attempted':
      return eq(shipments.trackingStatus, 'attempted');
    case 'in_transit':
      return and(hasTracking, sql`coalesce(${shipments.trackingStatus}, '') not in ('delivered', 'exception', 'attempted')`);
    case 'label_created':
      return and(sql`${shipments.trackingNumber} is null`, sql`${shipments.labelTracking} is null`);
    default:
      return undefined;
  }
}

/** Shipments read-model (extracted from routes/client-portal.ts). */
export async function listPortalShipments(
  scope: ClientPortalScope,
  opts: {
    page: number;
    pageSize: number;
    clientId?: number | null;
    storeId?: number | null;
    search: string;
    status?: string | null;
  },
) {
  const { page, pageSize, clientId, storeId, search, status } = opts;
  const where = and(
    // Voided shipments are hidden unless explicitly filtered for.
    status === 'voided' ? eq(shipments.voided, true) : eq(shipments.voided, false),
    shipmentStatusFilterPredicate(status),
    shipmentScopePredicate(scope, { clientId, storeId }),
    shipmentSearchPredicate(search),
  );
  const rows = await db
    .select({
      shipment: shipments,
      clientName: clients.name,
      storeId: orders.storeId,
      orderItems: orders.items,
      shippingCost: sql<string | null>`coalesce(${shipments.labelCost}, ${shipments.cost} + coalesce(${shipments.otherCost}, 0), ${shipments.cost})::text`,
    })
    .from(shipments)
    .leftJoin(clients, eq(clients.id, shipments.clientId))
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .where(where)
    .orderBy(desc(shipments.shipDate), desc(shipments.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shipments)
    .leftJoin(clients, eq(clients.id, shipments.clientId))
    .leftJoin(orders, eq(orders.id, shipments.orderId))
    .where(where);
  const count = countRows[0]?.count ?? rows.length;
  return {
    data: rows.map((row) =>
      toPortalShipmentDto(
        {
          ...row.shipment,
          clientName: row.clientName,
          storeName: row.clientName,
          storeId: row.storeId,
          orderItems: row.orderItems,
          shippingCost: row.shippingCost,
        },
        { includeFinancials: scope.canViewFinancials },
      ),
    ),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  };
}
