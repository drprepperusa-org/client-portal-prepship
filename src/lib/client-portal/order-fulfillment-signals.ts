import { sql } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';

// Per user override unlock shipped data on 2026-09-05: PS-486 shares this
// read-only projection for order fulfillment and return eligibility.
// An inbound return label cannot establish that the original order shipped.
// Orphan shipment matching preserves the existing same-client boundary.
export function orderFulfillmentSignalSelects() {
  const outboundMatch = sql`(
    s.order_id = ${orders.id}
    or (s.order_id is null and s.order_number = ${orders.orderNumber} and s.client_id = ${orders.clientId})
  ) and coalesce(s.is_return, false) = false`;
  return {
    activeTrackingStatus: sql<string | null>`(
      select s.tracking_status from shipments s
      where ${outboundMatch} and coalesce(s.voided, false) = false
      order by s.id desc limit 1
    )`,
    hasActiveShipment: sql<boolean>`exists (
      select 1 from shipments s
      where ${outboundMatch} and coalesce(s.voided, false) = false
    )`,
    hasVoidedShipment: sql<boolean>`exists (
      select 1 from shipments s
      where ${outboundMatch} and coalesce(s.voided, false) = true
    )`,
  };
}
