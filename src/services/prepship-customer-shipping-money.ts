import { env } from '../lib/env';

export type CustomerSafeShippingMoney = {
  cShippingRateAmount: number;
  customerRateSource: 'realized_customer_shipping_rate' | 'hugrab_shipping_rate_override';
  customerShippingMoneyPolicyVersion: 'ps-437-v1';
};

async function requestPrepShipCustomerShippingMoney(input: {
  path: '/client-portal/customer-shipping-money/return-preview' |
    '/client-portal/customer-shipping-money/freeze';
  body: Record<string, unknown>;
  authorization?: string;
}): Promise<CustomerSafeShippingMoney> {
  if (!env.PREPSHIP_API_URL) {
    throw new Error('PrepShip customer shipping money API is not configured');
  }
  if (!input.authorization) {
    throw new Error('Authenticated PrepShip pricing context is required');
  }
  const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}${input.path}`, {
    method: 'POST',
    headers: {
      authorization: input.authorization,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(input.body),
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

/**
 * Read-only, server-to-server preflight. PrepShip receives the candidate
 * provider facts but returns only its customer-safe policy projection.
 */
export function previewPrepShipReturnCustomerShippingMoney(input: {
  sourceShipmentId: number;
  candidateSelectedRateCost: number;
  carrierCode?: string | null;
  providerAccountId?: number | null;
  authorization?: string;
}): Promise<CustomerSafeShippingMoney> {
  return requestPrepShipCustomerShippingMoney({
    path: '/client-portal/customer-shipping-money/return-preview',
    body: {
      sourceShipmentId: input.sourceShipmentId,
      selectedRateCost: input.candidateSelectedRateCost,
      carrierCode: input.carrierCode ?? null,
      providerAccountId: input.providerAccountId ?? null,
    },
    authorization: input.authorization,
  });
}

/**
 * Thin Client Portal adapter: PrepShip resolves and freezes the internal money
 * tuple; this caller receives only the customer-visible amount + provenance.
 */
export async function freezePrepShipCustomerShippingMoney(input: {
  shipmentId: number;
  authorization?: string;
}): Promise<CustomerSafeShippingMoney> {
  return requestPrepShipCustomerShippingMoney({
    path: '/client-portal/customer-shipping-money/freeze',
    body: { shipmentId: input.shipmentId },
    authorization: input.authorization,
  });
}
