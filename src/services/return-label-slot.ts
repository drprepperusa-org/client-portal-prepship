import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { returnLabelPurchaseIntents } from '../db/schema/return-label-purchase-intents';
import { returns } from '../db/schema/returns';
import { shipments } from '../db/schema/shipments';

export const RETURN_LABEL_ASSIGNMENT_CONFLICT_CODE = 'label_assignment_in_progress' as const;

/**
 * Redaction-safe conflict shared by PrepShip purchases and external assignments.
 * It tells the caller to reload canonical return state without disclosing provider
 * or purchase-intent details.
 */
export class ReturnLabelAssignmentConflictError extends Error {
  readonly code = RETURN_LABEL_ASSIGNMENT_CONFLICT_CODE;

  constructor(message = 'Another label assignment already owns this return. Refresh and try again.') {
    super(message);
    this.name = 'ReturnLabelAssignmentConflictError';
  }
}

type ReturnLabelSlotReader = Pick<typeof db, 'select'>;

export type LockedReturnLabelSlot = {
  id: number;
  status: string;
  returnShipmentId: number | null;
  linkedShipmentVoided: boolean;
  purchaseIntentId: number | null;
  purchaseIntentState: string | null;
};

/**
 * Lock the workflow row that owns the return's single label/tracking slot.
 * Every competing claimant locks this row first, then reads the purchase intent,
 * so external tracking and provider purchases cannot both observe an empty slot.
 */
export async function lockReturnLabelSlot(
  reader: ReturnLabelSlotReader,
  returnId: number,
): Promise<LockedReturnLabelSlot | null> {
  const [returnRow] = await reader
    .select({
      id: returns.id,
      status: returns.status,
      returnShipmentId: returns.returnShipmentId,
    })
    .from(returns)
    .where(eq(returns.id, returnId))
    .limit(1)
    .for('update');
  if (!returnRow) return null;

  const [linkedShipment] = returnRow.returnShipmentId == null
    ? []
    : await reader
      .select({ voided: shipments.voided })
      .from(shipments)
      .where(eq(shipments.id, returnRow.returnShipmentId))
      .limit(1);

  const [intent] = await reader
    .select({
      id: returnLabelPurchaseIntents.id,
      state: returnLabelPurchaseIntents.state,
    })
    .from(returnLabelPurchaseIntents)
    .where(eq(returnLabelPurchaseIntents.returnId, returnId))
    .limit(1);

  return {
    ...returnRow,
    linkedShipmentVoided: linkedShipment?.voided === true,
    purchaseIntentId: intent?.id ?? null,
    purchaseIntentState: intent?.state ?? null,
  };
}

/**
 * Find and lock the canonical return slot that currently owns a shipment.
 *
 * The initial lookups are intentionally unlocked: after they identify the
 * return id, `lockReturnLabelSlot` takes the shared return-row lock and the
 * caller must recheck that the shipment is still linked. This preserves the
 * return -> shipment -> intent lock order used by purchase and external flows.
 */
export async function lockReturnLabelSlotForShipment(
  reader: ReturnLabelSlotReader,
  shipmentId: number,
): Promise<LockedReturnLabelSlot | null> {
  const [intent] = await reader
    .select({ returnId: returnLabelPurchaseIntents.returnId })
    .from(returnLabelPurchaseIntents)
    .where(eq(returnLabelPurchaseIntents.returnShipmentId, shipmentId))
    .limit(1);
  const [shipment] = intent
    ? []
    : await reader
      .select({ providerKey: shipments.labelProviderKey })
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
  const [providerIntent] = intent || !shipment?.providerKey
    ? []
    : await reader
      .select({ returnId: returnLabelPurchaseIntents.returnId })
      .from(returnLabelPurchaseIntents)
      .where(eq(returnLabelPurchaseIntents.providerReferenceKey, shipment.providerKey))
      .limit(1);
  const [returnRow] = intent || providerIntent
    ? []
    : await reader
      .select({ id: returns.id })
      .from(returns)
      .where(eq(returns.returnShipmentId, shipmentId))
      .limit(1);
  const returnId = intent?.returnId ?? providerIntent?.returnId ?? returnRow?.id;
  return returnId == null ? null : lockReturnLabelSlot(reader, returnId);
}

/** Definite failure/void releases intent ownership; every other state holds it. */
export function purchaseIntentOwnsReturnLabelSlot(state: string | null): boolean {
  return state != null && state !== 'failed' && state !== 'voided';
}
