import { refreshMockLabelSignature } from '../mock-label-access';
import { getReturnMediaSignedUrl } from '../supabase';

const EXTERNAL_RETURN_LABEL_SOURCE = 'external_return_label';
const SAFE_OBJECT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const PRIVATE_RETURN_OBJECT_PATH = /^\/?returns\//;

type ReturnPdfReference = {
  returnId: number | null;
  shipmentSource: string | null;
  shipmentVoided: boolean | null;
  labelUrl: string | null;
};

/** Check whether the persisted shipment reference is eligible for client access. */
export function isClientSafeReturnPdfReference(input: ReturnPdfReference): boolean {
  const labelUrl = input.labelUrl?.trim();
  if (!labelUrl || input.shipmentVoided !== false) return false;

  if (input.shipmentSource !== EXTERNAL_RETURN_LABEL_SOURCE) {
    return !PRIVATE_RETURN_OBJECT_PATH.test(labelUrl);
  }

  if (input.returnId == null || !Number.isSafeInteger(input.returnId) || input.returnId <= 0) {
    return false;
  }
  const prefix = `returns/${input.returnId}/external-label/`;
  if (!labelUrl.startsWith(prefix)) return false;
  return SAFE_OBJECT_NAME.test(labelUrl.slice(prefix.length));
}

/**
 * Resolve the customer-safe return-label URL from the canonical shipment row.
 *
 * PrepShip/provider URLs and signed mock-label routes keep their existing
 * behavior. External-label uploads are private Storage objects, so only the
 * exact path owned by this return may be signed. Invalid or unsignable private
 * references fail closed instead of exposing the durable object key.
 */
export async function resolveClientSafeReturnPdfUrl(input: ReturnPdfReference): Promise<string | null> {
  const labelUrl = input.labelUrl?.trim();
  if (!labelUrl || !isClientSafeReturnPdfReference(input)) return null;

  if (input.shipmentSource !== EXTERNAL_RETURN_LABEL_SOURCE) {
    return refreshMockLabelSignature(labelUrl);
  }

  try {
    return await getReturnMediaSignedUrl(labelUrl);
  } catch {
    return null;
  }
}
