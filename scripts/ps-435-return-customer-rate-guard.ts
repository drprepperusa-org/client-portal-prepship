import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret-test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.PREPSHIP_API_URL = 'https://prepship.example.test';

const originalFetch = globalThis.fetch;
const requestedProviderCosts: number[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  assert.equal(
    String(input),
    'https://prepship.example.test/client-portal/customer-shipping-money/return-preview',
  );
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
  requestedProviderCosts.push(Number(body.selectedRateCost));
  return new Response(JSON.stringify({
    data: {
      cShippingRateAmount: 7.73,
      customerRateSource: 'hugrab_shipping_rate_override',
      customerShippingMoneyPolicyVersion: 'ps-437-v1',
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

try {
  const { previewPrepShipReturnCustomerShippingMoney } = await import(
    '../src/services/prepship-customer-shipping-money'
  );
  for (const candidateSelectedRateCost of [5.70, 5.58]) {
    const safe = await previewPrepShipReturnCustomerShippingMoney({
      sourceShipmentId: 435,
      candidateSelectedRateCost,
      carrierCode: 'stamps_com',
      providerAccountId: 7439,
      authorization: 'Bearer ps-435-test',
    });
    assert.deepEqual(Object.keys(safe).sort(), [
      'cShippingRateAmount',
      'customerRateSource',
      'customerShippingMoneyPolicyVersion',
    ]);
    assert.equal(safe.cShippingRateAmount, 7.73);
    assert.notEqual(safe.cShippingRateAmount, candidateSelectedRateCost);
  }
  assert.deepEqual(requestedProviderCosts, [5.70, 5.58]);
} finally {
  globalThis.fetch = originalFetch;
}

const service = fs.readFileSync('src/services/returns.ts', 'utf8');
const actions = fs.readFileSync('src/routes/client-portal/returns/actions.ts', 'utf8');
const dto = fs.readFileSync('src/routes/client-portal/returns/dto.ts', 'utf8');
const billing = fs.readFileSync('src/services/billing.ts', 'utf8');
const drawer = fs.readFileSync(
  'portal-client/src/components/returns/ReturnDetailDrawer.tsx',
  'utf8',
);

const previewIndex = service.indexOf('await previewPrepShipReturnCustomerShippingMoney({');
const providerIndex = service.indexOf('carrierConnectors.shipstation.createLabel({');
const returnBillingBlock = billing.slice(
  billing.indexOf('const returnShipmentRows = await db'),
  billing.indexOf('const processingFee = toNum(cfg.returnProcessingFee)'),
);
assert.ok(
  previewIndex > 0 && providerIndex > previewIndex,
  'customer-rate preflight executes before the provider mutation',
);
assert.match(service, /throw new ReturnCustomerRateUnavailableError\(\)/);
assert.match(actions, /isCustomerRateUnavailable[\s\S]{0,300}\?\s*422/);
assert.match(dto, /row\.ret\.returnCustomerShippingRate/);
assert.doesNotMatch(dto, /selectedRateCost|labelCost|houseCost|bestRate/);
assert.match(returnBillingBlock, /canonical customer snapshot missing/);
assert.doesNotMatch(
  returnBillingBlock,
  /resolveReturnPostageRate|selectedRateCost|labelCost|otherCost/,
);
assert.match(drawer, /Customer rate pending/);

console.log('PS-435 Client Portal return customer-rate guard passed.');
