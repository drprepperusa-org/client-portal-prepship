import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { returns } from '../db/schema/returns';
import { shipments } from '../db/schema/shipments';
import { recordReturnActivity } from './return-activity';
import {
  EXTERNAL_TRACKING_EVENT,
  EXTERNAL_TRACKING_RETURN_STATUS,
  externalTrackingShipmentFields,
} from './return-external-tracking';

// CP-058 AC-3/AC-4 — PERSIST an already-decided external tracking assignment.
//
// Split from the rule (return-external-tracking.ts) so that module stays import-free and
// therefore structurally incapable of buying postage, and split from the route so the
// route stays thin. This module only writes what the rule already approved: it re-checks
// nothing and calls no provider.

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

    // Claim the ONE canonical slot. The where-clause requires it to still be empty, so a
    // concurrent PrepShip label purchase cannot be overwritten by this write: whichever
    // transaction lands first keeps the return, and the loser updates zero rows.
    const linked = await tx
      .update(returns)
      .set({
        returnShipmentId: shipment!.id,
        status: EXTERNAL_TRACKING_RETURN_STATUS,
        updatedAt: now,
      })
      .where(eq(returns.id, input.returnId))
      .returning({ id: returns.id });
    if (!linked.length) {
      throw new Error('Return disappeared while assigning external tracking');
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
