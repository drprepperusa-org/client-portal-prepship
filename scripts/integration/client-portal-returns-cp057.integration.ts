/* CP-057 duplicate-postage and reconciliation integration suite.
 *
 * Uses a throwaway Postgres plus in-memory ShipStation fixtures. It cannot
 * contact a carrier or purchase real postage.
 */
import { and, eq, sql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.RETURNS_LIVE_LABELS = 'true';
process.env.SHIPSTATION_API_KEY_V2 = 'cp057-test-key';
process.env.PREPSHIP_API_URL = 'https://prepship.example.test';

const remoteLabels = new Map<string, Record<string, unknown>>();
const originalFetch = globalThis.fetch;
let providerCalls = 0;
let providerMode: 'success' | 'timeout_after_submit' | 'timeout_before_submit' = 'success';
let customerRateMode: 'ready' | 'unavailable' = 'ready';
let providerStarted: (() => void) | null = null;
let providerRelease: Promise<void> | null = null;
let freezeCustomerMoneyForShipment: ((shipmentId: number) => Promise<void>) | null = null;

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === 'https://prepship.example.test/client-portal/customer-shipping-money/return-preview') {
    if (customerRateMode === 'unavailable') {
      return response({ error: 'Customer return shipping rate is not configured' }, 422);
    }
    return response({
      data: {
        cShippingRateAmount: 9.09,
        customerRateSource: 'realized_customer_shipping_rate',
        customerShippingMoneyPolicyVersion: 'ps-437-v1',
      },
    });
  }
  if (url === 'https://prepship.example.test/client-portal/customer-shipping-money/freeze') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { shipmentId?: unknown };
    const shipmentId = Number(body.shipmentId);
    if (!Number.isInteger(shipmentId) || shipmentId <= 0 || !freezeCustomerMoneyForShipment) {
      throw new Error('CP-057 freeze fixture received an invalid shipment');
    }
    await freezeCustomerMoneyForShipment(shipmentId);
    return response({
      data: {
        cShippingRateAmount: 9.09,
        customerRateSource: 'realized_customer_shipping_rate',
        customerShippingMoneyPolicyVersion: 'ps-437-v1',
      },
    });
  }
  if (url === 'https://api.shipstation.com/v2/carriers') {
    return response({
      carriers: [{
        carrier_id: 'se-57',
        carrier_code: 'ups',
        nickname: 'CP-057 fixture',
        disabled_by_billing_plan: false,
      }],
    });
  }
  if (url === 'https://api.shipstation.com/v2/rates/estimate') {
    return response([{
      rate_id: 'cp057-rate',
      carrier_id: 'se-57',
      carrier_code: 'ups',
      service_code: 'ups_ground',
      service_type: 'UPS Ground',
      package_type: 'package',
      shipping_amount: { currency: 'usd', amount: 7.57 },
      delivery_days: 3,
    }]);
  }
  const prefix = 'https://api.shipstation.com/v2/labels/external_shipment_id/';
  if (url.startsWith(prefix)) {
    const key = decodeURIComponent(url.slice(prefix.length));
    const label = remoteLabels.get(key);
    // ShipStation returns an empty 404 for a missing external shipment id.
    // Reproduce that exact response so reconciliation cannot depend on a JSON
    // error body or attempt to consume the body twice.
    return label ? response(label) : new Response(null, { status: 404 });
  }
  throw new Error(`CP-057 integration blocked unexpected network request: ${url}`);
}) as typeof fetch;

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const returnsService = await import('../../src/services/returns');
const { env } = await import('../../src/lib/env');
const { carrierConnectors } = await import('../../src/connectors/registry');
const originalCreateLabel = carrierConnectors.shipstation.createLabel;

