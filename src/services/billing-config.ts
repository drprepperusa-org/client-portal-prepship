// Billing config upsert — extracted verbatim from services/billing.ts (C4).
import { db } from '../db/client';
import { billingConfig } from '../db/schema/billing';

export async function upsertBillingConfig(
  clientId: number,
  patch: Partial<{
    pickPackFee: string;
    pickPackMaxUnits: number;
    additionalUnitFee: string;
    packageCostMarkup: string;
    shippingMarkupPct: string;
    shippingMarkupFlat: string;
    shippingRateOverrideTriggerBelow: string;
    shippingRateOverrideAmount: string;
    storageFeePerCuFt: string;
    billingMode: string;
    active: boolean;
  }>
) {
  const [row] = await db
    .insert(billingConfig)
    .values({ clientId, ...patch })
    .onConflictDoUpdate({
      target: billingConfig.clientId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return row;
}
