import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  returnLabelPurchaseIntents,
  type ReturnLabelPurchaseIntent,
} from '../db/schema/return-label-purchase-intents';
import type { CreatedExternalLabel } from '../lib/shipstation/labels';
import type { Rate } from '../lib/shipstation';

const STALE_PURCHASE_MS = 5 * 60 * 1000;
const PURCHASE_LEASE_MS = 3 * 60 * 1000;
const PURCHASE_TIMEOUT_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 15 * 1000;

export type ReturnLabelPurchaseLease = {
  intentId: number;
  generation: number;
  leaseToken: string;
};

export type ReturnLabelPurchaseAction =
  | { kind: 'purchase'; intent: ReturnLabelPurchaseIntent; lease: ReturnLabelPurchaseLease }
  | { kind: 'recover'; intent: ReturnLabelPurchaseIntent }
  | { kind: 'completed'; intent: ReturnLabelPurchaseIntent }
  | { kind: 'in_progress'; intent: ReturnLabelPurchaseIntent };

export async function getReturnLabelPurchaseIntent(
  returnId: number,
): Promise<ReturnLabelPurchaseIntent | null> {
  const [row] = await db
    .select()
    .from(returnLabelPurchaseIntents)
    .where(eq(returnLabelPurchaseIntents.returnId, returnId))
    .limit(1);
  return row ?? null;
}

export async function listHeldReturnLabelPurchases(limit = 100): Promise<ReturnLabelPurchaseIntent[]> {
  return db
    .select()
    .from(returnLabelPurchaseIntents)
    .where(eq(returnLabelPurchaseIntents.state, 'unknown_outcome'))
    .orderBy(returnLabelPurchaseIntents.updatedAt)
    .limit(Math.max(1, Math.min(200, limit)));
}

function purchaseLease(intent: ReturnLabelPurchaseIntent): ReturnLabelPurchaseLease {
  if (!intent.leaseToken) throw new Error('Return label purchase claim is missing its lease token');
  return {
    intentId: intent.id,
    generation: intent.generation,
    leaseToken: intent.leaseToken,
  };
}

async function tryClaim(returnId: number): Promise<ReturnLabelPurchaseIntent | null> {
  const now = new Date();
  const leaseToken = randomUUID();
  const [claimed] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'purchasing',
      attemptCount: sql`${returnLabelPurchaseIntents.attemptCount} + 1`,
      generation: sql`${returnLabelPurchaseIntents.generation} + 1`,
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + PURCHASE_LEASE_MS),
      lastAttemptAt: now,
      lastSafeError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.returnId, returnId),
        or(
          eq(returnLabelPurchaseIntents.state, 'reserved'),
          eq(returnLabelPurchaseIntents.state, 'failed'),
          // A voided label released this return, so the intent is claimable
          // again. Its provider reference key was rotated when it was voided,
          // so this attempt is a genuinely new purchase, not a replay.
          eq(returnLabelPurchaseIntents.state, 'voided'),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function acquireReturnLabelPurchase(
  returnId: number,
): Promise<ReturnLabelPurchaseAction> {
  await db
    .insert(returnLabelPurchaseIntents)
    .values({
      returnId,
      providerReferenceKey: `cp-return-${randomUUID()}`,
    })
    .onConflictDoNothing({ target: returnLabelPurchaseIntents.returnId });

  const claimed = await tryClaim(returnId);
  if (claimed) return { kind: 'purchase', intent: claimed, lease: purchaseLease(claimed) };

  let intent = await getReturnLabelPurchaseIntent(returnId);
  if (!intent) throw new Error('Return label purchase intent could not be reserved');

  if (
    intent.state === 'purchasing' &&
    (
      (intent.leaseExpiresAt != null && intent.leaseExpiresAt.getTime() <= Date.now()) ||
      (intent.leaseExpiresAt == null &&
        intent.lastAttemptAt != null &&
        intent.lastAttemptAt.getTime() <= Date.now() - STALE_PURCHASE_MS)
    )
  ) {
    const now = new Date();
    const [stale] = await db
      .update(returnLabelPurchaseIntents)
      .set({
        state: 'unknown_outcome',
        leaseToken: null,
        leaseExpiresAt: null,
        lastSafeError: 'Provider outcome requires reconciliation',
        updatedAt: now,
      })
      .where(
        and(
          eq(returnLabelPurchaseIntents.id, intent.id),
          eq(returnLabelPurchaseIntents.state, 'purchasing'),
          or(
            lte(returnLabelPurchaseIntents.leaseExpiresAt, now),
            and(
              isNull(returnLabelPurchaseIntents.leaseExpiresAt),
              lte(returnLabelPurchaseIntents.lastAttemptAt, new Date(Date.now() - STALE_PURCHASE_MS)),
            ),
          ),
        ),
      )
      .returning();
    intent = stale ?? (await getReturnLabelPurchaseIntent(returnId)) ?? intent;
  }

  if (intent.state === 'completed') return { kind: 'completed', intent };
  if (intent.state === 'purchased' || intent.state === 'unknown_outcome') {
    return { kind: 'recover', intent };
  }
  if (intent.state === 'reserved' || intent.state === 'failed') {
    const retryClaim = await tryClaim(returnId);
    if (retryClaim) return { kind: 'purchase', intent: retryClaim, lease: purchaseLease(retryClaim) };
  }
  return { kind: 'in_progress', intent };
}

export async function saveReturnLabelSelectedRate(
  lease: ReturnLabelPurchaseLease,
  selectedRate: Rate,
): Promise<void> {
  const [updated] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      selectedRateJson: selectedRate as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, lease.intentId),
        eq(returnLabelPurchaseIntents.generation, lease.generation),
        eq(returnLabelPurchaseIntents.leaseToken, lease.leaseToken),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    )
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Return label purchase intent is no longer owned by this attempt');
}