freezeCustomerMoneyForShipment = async (shipmentId) => {
  const [shipment] = await db
    .select({ selectedRateJson: schema.shipments.selectedRateJson })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, shipmentId))
    .limit(1);
  if (!shipment) throw new Error('CP-057 freeze fixture shipment was not found');
  const selectedRateJson = shipment.selectedRateJson &&
    typeof shipment.selectedRateJson === 'object' &&
    !Array.isArray(shipment.selectedRateJson)
    ? shipment.selectedRateJson
    : {};
  await db
    .update(schema.shipments)
    .set({
      selectedRateJson: {
        ...selectedRateJson,
        selectedRateCost: 7.57,
        cShippingRateAmount: 9.09,
        shippingMarginAmount: 1.52,
        shippingMarginPct: 16.7,
        customerRateSource: 'realized_customer_shipping_rate',
        rateCostSource: 'label_final_cost',
        customerShippingMoneyPolicyVersion: 'ps-437-v1',
      },
    })
    .where(eq(schema.shipments.id, shipmentId));
};

function providerPayload(key: string) {
  return {
    label_id: `label-${key}`,
    shipment_id: 'se-57001',
    tracking_number: '1ZCP05700000000001',
    label_download: { pdf: `https://labels.example.test/${key}.pdf` },
    label_format: 'pdf',
    shipment_cost: { amount: 7.57, currency: 'usd' },
    voided: false,
    carrier_id: 'se-57',
    carrier_code: 'ups',
    service_code: 'ups_ground',
    ship_date: '2026-07-14',
  };
}

carrierConnectors.shipstation.createLabel = async (input) => {
  providerCalls += 1;
  if (input.isReturnLabel !== true) {
    throw new Error('CP-057 provider request was not marked as a return label');
  }
  const key = input.externalShipmentId;
  if (!key) throw new Error('CP-057 stable external shipment id was not supplied');
  if (providerMode === 'timeout_before_submit') {
    throw new TypeError('fixture timeout before provider receipt');
  }
  const payload = providerPayload(key);
  remoteLabels.set(key, payload);
  providerStarted?.();
  if (providerRelease) await providerRelease;
  if (providerMode === 'timeout_after_submit') {
    throw new TypeError('fixture timeout after submission');
  }
  return {
    labelId: String(payload.label_id),
    shipmentId: 57_001,
    trackingNumber: String(payload.tracking_number),
    labelUrl: (payload.label_download as { pdf: string }).pdf,
    labelFormat: 'pdf',
    cost: 7.57,
    voided: false,
    carrierCode: 'ups',
    serviceCode: 'ups_ground',
    shipDate: '2026-07-14',
    providerAccountId: 57,
  };
};

let failures = 0;
const check = (condition: boolean, message: string) => {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
};
const equal = (actual: unknown, expected: unknown, message: string) =>
  check(actual === expected, `${message} (got ${String(actual)}, want ${String(expected)})`);

async function reset(): Promise<void> {
  await db.execute(sql`drop trigger if exists cp057_fail_return_insert on shipments`);
  await db.execute(sql`drop function if exists cp057_fail_return_insert()`);
  await db.execute(sql`drop trigger if exists cp057_fail_return_update on returns`);
  await db.execute(sql`drop function if exists cp057_fail_return_update()`);
  await db.execute(sql`
    truncate table
      return_label_purchase_intents,
      return_activity_events,
      return_labels,
      returns,
      shipments,
      rate_cache,
      billing_config,
      orders,
      clients
    restart identity cascade
  `);
  providerCalls = 0;
  providerMode = 'success';
  customerRateMode = 'ready';
  providerStarted = null;
  providerRelease = null;
  remoteLabels.clear();
  env.RETURNS_LIVE_LABELS = true;
}

