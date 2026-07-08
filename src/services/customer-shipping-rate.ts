import { SS_BASELINE_CARRIER_CODES } from './rates';

export type CustomerShippingRateInput = {
  /**
   * Source/clock/owner: selected/purchased outbound label HOUSE cost at ship or
   * bill time. This is shipments.cost, falling back to label_cost, plus
   * other_cost. It is never buyer-paid store shipping.
   */
  houseCost: number;
  /** Client reference USPS rate from order_overrides, when configured. */
  refUspsRate?: number | null;
  /** Client reference UPS rate from order_overrides, when configured. */
  refUpsRate?: number | null;
  /** billing_config.billing_mode at bill/read time. */
  billingMode?: string | null;
  /** Shipment carrier code; baseline ShipStation carriers skip reference uplift. */
  carrierCode?: string | null;
  /** billing_config.shipping_markup_pct. */
  markupPct?: number | null;
  /** billing_config.shipping_markup_flat. */
  markupFlat?: number | null;
  /** billing_config.shipping_rate_override_trigger_below. */
  overrideTriggerBelow?: number | null;
  /** billing_config.shipping_rate_override_amount. */
  overrideAmount?: number | null;
  /** billing_config.active; inactive means no projectable rate. */
  active?: boolean | null;
};

export type CustomerShippingRateResult = {
  cShippingRate: number | null;
  houseCost: number;
  billedBase: number | null;
  markedUpCost: number | null;
  referenceRate: number | null;
  usedReferenceRate: boolean;
  overrideApplied: boolean;
};

function finiteOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function isReferenceRateMode(mode: string | null | undefined): boolean {
  return mode === 'reference_rate' || mode === 'ss_ref_rate';
}

function bestReferenceRate(refUspsRate: number, refUpsRate: number): number | null {
  const candidates = [refUspsRate, refUpsRate].filter((value) => value > 0);
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * PS-366 helper: applies the customer-facing below-trigger override.
 * The trigger tests the selected/purchased label house cost, never the marked-up
 * value. This is not a floor.
 */
export function resolveCustomerShippingRate(input: {
  /** Selected/purchased label cost - the pre-markup source of truth. */
  selectedCost: number;
  /** Shipping charge after billing-mode + markup rules. */
  markedUpCost: number;
  /** Trigger threshold; 0/negative disables. */
  triggerBelow: number;
  /** Override amount when triggered; 0/negative disables. */
  overrideAmount: number;
}): { cShippingRate: number; overrideApplied: boolean } {
  const { selectedCost, markedUpCost, triggerBelow, overrideAmount } = input;
  if (triggerBelow > 0 && overrideAmount > 0 && selectedCost > 0 && selectedCost < triggerBelow) {
    return { cShippingRate: overrideAmount, overrideApplied: true };
  }
  return { cShippingRate: markedUpCost, overrideApplied: false };
}

/**
 * CP-041 authoritative TS owner for outbound Customer Shipping Rate projection.
 *
 * Formula:
 * 1. Start from selected/purchased label house cost.
 * 2. In reference-rate modes for non-baseline carriers, raise the base to
 *    max(house cost, min(positive USPS ref, positive UPS ref)).
 * 3. Apply billing_config pct + flat markup.
 * 4. Apply the below-trigger override using the raw house cost.
 *
 * The Client Portal SQL read-model mirrors this owner in
 * src/lib/client-portal/customer-shipping-rate.ts because the portal needs the
 * same formula inside set-based SQL queries.
 */
export function computeCustomerShippingRate(input: CustomerShippingRateInput): CustomerShippingRateResult {
  const houseCost = finiteOrZero(input.houseCost);
  if (input.active === false || houseCost <= 0) {
    return {
      cShippingRate: null,
      houseCost,
      billedBase: null,
      markedUpCost: null,
      referenceRate: null,
      usedReferenceRate: false,
      overrideApplied: false,
    };
  }

  const referenceRate = bestReferenceRate(
    finiteOrZero(input.refUspsRate),
    finiteOrZero(input.refUpsRate),
  );
  const usedReferenceRate =
    isReferenceRateMode(input.billingMode) &&
    !SS_BASELINE_CARRIER_CODES.has(input.carrierCode ?? '') &&
    referenceRate !== null;
  const billedBase = usedReferenceRate ? Math.max(houseCost, referenceRate) : houseCost;
  const markedUpCost = billedBase * (1 + finiteOrZero(input.markupPct) / 100) + finiteOrZero(input.markupFlat);
  const { cShippingRate, overrideApplied } = resolveCustomerShippingRate({
    selectedCost: houseCost,
    markedUpCost,
    triggerBelow: finiteOrZero(input.overrideTriggerBelow),
    overrideAmount: finiteOrZero(input.overrideAmount),
  });

  return {
    cShippingRate,
    houseCost,
    billedBase,
    markedUpCost,
    referenceRate,
    usedReferenceRate,
    overrideApplied,
  };
}
