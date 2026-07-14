import { randomUUID } from 'node:crypto';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  returnLabelPurchaseIntents,
  type ReturnLabelPurchaseIntent,
} from '../db/schema/return-label-purchase-intents';
import type { CreatedExternalLabel } from '../lib/shipstation/labels';
import type { Rate } from '../lib/shipstation';

const STALE_PURCHASE_MS = 5 * 60 * 1000;

export type ReturnLabelPurchaseAction =
  | { kind: 'purchase'; intent: ReturnLabelPurchaseIntent }
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

async function tryClaim(returnId: number): Promise<ReturnLabelPurchaseIntent | null> {
  const now = new Date();
  const [claimed] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'purchasing',
      attemptCount: sql`${returnLabelPurchaseIntents.attemptCount} + 1`,
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
  if (claimed) return { kind: 'purchase', intent: claimed };

  let intent = await getReturnLabelPurchaseIntent(returnId);
  if (!intent) throw new Error('Return label purchase intent could not be reserved');

  if (
    intent.state === 'purchasing' &&
    intent.lastAttemptAt != null &&
    intent.lastAttemptAt.getTime() <= Date.now() - STALE_PURCHASE_MS
  ) {
    const now = new Date();
    const [stale] = await db
      .update(returnLabelPurchaseIntents)
      .set({
        state: 'unknown_outcome',
        lastSafeError: 'Provider outcome requires reconciliation',
        updatedAt: now,
      })
      .where(
        and(
          eq(returnLabelPurchaseIntents.id, intent.id),
          eq(returnLabelPurchaseIntents.state, 'purchasing'),
          lte(returnLabelPurchaseIntents.lastAttemptAt, new Date(Date.now() - STALE_PURCHASE_MS)),
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
    if (retryClaim) return { kind: 'purchase', intent: retryClaim };
  }
  return { kind: 'in_progress', intent };
}

export async function saveReturnLabelSelectedRate(
  intentId: number,
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
        eq(returnLabelPurchaseIntents.id, intentId),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    )
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Return label purchase intent is no longer owned by this attempt');
}

export async function recordReturnLabelProviderReceipt(
  intentId: number,
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
      purchasedAt: now,
      lastSafeError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, intentId),
        or(
          eq(returnLabelPurchaseIntents.state, 'purchasing'),
          eq(returnLabelPurchaseIntents.state, 'unknown_outcome'),
          eq(returnLabelPurchaseIntents.state, 'purchased'),
        ),
      ),
    )
    .returning({ id: returnLabelPurchaseIntents.id });
  if (!updated) throw new Error('Return label provider receipt could not be recorded');
}

export async function markReturnLabelPurchaseUnknown(intentId: number): Promise<void> {
  await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'unknown_outcome',
      lastSafeError: 'Provider outcome requires reconciliation',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, intentId),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    );
}

export async function markReturnLabelPurchaseFailed(
  intentId: number,
  safeError: string,
): Promise<void> {
  await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'failed',
      selectedRateJson: null,
      providerReceiptJson: null,
      lastSafeError: safeError,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(returnLabelPurchaseIntents.id, intentId),
        eq(returnLabelPurchaseIntents.state, 'purchasing'),
      ),
    );
}

export async function reclaimReturnLabelPurchaseAfterAbsence(
  intentId: number,
): Promise<ReturnLabelPurchaseIntent | null> {
  const now = new Date();
  const [claimed] = await db
    .update(returnLabelPurchaseIntents)
    .set({
      state: 'purchasing',
      attemptCount: sql`${returnLabelPurchaseIntents.attemptCount} + 1`,
      lastAttemptAt: now,
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
  return claimed ?? null;
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