async function seed(isTest = false) {
  const [client] = await db
    .insert(schema.clients)
    .values({ name: 'CP-057 Client', isTest })
    .returning();
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: 'CP057-ORDER',
      orderStatus: 'shipped',
      clientId: client!.id,
      shipToName: 'CP-057 Customer',
      shipToCity: 'Los Angeles',
      shipToState: 'CA',
      shipToPostalCode: '90001',
      raw: {
        shipTo: {
          name: 'CP-057 Customer',
          street1: '57 Test Street',
          city: 'Los Angeles',
          state: 'CA',
          postalCode: '90001',
          country: 'US',
        },
      },
    })
    .returning();
  const [outbound] = await db
    .insert(schema.shipments)
    .values({
      orderId: order!.id,
      clientId: client!.id,
      orderNumber: order!.orderNumber,
      trackingNumber: 'OUTBOUND-CP057',
      weightOz: 16,
      dimsL: 10,
      dimsW: 8,
      dimsH: 4,
      selectedPackageId: 'package',
      voided: false,
      isReturn: false,
      source: 'cp057_fixture',
    })
    .returning();
  const [returnRow] = await db
    .insert(schema.returns)
    .values({
      orderId: order!.id,
      clientId: client!.id,
      returnReference: 'CP057-ORDER-RETURN',
      status: 'requested',
      initiatedBy: 'client',
      reason: 'CP-057 integration fixture',
    })
    .returning();
  return {
    clientId: client!.id,
    orderId: order!.id,
    outboundShipmentId: outbound!.id,
    returnId: returnRow!.id,
  };
}

const create = (fixture: Awaited<ReturnType<typeof seed>>) =>
  returnsService.createReturnLabel({
    returnId: fixture.returnId,
    orderId: fixture.orderId,
    actorType: 'client',
    actorEmail: 'cp057@example.test',
    authorization: 'Bearer cp057-fixture',
  });

async function returnShipments(orderId: number) {
  return db
    .select()
    .from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.isReturn, true)));
}

function assertRedacted(result: Record<string, unknown>): void {
  for (const field of [
    'carrierCode',
    'serviceCode',
    'providerAccountId',
    'selectedRateJson',
    'providerReferenceKey',
  ]) {
    check(!(field in result), `client result redacts ${field}`);
  }
}

async function concurrencyScenario(): Promise<void> {
  console.log('\nCP-057 Group 1 - concurrent purchase ownership');
  await reset();
  const fixture = await seed();
  let releaseProvider!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  providerStarted = signalStarted;
  providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });

  const first = create(fixture);
  await started;
  const second = create(fixture);
  releaseProvider();
  const outcomes = await Promise.allSettled([first, second]);

  equal(providerCalls, 1, 'two concurrent requests make one provider purchase');
  equal((await returnShipments(fixture.orderId)).length, 1, 'one canonical return shipment exists');
  check(outcomes.some((result) => result.status === 'fulfilled'), 'one request completes successfully');
  const completed = outcomes.find((result) => result.status === 'fulfilled');
  equal(
    completed?.status === 'fulfilled' ? completed.value.returnCustomerShippingRate : null,
    9.09,
    'client result preserves the customer rate separately from provider cost',
  );
  check(
    outcomes.every((result) =>
      result.status === 'fulfilled' ||
      result.reason instanceof returnsService.ReturnLabelPurchasePendingError),
    'the non-owner receives only a safe pending response',
  );
}

