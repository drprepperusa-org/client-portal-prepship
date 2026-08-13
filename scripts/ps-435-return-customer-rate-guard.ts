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

const { resolveReturnLabelExecutionMode } = await import(
  '../src/services/return-label-execution-policy'
);
assert.equal(
  resolveReturnLabelExecutionMode({ liveLabelsEnabled: false, isTestClient: false }),
  'disabled',
);
assert.equal(
  resolveReturnLabelExecutionMode({ liveLabelsEnabled: false, isTestClient: true }),
  'test_offline',
);
assert.equal(
  resolveReturnLabelExecutionMode({ liveLabelsEnabled: true, isTestClient: false }),
  'live',
);

const service = fs.readFileSync('src/services/returns.ts', 'utf8');
const actions = fs.readFileSync('src/routes/client-portal/returns/actions.ts', 'utf8');
const dto = fs.readFileSync('src/routes/client-portal/returns/dto.ts', 'utf8');
const rateProjection = fs.readFileSync(
  'src/lib/client-portal/customer-shipping-rate.ts',
  'utf8',
);
const invoiceDetails = fs.readFileSync(
  'src/lib/client-portal/read-models/invoice-details.ts',
  'utf8',
);
const audit = fs.readFileSync('scripts/ps-435-return-customer-rate-audit.ts', 'utf8');
const drawer = fs.readFileSync(
  'portal-client/src/components/returns/ReturnDetailDrawer.tsx',
  'utf8',
);

const previewIndex = service.indexOf('await previewPrepShipReturnCustomerShippingMoney({');
const providerIndex = service.indexOf('carrierConnectors.shipstation.createLabel({');
assert.ok(
  previewIndex > 0 && providerIndex > previewIndex,
  'customer-rate preflight executes before the provider mutation',
);
assert.match(service, /throw new ReturnCustomerRateUnavailableError\(\)/);
assert.match(service, /readFrozenCustomerShippingMoney\(shipment\.selectedRateJson\)/);
assert.match(service, /aliasAmount - frozen\.cShippingRateAmount/);
const recoveryBlock = service.slice(
  service.indexOf("purchaseAction.kind === 'recover'"),
  service.indexOf('// Only quote the carrier'),
);
assert.match(recoveryBlock, /requireApprovedReturnCustomerMoney\(/);
assert.ok(
  recoveryBlock.indexOf('requireApprovedReturnCustomerMoney(') <
    recoveryBlock.indexOf('finalizeLivePurchase('),
  'recovered provider receipts require customer-rate approval before shipment finalization',
);
assert.match(service, /executionMode === 'disabled'[\s\S]{0,250}Return label creation is unavailable/);
assert.match(service, /executionMode === 'test_offline'/);
assert.match(actions, /isCustomerRateUnavailable[\s\S]{0,300}\?\s*422/);
assert.match(dto, /row\.validatedReturnCustomerShippingRate/);
assert.doesNotMatch(dto, /row\.ret\.returnCustomerShippingRate/);
assert.doesNotMatch(dto, /selectedRateCost|labelCost|houseCost|bestRate/);
assert.match(rateProjection, /validatedReturnCustomerShippingRateSql/);
assert.match(rateProjection, /customerSafeBillingLineSql/);
assert.match(rateProjection, /customerShippingMoneyPolicyVersion/);
assert.match(invoiceDetails, /customerSafeInvoiceLine/);
assert.match(audit, /set transaction read only/);
assert.doesNotMatch(audit, /\b(update|delete|insert|alter|drop|create)\b/i);
// ── CP-059A — the GENERATOR half of PS-435 moved to PrepShip ─────────────────
//
// Two assertions used to stand here. They read `src/services/billing.ts` and
// sliced the `returnShipmentRows` loop out of `generateLineItems`, pinning that:
//
//   1. the generator SKIPPED the return_postage line and logged "canonical
//      customer snapshot missing" when PrepShip's policy-versioned tuple was
//      absent, rather than billing a guess; and
//   2. it never reached for a raw provider cost (resolveReturnPostageRate,
//      selectedRateCost, labelCost, otherCost) to price that line.
//
// Both are GENERATOR money policy — they describe how a return_postage row gets
// its amount at write time. CP-059A DELETED src/services/billing.ts and made
// PrepShip (repo prepship-v4) the sole owner of billing_line_items generation
// and of return money policy, so those two rules now live — and are pinned —
// there, beside the writer that enforces them. They are not dropped; this repo
// simply no longer contains the code they described.
//
// They are deliberately NOT re-anchored onto src/services/billing-read-support.ts.
// That module received the writer's shared READ helpers verbatim (scope
// predicates and value formatters); it prices nothing, so pointing a money-policy
// assertion at it would assert against a file that could satisfy it by accident.
//
// What replaces them is the half of the same concern the portal DOES still own.
// PS-435 exists so a customer never sees a return postage amount that PrepShip's
// canonical tuple has not proved. With the writer gone, the portal's remaining
// exposure is the READ path over historical return_postage rows, and its
// enforcement is customerSafeBillingLineSql. So the coverage below is: nothing
// local may price a return line, the extracted helpers did not quietly become
// the writer's new home, and every read that totals return_postage still passes
// through the canonical-tuple gate.

// Structural retirement: not emptied or stubbed, deleted. There is no file for a
// return-pricing generator to be re-added to without deliberately re-authoring one.
assert.ok(
  !fs.existsSync('src/services/billing.ts'),
  'the portal must retain no local billing generator to price return postage',
);

// The helpers CP-059A extracted must stay helpers. This is the likeliest shape of
// a regression: someone "restoring" PS-435 by reintroducing return money policy
// into the module that inherited the retired writer's read utilities.
const readSupport = fs.readFileSync('src/services/billing-read-support.ts', 'utf8');
assert.doesNotMatch(
  readSupport,
  /return_postage|returnCustomerShippingRate|returnProcessingFee/,
  'billing-read-support.ts must carry no return money policy — that moved to PrepShip',
);

// The surviving portal-side rule, asserted against the real read models rather
// than a retired generator: a historical return_postage row is customer-safe only
// when the linked return alias and shipment tuple both prove the same canonical
// amount, which is exactly what customerSafeBillingLineSql encodes.
function serverSources(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (/node_modules|__tests__|__fixtures__/.test(entry.name)) continue;
      serverSources(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Discovered, not hardcoded, so a NEW surface that totals return_postage is caught
// the day it is added instead of inheriting an exemption from this list.
const returnPostageReaders = serverSources('src').filter((file) =>
  /line_type = 'return_postage'/.test(fs.readFileSync(file, 'utf8')),
);
// Vacuity guard: the three known read surfaces are billing-summaries.ts,
// read-models/invoice-details.ts and reporting-metrics.ts. If this count drops,
// the loop below stopped covering a surface and must be re-examined, not relaxed.
assert.ok(
  returnPostageReaders.length >= 3,
  `expected the portal's return_postage read surfaces to remain; found ${returnPostageReaders.length}`,
);
for (const file of returnPostageReaders) {
  assert.match(
    fs.readFileSync(file, 'utf8'),
    /customerSafeBillingLineSql/,
    `${file} totals return_postage without the canonical-tuple gate`,
  );
}

assert.match(drawer, /Customer rate pending/);

console.log('PS-435 Client Portal return customer-rate guard passed.');
