import { sql, type SQL } from 'drizzle-orm';
import { orders } from '../../db/schema/orders';
import { shipments } from '../../db/schema/shipments';
import {
  PORTAL_SHIPMENT_STATUSES,
  type PortalShipmentStatus,
} from './contracts/shipments';
import {
  orderLifecycleEffectiveStatusAliasSql,
  portalOrderFulfillmentBucketAliasSql,
  portalOrderFulfillmentBucketSql,
} from './order-lifecycle';

export { PORTAL_SHIPMENT_STATUSES, type PortalShipmentStatus } from './contracts/shipments';

const PORTAL_SHIPMENT_STATUS_SET = new Set<string>(PORTAL_SHIPMENT_STATUSES);

export function isPortalShipmentStatus(value: unknown): value is PortalShipmentStatus {
  return typeof value === 'string' && PORTAL_SHIPMENT_STATUS_SET.has(value);
}

/** Fail closed when a projected status is absent or outside the DTO contract. */
export function normalizePortalShipmentStatus(value: unknown): PortalShipmentStatus {
  return isPortalShipmentStatus(value) ? value : 'unavailable';
}

/**
 * CP-069 — pre-CP-069 bundles filter the Shipments list with the carrier vocabulary. Those
 * values are all "the parcel shipped" in the new contract, so for one release they alias to
 * 'shipped' instead of silently returning the unfiltered list. Remove with the transitional
 * frontend keys (see portal-client/src/lib/status.ts) once every client has reloaded.
 */
export const LEGACY_SHIPMENT_STATUS_FILTER_ALIASES: Readonly<Record<string, PortalShipmentStatus>> = {
  delivered: 'shipped',
  in_transit: 'shipped',
  exception: 'shipped',
  attempted: 'shipped',
};

/** Resolve a ?status= query value to a contract status (or none), honouring the legacy aliases. */
export function resolveShipmentStatusFilterParam(value: unknown): PortalShipmentStatus | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (isPortalShipmentStatus(value)) return value;
  return LEGACY_SHIPMENT_STATUS_FILTER_ALIASES[value];
}

/**
 * Customer outbound shipment display owner (CP-069).
 *
 * Inputs: shipments.voided, and the linked order's PrepShip effective lifecycle — the `orders`
 * row the query MUST left-join on `orders.id = shipments.order_id`, or, for rows synced without
 * a linked order_id, the same-client order with the same order_number (a shipped one first —
 * PrepShip's orphan linker links by order number to shipped orders, and Walmart-direct
 * duplicates can share a number within one client — then the newest).
 * Clock: PrepShip's fulfillment writes. Owner: order-lifecycle.ts (pinned port).
 * Formula: voided wins; then the linked order's bucket — cancelled → 'cancelled',
 * shipped → 'shipped', pending → 'label_created'; no linkable order → 'unavailable'.
 * Carrier telemetry, tracking-number presence and ship dates are deliberately not inputs.
 *
 * The same expression projects the DTO field AND evaluates the status filter, so the list can
 * never show a row its own filter would classify differently.
 */
export function portalShipmentStatusSql(): SQL<PortalShipmentStatus> {
  const linkedBucket = sql`case
    when ${orders.id} is not null then ${portalOrderFulfillmentBucketSql()}
    when ${shipments.orderId} is null then (
      select ${portalOrderFulfillmentBucketAliasSql('o')}
      from orders o
      where o.order_number = ${shipments.orderNumber}
        and o.client_id = ${shipments.clientId}
      order by case when ${orderLifecycleEffectiveStatusAliasSql('o')} = 'shipped' then 0 else 1 end, o.id desc
      limit 1
    )
    else null
  end`;
  return sql<PortalShipmentStatus>`case
    when coalesce(${shipments.voided}, false) then 'voided'
    when ${linkedBucket} = 'cancelled' then 'cancelled'
    when ${linkedBucket} = 'shipped' then 'shipped'
    when ${linkedBucket} is not null then 'label_created'
    else 'unavailable'
  end`;
}