async function shipmentInsertRecoveryScenario(): Promise<void> {
  console.log('\nCP-057 Group 2 - provider success then shipment insert failure');
  await reset();
  const fixture = await seed();
  await db.execute(sql`
    create function cp057_fail_return_insert() returns trigger language plpgsql as $$
    begin
      if new.is_return then raise exception 'cp057 fixture shipment insert failure'; end if;
      return new;
    end $$
  `);
  await db.execute(sql`
    create trigger cp057_fail_return_insert before insert on shipments
    for each row execute function cp057_fail_return_insert()
  `);
  await create(fixture).then(
    () => check(false, 'shipment insert fixture fails the first request'),
    () => check(true, 'shipment insert fixture fails the first request'),
  );
  const [pending] = await db.select().from(schema.returnLabelPurchaseIntents);
  equal(pending?.state, 'purchased', 'provider receipt is durable before shipment persistence');
  await db.execute(sql`drop trigger cp057_fail_return_insert on shipments`);
  await db.execute(sql`drop function cp057_fail_return_insert()`);

  customerRateMode = 'unavailable';
  await create(fixture).then(
    () => check(false, 'recovery blocks shipment persistence when customer pricing is unavailable'),
    (error) => check(
      error instanceof returnsService.ReturnCustomerRateUnavailableError,
      'recovery blocks shipment persistence when customer pricing is unavailable',
    ),
  );
  equal(providerCalls, 1, 'blocked recovery never repurchases postage');
  equal((await returnShipments(fixture.orderId)).length, 0, 'blocked recovery writes no shipment');

  customerRateMode = 'ready';
  const result = await create(fixture);
  equal(providerCalls, 1, 'retry reuses the provider receipt without repurchase');
  equal((await returnShipments(fixture.orderId)).length, 1, 'retry persists one canonical shipment');
  assertRedacted(result as unknown as Record<string, unknown>);
}

async function returnUpdateRecoveryScenario(): Promise<void> {
  console.log('\nCP-057 Group 3 - shipment success then return-row update failure');
  await reset();
  const fixture = await seed();
  await db.execute(sql`
    create function cp057_fail_return_update() returns trigger language plpgsql as $$
    begin
      if new.status = 'label_created' then
        raise exception 'cp057 fixture return update failure';
      end if;
      return new;
    end $$
  `);
  await db.execute(sql`
    create trigger cp057_fail_return_update before update on returns
    for each row execute function cp057_fail_return_update()
  `);
  await create(fixture).then(
    () => check(false, 'return update fixture fails the first request'),
    () => check(true, 'return update fixture fails the first request'),
  );
  const [intent] = await db.select().from(schema.returnLabelPurchaseIntents);
  equal(intent?.state, 'completed', 'canonical shipment completion survives workflow-link failure');
  equal((await returnShipments(fixture.orderId)).length, 1, 'the canonical shipment already exists');
  await db.execute(sql`drop trigger cp057_fail_return_update on returns`);
  await db.execute(sql`drop function cp057_fail_return_update()`);

  const result = await create(fixture);
  equal(providerCalls, 1, 'retry repairs the return row without repurchase');
  const [returnRow] = await db.select().from(schema.returns);
  equal(returnRow?.status, 'label_created', 'retry reconciles workflow state forward');
  equal(returnRow?.returnShipmentId, result.returnShipmentId, 'retry links the canonical shipment');
}

async function unknownOutcomeScenario(): Promise<void> {
  console.log('\nCP-057 Group 4 - timeout after submission');
  await reset();
  const fixture = await seed();
  providerMode = 'timeout_after_submit';
  let firstError: unknown;
  try {
    await create(fixture);
  } catch (error) {
    firstError = error;
  }
  check(
    firstError instanceof returnsService.ReturnLabelPurchasePendingError,
    'ambiguous provider timeout returns a safe reconciliation response',
  );
  const [unknown] = await db.select().from(schema.returnLabelPurchaseIntents);
  equal(unknown?.state, 'unknown_outcome', 'timeout persists unknown_outcome');

  providerMode = 'success';
  const result = await create(fixture);
  equal(providerCalls, 1, 'retry finds the submitted label and never repurchases');
  equal((await returnShipments(fixture.orderId)).length, 1, 'reconciled timeout creates one shipment');

  const completedRetry = await create(fixture);
  equal(providerCalls, 1, 'completed retry returns the existing label');
  equal(completedRetry.returnShipmentId, result.returnShipmentId, 'completed retry is idempotent');
}

