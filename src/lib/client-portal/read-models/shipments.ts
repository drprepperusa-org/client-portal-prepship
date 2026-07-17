import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { orders } from '../../../db/schema/orders';
import { shipments } from '../../../db/schema/shipments';
import { shipmentCustomerShippingRateSql } from '../customer-shipping-rate';
import { toPortalShipmentDto } from '../dto';
import {
  PORTAL_SHIPMENT_STATUSES,
  portalShipmentStatusSql,
  type PortalShipmentStatus,
} from '../shipment-status';
import {
  shipmentScopePredicate,
  shipmentSearchPredicate,
  visibleClientPortalShipmentsPredicate,
} from '../predicates';
import type { ClientPortalScope } from '../scope';

export const SHIPMENT_STATUS_FILTERS = new Set<PortalShipmentStatus>(PORTAL_SHIPMENT_STATUSES);

/** Filter on the exact backend expression projected as shipmentStatus. */
function shipmentStatusFilterPredicate(status?: PortalShipmentStatus | null): SQL | undefined {
  return status ? eq(portalShipmentStatusSql(), status) : undefined;
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
    status?: PortalShipmentStatus | null;
  },
) {
  const { page, pageSize, clientId, storeId, search, status } = opts;
  const where = and(
    // Voided shipments are hidden unless explicitly filtered for.
    status === 'voided' ? eq(shipments.voided, true) : eq(shipments.voided, false),
    visibleClientPortalShipmentsPredicate(),
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
      shipmentStatus: portalShipmentStatusSql(),
      // Customer Shipping Rate: frozen billing line first, then PrepShip's
      // policy-versioned shipment snapshot. No local pricing/config joins.
      shippingCost: shipmentCustomerShippingRateSql(),
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
          shipmentStatus: row.shipmentStatus,
          shippingCost: row.shippingCost,
        },
        { includeFinancials: scope.canViewFinancials },
      ),
    ),
    pagination: { page, pageSize, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / pageSize)) },
  };
}
