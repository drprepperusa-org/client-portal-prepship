import { env } from '../lib/env';

export type CustomerSafeShippingMoney = {
  cShippingRateAmount: number;
  customerRateSource: 'realized_customer_shipping_rate' | 'hugrab_shipping_rate_override';
  customerShippingMoneyPolicyVersion: 'ps-437-v1';
};

/**
 * Thin Client Portal adapter: PrepShip resolves and freezes the internal money
 * tuple; this caller receives only the customer-visible amount + provenance.
 */
export async function freezePrepShipCustomerShippingMoney(input: {
  shipmentId: number;
  authorization?: string;
}): Promise<CustomerSafeShippingMoney> {
  if (!env.PREPSHIP_API_URL) {
    throw new Error('PrepShip customer shipping money API is not configured');
  }
  if (!input.authorization) {
    throw new Error('Authenticated PrepShip pricing context is required');
  }
  const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/client-portal/customer-shipping-money/freeze`, {
    method: 'POST',
    headers: {
      authorization: input.authorization,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ shipmentId: input.shipmentId }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as {
    data?: Partial<CustomerSafeShippingMoney>;
    error?: string;
  } | null;
  if (!response.ok) {
    throw new Error(payload?.error || 'PrepShip customer shipping money is unavailable');
  }
  const amount = Number(payload?.data?.cShippingRateAmount);
  const source = payload?.data?.customerRateSource;
  const policyVersion = payload?.data?.customerShippingMoneyPolicyVersion;
  if (!Number.isFinite(amount) || amount <= 0 ||
      (source !== 'realized_customer_shipping_rate' && source !== 'hugrab_shipping_rate_override') ||
      policyVersion !== 'ps-437-v1') {
    throw new Error('PrepShip returned an invalid customer shipping money snapshot');
  }
  return {
    cShippingRateAmount: amount,
    customerRateSource: source,
    customerShippingMoneyPolicyVersion: policyVersion,
  };
}