async function absentOutcomeHoldScenario(): Promise<void> {
  console.log('\nCP-057 Group 5 - provider absence remains held');
  await reset();
  const fixture = await seed();
  providerMode = 'timeout_before_submit';
  await create(fixture).then(
    () => check(false, 'ambiguous provider attempt returns pending'),
    (error) => check(error instanceof returnsService.ReturnLabelPurchasePendingError, 'ambiguous provider attempt returns pending'),
  );

  providerMode = 'success';
  await create(fixture).then(
    () => check(false, 'provider absence remains held'),
    (error) => check(error instanceof returnsService.ReturnLabelPurchasePendingError, 'provider absence remains held'),
  );
  equal(providerCalls, 1, 'provider 404 does not authorize a blind repurchase');

  const intentService = await import('../../src/services/return-label-purchase-intents');
  const [held] = await db.select().from(schema.returnLabelPurchaseIntents);
  const staleGeneration = held!.generation;
  await intentService.resolveReturnLabelPurchaseNoEffect(held!.id, {
    actor: 'lawrence@example.test',
    note: 'Fixture provider audit verified no label exists',
  });
  const result = await create(fixture);
  equal(providerCalls, 2, 'operator no-effect resolution permits one new attempt');
  equal((await returnShipments(fixture.orderId)).length, 1, 'operator-authorized retry creates one canonical shipment');

  const staleLease = {
    intentId: held!.id,
    generation: staleGeneration,
    leaseToken: held!.leaseToken ?? 'expired-fixture-token',
  };
  await intentService.recordReturnLabelProviderReceipt(staleLease, {
    labelId: 'stale-label',
    shipmentId: 999_999,
    trackingNumber: 'STALE',
    labelUrl: 'https://labels.example.test/stale.pdf',
    labelFormat: 'pdf',
    cost: 1,
    voided: false,
    carrierCode: 'ups',
    serviceCode: 'ups_ground',
    shipDate: '2026-07-14',
    providerAccountId: 57,
  }).then(
    () => check(false, 'stale generation cannot record a receipt'),
    () => check(true, 'stale generation cannot record a receipt'),
  );
  check(result.returnShipmentId > 0, 'operator-authorized retry returns the canonical shipment');
}

async function offlineGatesScenario(): Promise<void> {
  console.log('\nCP-057 Group 6 - live purchase gates and redaction');
  await reset();
  env.RETURNS_LIVE_LABELS = false;
  const flagOffFixture = await seed();
  await create(flagOffFixture).then(
    () => check(false, 'live flag OFF fails closed for a real client'),
    (error) => check(
      error instanceof returnsService.ReturnLabelStateError,
      'live flag OFF fails closed for a real client',
    ),
  );
  equal(providerCalls, 0, 'live flag OFF never calls the provider');
  equal((await returnShipments(flagOffFixture.orderId)).length, 0, 'live flag OFF creates no mock shipment');

  await reset();
  const testClientFixture = await seed(true);
  const testClient = await create(testClientFixture);
  equal(providerCalls, 0, 'clients.is_test=true never calls the provider');
  const [testShipment] = await returnShipments(testClientFixture.orderId);
  equal(testShipment?.source, 'test_offline', 'test clients use the offline mock');
  assertRedacted(testClient as unknown as Record<string, unknown>);
}

async function main(): Promise<void> {
  await concurrencyScenario();
  await shipmentInsertRecoveryScenario();
  await returnUpdateRecoveryScenario();
  await unknownOutcomeScenario();
  await absentOutcomeHoldScenario();
  await offlineGatesScenario();
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\nPASS CP-057 returns integration suite passed.\n'
      : `\nFAIL ${failures} CP-057 assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\nFAIL CP-057 integration suite errored:',
    error instanceof Error ? error.stack : error,
  );
} finally {
  carrierConnectors.shipstation.createLabel = originalCreateLabel;
  globalThis.fetch = originalFetch;
  try { await reset(); } catch { /* throwaway cleanup */ }
  await pgClient.end({ timeout: 5 });
}

process.exit(exitCode);
