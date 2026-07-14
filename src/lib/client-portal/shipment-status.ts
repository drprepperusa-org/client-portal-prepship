import { sql, type SQL } from 'drizzle-orm';
import { shipments } from '../../db/schema/shipments';
import {
  PORTAL_SHIPMENT_STATUSES,
  type PortalShipmentStatus,
} from './contracts/shipments';

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
 * Customer shipment lifecycle owner.
 *
 * Inputs: shipments.voided + persisted shipments.tracking_status.
 * Clock: latest persisted carrier reconciliation event (CP-042).
 * Formula: voided wins; known carrier states pass through; a shipment without
 * carrier movement is label_created; unknown persisted values fail closed.
 * Tracking-number presence is deliberately not an input.
 */
export function portalShipmentStatusSql(): SQL<PortalShipmentStatus> {
  return sql<PortalShipmentStatus>`case
    when coalesce(${shipments.voided}, false) then 'voided'
    when ${shipments.trackingStatus} in ('delivered', 'in_transit', 'exception', 'attempted')
      then ${shipments.trackingStatus}
    when nullif(trim(${shipments.trackingStatus}), '') is null
      or ${shipments.trackingStatus} = 'label_created'
      then 'label_created'
    else 'unavailable'
  end`;
}
