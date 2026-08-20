import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { returns } from '../db/schema/returns';
import { shipments } from '../db/schema/shipments';
import { recordReturnActivity } from './return-activity';
import {
  EXTERNAL_TRACKING_EVENT,
  EXTERNAL_TRACKING_RETURN_STATUS,
  externalTrackingShipmentFields,
  resolveReturnExternalTracking,
} from './return-external-tracking';
import {
  lockReturnLabelSlot,
  purchaseIntentOwnsReturnLabelSlot,
  ReturnLabelAssignmentConflictError,
} from './return-label-slot';

// CP-058 AC-3/AC-4 — PERSIST an already-decided external tracking assignment.
//
// Split from the rule (return-external-tracking.ts) so that module stays import-free and
// therefore structurally incapable of buying postage, and split from the route so the
// route stays thin. This module calls no provider and re-checks the canonical slot while
// holding the same return-row lock used by the live purchase-intent claimant.

export async function applyReturnExternalTracking(input: {
  returnId: number;
  orderId: number;
  clientId: number | null;
  orderNumber: string | null;
  decision: {
    kind: 'accept';
    trackingNumber: string;
    externalLabelCost: number;
  };
  actorEmail?: string | null;
  actorType: 'client' | 'operator';
  now?: Date;
}): Promise<{ returnShipmentId: number }> {
  const now = input.now ?? new Date();
  const fields = externalTrackingShipmentFields(input.decision);

  return db.transaction(async (tx) => {
    const slot = await lockReturnLabelSlot(tx, input.returnId);
    if (!slot) throw new ReturnLabelAssignmentConflictError('This return no longer exists.');

    const lockedDecision = resolveReturnExternalTracking({
      return: {
        status: slot.status,
        returnShipmentId: slot.returnShipmentId,
        linkedShipmentVoided: slot.linkedShipmentVoided,
      },
      trackingNumber: input.decision.trackingNumber,
      amountPaid: input.decision.externalLabelCost,
    });
    if (
      lockedDecision.kind === 'rejected' ||
      purchaseIntentOwnsReturnLabelSlot(slot.purchaseIntentState)
    ) {
      throw new ReturnLabelAssignmentConflictError();
    }

    const [shipment] = await tx
      .insert(shipments)
      .values({
        orderId: input.orderId,
        clientId: input.clientId,
        orderNumber: input.orderNumber,
        shipDate: now,
        createDate: now,
        // Everything provider-shaped is deliberately absent — see the rule module.
        ...fields,
      })
      .returning({ id: shipments.id });

    // Claim the ONE canonical slot. The conditional write is defense in depth behind the
    // row lock; a losing transaction rolls the shipment insert back with this transaction.
    const linked = await tx
      .update(returns)
      .set({
        returnShipmentId: shipment!.id,
        status: EXTERNAL_TRACKING_RETURN_STATUS,
        updatedAt: now,
      })
      .where(
        and(
          eq(returns.id, input.returnId),
          slot.linkedShipmentVoided && slot.returnShipmentId != null
            ? or(
                isNull(returns.returnShipmentId),
                eq(returns.returnShipmentId, slot.returnShipmentId),
              )
            : isNull(returns.returnShipmentId),
          inArray(
            returns.status,
            slot.linkedShipmentVoided
              ? ['requested', 'label_failed', 'label_created']
              : ['requested', 'label_failed'],
          ),
        ),
      )
      .returning({ id: returns.id });
    if (!linked.length) {
      throw new ReturnLabelAssignmentConflictError();
    }

    return { returnShipmentId: shipment!.id };
  }).then(async (result) => {
    // Append-only evidence, after the state is durable.
    await recordReturnActivity({
      returnId: input.returnId,
      shipmentId: result.returnShipmentId,
      eventType: EXTERNAL_TRACKING_EVENT,
      status: EXTERNAL_TRACKING_RETURN_STATUS,
      detail: JSON.stringify({
        trackingNumber: input.decision.trackingNumber,
        // Recorded for 3PL reconciliation only. This is NOT the customer-billed amount —
        // that stays returns.return_customer_shipping_rate, owned by PrepShip.
        externalLabelCost: input.decision.externalLabelCost.toFixed(2),
      }),
      actorType: input.actorType,
      actorEmail: input.actorEmail ?? null,
      eventAt: now,
    });
    return result;
  });
}

/**
 * Persist an uploaded external-label PDF only while the same external shipment
 * still owns the locked return slot. The object itself stays in the private
 * returns bucket; this function writes only its durable path.
 */
export async function attachReturnExternalLabelPdf(input: {
  returnId: number;
  expectedShipmentId: number;
  objectPath: string;
  now?: Date;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const slot = await lockReturnLabelSlot(tx, input.returnId);
    if (!slot || slot.returnShipmentId !== input.expectedShipmentId) {
      throw new ReturnLabelAssignmentConflictError();
    }

    const [updated] = await tx
      .update(shipments)
      .set({
        labelUrl: input.objectPath,
        labelFormat: 'pdf',
        updatedAt: input.now ?? new Date(),
      })
      .where(
        and(
          eq(shipments.id, input.expectedShipmentId),
          eq(shipments.source, 'external_return_label'),
          eq(shipments.voided, false),
        ),
      )
      .returning({ id: shipments.id });
    if (!updated) throw new ReturnLabelAssignmentConflictError();
  });
}
