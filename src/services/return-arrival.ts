import { sql, type SQL } from 'drizzle-orm';
import { returns } from '../db/schema/returns';
import { shipments } from '../db/schema/shipments';

/**
 * CP-062 — the "arrived, ready to receive" fact for a return.
 *
 * Two owners hold the inputs. The carrier tracking refresh writes the linked return
 * shipment's tracking_status / delivered_at (shipments, carrier-tracking owned); the
 * return lifecycle is returns.status, advanced only by the manual receiving flow. This is
 * the ONE place that combines them. It reads and never writes: a delivered return shipment
 * does not advance returns.status (AC-4). The returns read model and the receiving queue
 * delegate here; the portal renders the result verbatim.
 */

/**
 * Lifecycle states a return can be in BEFORE the warehouse has received it. A positive list,
 * so an unknown status is never "ready to receive". label_failed is excluded on purpose: its
 * linked shipment is the failed attempt, not a parcel in flight.
 */
export const RETURN_PRE_RECEIPT_STATUSES = ['requested', 'label_created', 'in_transit'] as const;

export type ReturnArrivalSource = {
  /** returns.status */
  status: string;
  /** shipments.tracking_status of the linked return shipment, normalised by carrier-tracking */
  trackingStatus: string | null;
  /** shipments.delivered_at of the linked return shipment */
  deliveredAt: Date | string | null;
  /** shipments.voided — a voided label is not the return's live parcel */
  shipmentVoided: boolean | null;
};

export type ReturnArrivalSignal = {
  trackingStatus: string | null;
  deliveredAt: string | null;
  arrivedReadyToReceive: boolean;
};

/**
 * The carrier reports the return parcel delivered: a delivery timestamp, or the normalised
 * status alone (a list-only ShipStation snapshot carries `delivered` with no event time).
 */
export function isReturnShipmentDelivered(source: ReturnArrivalSource): boolean {
  if (source.shipmentVoided) return false;
  return source.deliveredAt != null || source.trackingStatus === 'delivered';
}

export function resolveReturnArrival(source: ReturnArrivalSource): ReturnArrivalSignal {
  const delivered = isReturnShipmentDelivered(source);
  const preReceipt = (RETURN_PRE_RECEIPT_STATUSES as readonly string[]).includes(source.status);
  return {
    trackingStatus: source.trackingStatus ?? null,
    deliveredAt: toIso(source.deliveredAt),
    arrivedReadyToReceive: delivered && preReceipt,
  };
}

/**
 * SQL twin of resolveReturnArrival().arrivedReadyToReceive over the returns ⟕ shipments join
 * (shipments.id = returns.return_shipment_id). It ORDERS the receiving queue so arrived parcels
 * come first across the whole page, not only among the rows already in memory. Built from the
 * same constants as the JS rule; the CP-062 guard renders it and checks the bound params, and
 * the CP-062 integration proves both agree against real PostgreSQL.
 */
export function returnArrivedReadyToReceiveSql(): SQL<boolean> {
  const statuses = sql.join(
    RETURN_PRE_RECEIPT_STATUSES.map((status) => sql`${status}`),
    sql`, `,
  );
  // coalesce(..., false): a return with no linked shipment makes the delivered arm NULL, and under
  // ORDER BY ... DESC PostgreSQL puts NULLs FIRST — the opposite of "not arrived". The CP-062
  // integration's no-shipment fixture is what caught this; the guard renders the wrapper.
  return sql<boolean>`coalesce((
    coalesce(${shipments.voided}, false) = false
    and (${shipments.deliveredAt} is not null or ${shipments.trackingStatus} = ${'delivered'})
    and ${returns.status} in (${statuses})
  ), false)`;
}

function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