export async function recordReturnLabelProviderReceipt(
  lease: ReturnLabelPurchaseLease,
  receipt: CreatedExternalLabel,
): Promise<void> {
  const now = new Date();
  const [updated] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'purchased',
      providerLabelId: receipt.labelId,
      providerShipmentId: receipt.shipmentId ? String(receipt.shipmentId) : null,
      providerReceiptJson: receipt as unknown as Record<string, unknown>,
      leaseToken: null,
      leaseExpiresAt: null,
      purchasedAt: now,
      lastSafeError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, lease.intentId),
        eq(returnLabelPurchaseIntents.generation, lease.generation),
        eq(returnLabelPurchaseIntents.leaseToken, lease.leaseToken),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    )
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Return label provider receipt could not be recorded');
}

export async function recordRecoveredReturnLabelProviderReceipt(
  intentId: number,
  receipt: CreatedExternalLabel,
): Promise<void> {
  const now = new Date();
  const [updated] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'purchased',
      generation: sql`${returnLabelPurchaseIntents.generation} + 1`,
      providerLabelId: receipt.labelId,
      providerShipmentId: receipt.shipmentId ? String(receipt.shipmentId) : null,
      providerReceiptJson: receipt as unknown as Record<string, unknown>,
      leaseToken: null,
      leaseExpiresAt: null,
      purchasedAt: now,
      lastSafeError: null,
      updatedAt: now,
    })
    .where(and(
      eq(returnLabelPurchaseIntents.id, intentId),
      inArray(returnLabelPurchaseIntents.state, ['unknown_outcome', 'purchased']),
    ))
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Unknown return label outcome could not record its provider receipt');
}

export async function markReturnLabelPurchaseUnknown(lease: ReturnLabelPurchaseLease): Promise<void> {
  await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'unknown_outcome',
      leaseToken: null,
      leaseExpiresAt: null,
      lastSafeError: 'Provider outcome requires reconciliation',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, lease.intentId),
        eq(returnLabelPurchaseIntents.generation, lease.generation),
        eq(returnLabelPurchaseIntents.leaseToken, lease.leaseToken),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    );
}

export async function markReturnLabelPurchaseFailed(
  lease: ReturnLabelPurchaseLease,
  safeError: string,
): Promise<void> {
  await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'failed',
      selectedRateJson: null,
      providerReceiptJson: null,
      leaseToken: null,
      leaseExpiresAt: null,
      lastSafeError: safeError,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, lease.intentId),
        eq(returnLabelPurchaseIntents.generation, lease.generation),
        eq(returnLabelPurchaseIntents.leaseToken, lease.leaseToken),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    );
}

export async function resolveReturnLabelPurchaseNoEffect(
  intentId: number,
  input: { actor: string; note: string },
): Promise<ReturnLabelPurchaseIntent> {
  const now = new Date();
  const [resolved] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'failed',
      generation: sql`${returnLabelPurchaseIntents.generation} + 1`,
      leaseToken: null,
      leaseExpiresAt: null,
      providerLabelId: null,
      providerShipmentId: null,
      providerReceiptJson: null,
      resolutionNote: input.note,
      resolvedBy: input.actor,
      resolvedAt: now,
      lastSafeError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, intentId),
        eq(returnLabelPurchaseIntents.state, 'unknown_outcome'),
      ),
    )
    .returning();
  if (!resolved) throw new Error('Only an unknown return label outcome can be resolved as no-effect');
  return resolved;
}

