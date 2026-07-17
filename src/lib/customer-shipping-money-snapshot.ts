export type FrozenCustomerShippingMoney = {
  selectedRateCost: number;
  cShippingRateAmount: number;
  shippingMarginAmount: number;
  shippingMarginPct: number | null;
  customerRateSource: string;
  rateCostSource: string;
  customerShippingMoneyPolicyVersion: string;
};

function finite(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Validation-only reader. It never computes, ranks, marks up, or falls back. */
export function readFrozenCustomerShippingMoney(value: unknown): FrozenCustomerShippingMoney | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const selectedRateCost = finite(row.selectedRateCost);
  const cShippingRateAmount = finite(row.cShippingRateAmount);
  const shippingMarginAmount = finite(row.shippingMarginAmount);
  const hasShippingMarginPct = Object.prototype.hasOwnProperty.call(row, 'shippingMarginPct');
  const shippingMarginPct = row.shippingMarginPct == null ? null : finite(row.shippingMarginPct);
  if (
    selectedRateCost == null || selectedRateCost <= 0 ||
    cShippingRateAmount == null || cShippingRateAmount <= 0 ||
    shippingMarginAmount == null ||
    !hasShippingMarginPct ||
    (row.shippingMarginPct != null && shippingMarginPct == null) ||
    money(cShippingRateAmount - selectedRateCost) !== money(shippingMarginAmount) ||
    (row.customerRateSource !== 'realized_customer_shipping_rate' &&
      row.customerRateSource !== 'hugrab_shipping_rate_override') ||
    row.rateCostSource !== 'label_final_cost' ||
    row.customerShippingMoneyPolicyVersion !== 'ps-437-v1'
  ) {
    return null;
  }
  return {
    selectedRateCost: money(selectedRateCost),
    cShippingRateAmount: money(cShippingRateAmount),
    shippingMarginAmount: money(shippingMarginAmount),
    shippingMarginPct,
    customerRateSource: row.customerRateSource,
    rateCostSource: row.rateCostSource,
    customerShippingMoneyPolicyVersion: row.customerShippingMoneyPolicyVersion,
  };
}
