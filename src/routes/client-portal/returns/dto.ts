import type { Return } from '../../../db/schema/returns';
import type { PortalReturnRow } from '../../../lib/client-portal/contracts/returns';
import { trackingUrlForCarrier } from '../../../lib/tracking-url';
import { resolveReturnCustomerPrice } from '../../../services/returns';
import { resolveReturnReference } from '../../../services/return-reference';
import { iso } from './shared';

type ClientSafeReturnSource = {
  ret: Return;
  orderNumber: string | null;
  clientName: string | null;
  returnTracking: string | null;
  returnCarrier: string | null;
  returnLabelUrl: string | null;
  internalReturnLabelCost: string | null;
};

/**
 * Client-safe return row. Carrier, service, provider, and house-cost identity
 * remain backend-only; customer postage is resolved by billing policy.
 */
export async function toClientSafeReturnRow(
  row: ClientSafeReturnSource,
  options: { includeFinancials: boolean },
): Promise<PortalReturnRow> {
  return {
    id: row.ret.id,
    orderId: row.ret.orderId,
    orderNumber: row.orderNumber,
    returnReference: resolveReturnReference(row.ret.returnReference, row.orderNumber, row.ret.orderId),
    clientId: row.ret.clientId,
    clientName: row.clientName,
    status: row.ret.status,
    initiatedBy: row.ret.initiatedBy,
    reason: row.ret.reason,
    deliveryMethod: row.ret.deliveryMethod,
    deliveryStatus: row.ret.deliveryStatus,
    trackingNumber: row.returnTracking,
    trackingUrl: trackingUrlForCarrier(row.returnCarrier, row.returnTracking) || null,
    pdfAvailable: Boolean(row.returnLabelUrl),
    returnCustomerShippingRate:
      options.includeFinancials && row.internalReturnLabelCost != null
        ? await resolveReturnCustomerPrice(Number(row.internalReturnLabelCost), row.ret.clientId)
        : null,
    createdAt: iso(row.ret.createdAt),
  };
}
