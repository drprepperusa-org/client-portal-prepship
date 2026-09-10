import { resolveOrderFulfillmentStatus, type OrderFulfillmentSignals } from '../lib/client-portal/order-status';

export type ReturnEligibility =
  | { allowed: true; reason: null }
  | { allowed: false; reason: string };

// PS-486: return creation owns this policy. Use the existing fulfillment owner,
// not raw shipped flags or frontend rules. This authorizes a return request,
// not postage, refunds, or inventory restoration; their owners still validate.
//
// CP-069: the owner's vocabulary is PrepShip's fulfillment truth — a return can be
// requested for an order PrepShip has shipped (locally, externally, or with its marketplace
// confirmation still pending/failed), never from carrier telemetry. Cancelled, voided-only
// and not-yet-shipped orders cannot start one.
export function resolveReturnEligibility(signals: OrderFulfillmentSignals): ReturnEligibility {
  switch (resolveOrderFulfillmentStatus(signals)) {
    case 'cancelled':
      return { allowed: false, reason: 'Returns cannot be started for a cancelled order.' };
    case 'voided':
      return { allowed: false, reason: 'This order has only voided shipments. There is no active shipment to return.' };
    case 'pending':
      return { allowed: false, reason: 'This order has not shipped yet.' };
    case 'shipped':
      return { allowed: true, reason: null };
  }
}