async function heartbeatReturnLabelPurchase(lease: ReturnLabelPurchaseLease): Promise<boolean> {
  const now = new Date();
  const [updated] = await db
    .update(returnLabelPurchaseIntents)
    .set({ leaseExpiresAt: new Date(now.getTime() + PURCHASE_LEASE_MS), updatedAt: now })
    .where(and(
      eq(returnLabelPurchaseIntents.id, lease.intentId),
      eq(returnLabelPurchaseIntents.generation, lease.generation),
      eq(returnLabelPurchaseIntents.leaseToken, lease.leaseToken),
      eq(returnLabelPurchaseIntents.state, 'purchasing'),
    ))
    .returning({ id: returnLabelPurchaseIntents.id });
  return !!updated;
}

export async function runReturnLabelPurchaseAttempt<T>(
  lease: ReturnLabelPurchaseLease,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let heartbeatRunning = false;
  const timeout = setTimeout(() => controller.abort(new Error('Return label provider attempt timed out')), PURCHASE_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || controller.signal.aborted) return;
    heartbeatRunning = true;
    void heartbeatReturnLabelPurchase(lease)
      .then((owned) => {
        if (!owned) controller.abort(new Error('Return label provider attempt lost its generation fence'));
      })
      .catch((error) => controller.abort(error))
      .finally(() => { heartbeatRunning = false; });
  }, HEARTBEAT_MS);
  try {
    return await execute(controller.signal);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

export async function completeReturnLabelPurchase(
  intentId: number,
  returnShipmentId: number,
): Promise<void> {
  const now = new Date();
  const [updated] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'completed',
      returnShipmentId,
      leaseToken: null,
      leaseExpiresAt: null,
      selectedRateJson: null,
      providerReceiptJson: null,
      lastSafeError: null,
      reconciledAt: now,
      updatedAt: now,
    })
    .where(eq(returnLabelPurchaseIntents.id, intentId))
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Return label purchase intent could not be completed');
}

/**
 * Record that this intent's purchased label was voided, releasing the return.
 *
 * This does NOT decide or store whether postage was voided — `shipments.voided`
 * remains canonical for that, per the CP-057 ownership split. This is the
 * intent's derived lifecycle marker, written from that event, and it exists so
 * a replacement label can be bought: a completed intent is not claimable, and
 * UNIQUE (return_id) forbids a second one, so without this transition a voided
 * return could never buy postage again.
 *
 * The provider reference key is ROTATED rather than reused. It is the provider's
 * idempotency key, so replaying it for the replacement risks the provider
 * handing back the voided label instead of selling a new one.
 *
 * `returnShipmentId` is deliberately left pointing at the voided shipment. It is
 * accurate history until a replacement completes and overwrites it, and the
 * shipment row itself carries the authoritative voided flag.
 */
export async function markReturnLabelPurchaseVoided(
  intentId: number,
  resolution: { note: string; actor: string },
): Promise<void> {
  const now = new Date();
  const [updated] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'voided',
      providerReferenceKey: `cp-return-${randomUUID()}`,
      generation: sql`${returnLabelPurchaseIntents.generation} + 1`,
      leaseToken: null,
      leaseExpiresAt: null,
      resolutionNote: resolution.note,
      resolvedBy: resolution.actor,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, intentId),
        // Only a live purchased label can be voided. Anything mid-flight must
        // resolve through the existing unknown-outcome path first, so voiding
        // can never race an in-progress provider call.
        eq(returnLabelPurchaseIntents.state, 'completed'),
      ),
    )
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Only a completed return label purchase intent can be voided');
}

export function selectedRateFromIntent(intent: ReturnLabelPurchaseIntent): Rate | null {
  const value = intent.selectedRateJson as Partial<Rate> | null;
  return value && typeof value.carrier_id === 'string' && typeof value.service_code === 'string'
    ? (value as Rate)
    : null;
}

export function providerReceiptFromIntent(
  intent: ReturnLabelPurchaseIntent,
): CreatedExternalLabel | null {
  const value = intent.providerReceiptJson as Partial<CreatedExternalLabel> | null;
  return value && typeof value.shipmentId === 'number' && typeof value.serviceCode === 'string'
    ? (value as CreatedExternalLabel)
    : null;
}
