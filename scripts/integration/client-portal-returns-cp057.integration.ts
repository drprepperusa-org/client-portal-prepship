/* CP-057 duplicate-postage and reconciliation integration suite.
 *
 * Uses a throwaway Postgres plus in-memory ShipStation fixtures. It cannot
 * contact a carrier or purchase real postage.
 */
import { and, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.RETURNS_LIVE_LABELS = 'true';
process.env.SHIPSTATION_API_KEY_V2 = 'cp057-test-key';
process.env.PREPSHIP_API_URL = 'https://prepship.example.test';

const remoteLabels = new Map<string, Record<string, unknown>>();
const originalFetch = globalThis.fetch;
let providerCalls = 0;
let voidProviderCalls = 0;
let voidProviderReadbacks = 0;
let voidProviderMode: 'success' | 'already_voided' = 'success';
let voidProviderGate: ((call: number) => Promise<void>) | null = null;
let providerMode: 'success' | 'timeout_after_submit' | 'timeout_before_submit' = 'success';
let customerRateMode: 'ready' | 'unavailable' = 'ready';
let providerStarted: (() => void) | null = null;
let providerRelease: Promise<void> | null = null;
let customerMoneyFreezeGate: ((shipmentId: number) => Promise<void>) | null = null;
let freezeCustomerMoneyForShipment: ((shipmentId: number) => Promise<void>) | null = null;

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
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
  if (/^https:\/\/api\.shipstation\.com\/v2\/shipments\/se-\d+\/void$/.test(url)) {
    if (init?.method !== 'POST') {
      throw new Error(`CP-057 void fixture received ${String(init?.method)} instead of POST`);
    }
    voidProviderCalls += 1;
    if (voidProviderGate) await voidProviderGate(voidProviderCalls);
    if (voidProviderMode === 'already_voided') {
      return response({ message: 'Shipment is already voided' }, 409);
    }
    return new Response(null, { status: 204 });
  }
  if (/^https:\/\/api\.shipstation\.com\/v2\/shipments\/se-\d+$/.test(url)) {
    if (init?.method && init.method !== 'GET') {
      throw new Error(`CP-057 void readback fixture received unexpected ${init.method}`);
    }
    voidProviderReadbacks += 1;
    return response({ shipment_id: 'se-57001', shipment_status: 'cancelled' });
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
const externalTrackingService = await import('../../src/services/return-external-tracking');
const externalTrackingApply = await import('../../src/services/return-external-tracking-apply');
const labelSlotService = await import('../../src/services/return-label-slot');
const labelsService = await import('../../src/services/labels');
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
  if (customerMoneyFreezeGate) await customerMoneyFreezeGate(shipmentId);
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
  await db.execute(sql`drop trigger if exists cp057_fail_void_intent_update on return_label_purchase_intents`);
  await db.execute(sql`drop function if exists cp057_fail_void_intent_update()`);
  await db.execute(sql`drop trigger if exists cp057_fail_return_insert on shipments`);
  await db.execute(sql`drop function if exists cp057_fail_return_insert()`);
  await db.execute(sql`drop trigger if exists cp057_fail_return_update on returns`);
  await db.execute(sql`drop function if exists cp057_fail_return_update()`);
  await db.execute(sql`drop trigger if exists cp058_wait_external_insert on shipments`);
  await db.execute(sql`drop function if exists cp058_wait_external_insert()`);
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
  voidProviderCalls = 0;
  voidProviderReadbacks = 0;
  voidProviderMode = 'success';
  voidProviderGate = null;
  providerMode = 'success';
  customerRateMode = 'ready';
  providerStarted = null;
  providerRelease = null;
  customerMoneyFreezeGate = null;
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

function externalDecision() {
  const decision = externalTrackingService.resolveReturnExternalTracking({
    return: { status: 'requested', returnShipmentId: null },
    trackingNumber: '1ZCP058EXTERNAL0001',
    amountPaid: '6.58',
  });
  if (decision.kind !== 'accept') throw new Error('CP-058 external fixture was rejected');
  return decision;
}

function assignExternal(fixture: Awaited<ReturnType<typeof seed>>) {
  return externalTrackingApply.applyReturnExternalTracking({
    returnId: fixture.returnId,
    orderId: fixture.orderId,
    clientId: fixture.clientId,
    orderNumber: 'CP057-ORDER',
    decision: externalDecision(),
    actorEmail: 'cp058@example.test',
    actorType: 'client',
  });
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

async function externalVsExternalScenario(): Promise<void> {
  console.log('\nCP-057/058 Group 2 - concurrent external assignments');
  await reset();
  const fixture = await seed();

  const outcomes = await Promise.allSettled([
    assignExternal(fixture),
    assignExternal(fixture),
  ]);

  equal(providerCalls, 0, 'external tracking never calls the provider');
  equal((await returnShipments(fixture.orderId)).length, 1, 'two external requests leave one shipment');
  equal(
    outcomes.filter((result) => result.status === 'fulfilled').length,
    1,
    'exactly one external request owns the slot',
  );
  const rejected = outcomes.find((result) => result.status === 'rejected');
  check(
    rejected?.status === 'rejected' &&
      rejected.reason instanceof labelSlotService.ReturnLabelAssignmentConflictError &&
      rejected.reason.code === 'label_assignment_in_progress',
    'the losing external request receives label_assignment_in_progress',
  );
}

async function purchaseWinsExternalRaceScenario(): Promise<void> {
  console.log('\nCP-057/058 Group 3 - purchase intent wins the external race');
  await reset();
  const fixture = await seed();
  let releaseProvider!: () => void;
  let signalStarted!: () => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  providerStarted = signalStarted;
  providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve; });

  const purchase = create(fixture);
  await started;
  const external = await assignExternal(fixture).then(
    () => null,
    (error) => error,
  );
  releaseProvider();
  const purchased = await purchase;

  check(
    external instanceof labelSlotService.ReturnLabelAssignmentConflictError &&
      external.code === 'label_assignment_in_progress',
    'external tracking loses with label_assignment_in_progress after intent ownership',
  );
  equal(providerCalls, 1, 'the winning purchase makes exactly one provider call');
  const rows = await returnShipments(fixture.orderId);
  equal(rows.length, 1, 'purchase-win race leaves one canonical shipment');
  equal(rows[0]?.source, 'prepship_return_v2', 'the purchased shipment remains canonical');
  equal(purchased.returnShipmentId, rows[0]?.id, 'the return links the purchased shipment');
}

async function waitForExternalInsertGate(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await db.execute<{ waiting: number }>(sql`
      select count(*)::int as waiting
      from pg_locks
      where locktype = 'advisory'
        and classid = 57
        and objid = 58
        and granted = false
    `);
    if (Number(row?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('CP-058 external assignment never reached its transaction gate');
}

async function externalWinsPurchaseRaceScenario(): Promise<void> {
  console.log('\nCP-057/058 Group 4 - external assignment wins the purchase race');
  await reset();
  const fixture = await seed();
  const gateClient = postgres(process.env.TEST_DATABASE_URL!, {
    max: 1,
    prepare: false,
    connection: { application_name: 'cp058-external-winner-gate' },
  });

  let external: Promise<{ returnShipmentId: number }> | null = null;
  let purchase: ReturnType<typeof create> | null = null;
  try {
    await gateClient`select pg_advisory_lock(57, 58)`;
    await db.execute(sql`
      create function cp058_wait_external_insert() returns trigger language plpgsql as $$
      begin
        if new.source = 'external_return_label' then
          perform pg_advisory_xact_lock(57, 58);
        end if;
        return new;
      end $$
    `);
    await db.execute(sql`
      create trigger cp058_wait_external_insert before insert on shipments
      for each row execute function cp058_wait_external_insert()
    `);

    // The external transaction locks the return row, then waits in the insert
    // trigger. Starting the purchase now makes it queue behind that exact lock.
    external = assignExternal(fixture);
    await waitForExternalInsertGate();
    purchase = create(fixture);
    await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    await gateClient`select pg_advisory_unlock(57, 58)`;
    await gateClient.end({ timeout: 5 });
  }

  const [externalOutcome, purchaseOutcome] = await Promise.allSettled([
    external!,
    purchase!,
  ]);
  check(externalOutcome.status === 'fulfilled', 'the external assignment commits first');
  check(
    purchaseOutcome.status === 'rejected' &&
      purchaseOutcome.reason instanceof labelSlotService.ReturnLabelAssignmentConflictError &&
      purchaseOutcome.reason.code === 'label_assignment_in_progress',
    'the losing purchase receives label_assignment_in_progress',
  );
  equal(providerCalls, 0, 'external-win race reaches no provider call');
  const rows = await returnShipments(fixture.orderId);
  equal(rows.length, 1, 'external-win race leaves one canonical shipment');
  equal(rows[0]?.source, 'external_return_label', 'the external shipment remains canonical');
  const [returnRow] = await db.select().from(schema.returns).where(eq(schema.returns.id, fixture.returnId));
  equal(returnRow?.returnShipmentId, rows[0]?.id, 'the return links only the external shipment');
}

async function persistedPurchaseWindowVoidScenario(): Promise<void> {
  console.log('\nCP-057 Group 4B - persisted in-flight purchase blocks void');
  await reset();
  const fixture = await seed();
  let persistedShipmentId = 0;
  let signalPersisted!: () => void;
  let releaseFreeze!: () => void;
  const persisted = new Promise<void>((resolve) => { signalPersisted = resolve; });
  const freezeRelease = new Promise<void>((resolve) => { releaseFreeze = resolve; });
  customerMoneyFreezeGate = async (shipmentId) => {
    persistedShipmentId = shipmentId;
    signalPersisted();
    await freezeRelease;
  };

  const purchase = create(fixture);
  await persisted;
  const [inFlightIntent] = await db.select().from(schema.returnLabelPurchaseIntents);
  const [unlinkedReturn] = await db
    .select({ shipmentId: schema.returns.returnShipmentId })
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.returnId));
  equal(inFlightIntent?.state, 'purchased', 'the fixture pauses after shipment persistence');
  equal(inFlightIntent?.returnShipmentId, null, 'the purchased intent is not linked yet');
  equal(unlinkedReturn?.shipmentId, null, 'the return workflow is not linked yet');

  const blockedVoid = await labelsService.voidLabelV2(persistedShipmentId).then(
    () => null,
    (error) => error,
  );
  check(
    blockedVoid instanceof Error && blockedVoid.message === 'Return label purchase is still in progress',
    'the provider-key fallback rejects voiding the in-flight purchased intent',
  );
  equal(voidProviderCalls, 0, 'an in-flight purchase is rejected before any provider void call');
  const [unchangedShipment] = await db
    .select({ voided: schema.shipments.voided })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, persistedShipmentId));
  const [unchangedOrder] = await db
    .select({ status: schema.orders.orderStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, fixture.orderId));
  equal(unchangedShipment?.voided, false, 'blocked in-flight void leaves the shipment active');
  equal(unchangedOrder?.status, 'shipped', 'blocked in-flight void leaves order workflow unchanged');

  releaseFreeze();
  const completed = await purchase;
  const [completedIntent] = await db.select().from(schema.returnLabelPurchaseIntents);
  const [linkedReturn] = await db
    .select({ shipmentId: schema.returns.returnShipmentId })
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.returnId));
  equal(completed.returnShipmentId, persistedShipmentId, 'the original purchase completes safely');
  equal(completedIntent?.state, 'completed', 'the in-flight intent reaches completed');
  equal(completedIntent?.returnShipmentId, persistedShipmentId, 'the completed intent links its shipment');
  equal(linkedReturn?.shipmentId, persistedShipmentId, 'the return links the active purchased label');
}

async function voidedSlotReplacementScenario(): Promise<void> {
  console.log('\nCP-057/058 Group 5 - voided label releases the canonical slot');
  await reset();
  const purchaseFixture = await seed();
  const original = await create(purchaseFixture);
  const [completedIntent] = await db.select().from(schema.returnLabelPurchaseIntents);
  equal(completedIntent?.state, 'completed', 'the purchased return starts with a completed intent');

  const voided = await labelsService.voidLabelV2(original.returnShipmentId!);
  check(voided.voided, 'the real voidLabelV2 path reports the label voided');
  equal(voidProviderCalls, 1, 'the real void path makes one mocked provider call');
  const [voidedIntent] = await db.select().from(schema.returnLabelPurchaseIntents);
  equal(voidedIntent?.state, 'voided', 'the real void path releases the completed intent');
  const [awaitingOrder] = await db
    .select({ status: schema.orders.orderStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, purchaseFixture.orderId));
  equal(awaitingOrder?.status, 'awaiting_shipment', 'the real void path resets the order workflow');

  const replacement = await create(purchaseFixture);
  equal(providerCalls, 2, 'a voided purchased label permits exactly one replacement purchase');
  check(
    replacement.returnShipmentId !== original.returnShipmentId,
    'replacement purchase links a new canonical shipment',
  );
  const [purchaseReturn] = await db
    .select()
    .from(schema.returns)
    .where(eq(schema.returns.id, purchaseFixture.returnId));
  equal(
    purchaseReturn?.returnShipmentId,
    replacement.returnShipmentId,
    'the voided historical link is conditionally replaced',
  );
  const replacementRetry = await create(purchaseFixture);
  equal(providerCalls, 2, 'retrying after replacement cannot purchase a second replacement');
  equal(
    replacementRetry.returnShipmentId,
    replacement.returnShipmentId,
    'the replacement retry returns the one canonical active label',
  );

  await reset();
  const externalFixture = await seed();
  const firstExternal = await assignExternal(externalFixture);
  await db
    .update(schema.shipments)
    .set({ voided: true, updatedAt: new Date() })
    .where(eq(schema.shipments.id, firstExternal.returnShipmentId));
  const secondExternal = await assignExternal(externalFixture);
  check(
    secondExternal.returnShipmentId !== firstExternal.returnShipmentId,
    'external tracking can replace a voided link when workflow status is labelable',
  );
  const [externalReturn] = await db
    .select()
    .from(schema.returns)
    .where(eq(schema.returns.id, externalFixture.returnId));
  equal(
    externalReturn?.returnShipmentId,
    secondExternal.returnShipmentId,
    'the new external shipment owns the released slot',
  );
  equal(providerCalls, 0, 'void-to-external replacement calls no provider');
}

async function voidFinalizationRollbackScenario(): Promise<void> {
  console.log('\nCP-057 Group 5A - post-provider local void finalization is atomic');
  await reset();
  const fixture = await seed();
  const original = await create(fixture);

  await db.execute(sql`
    create function cp057_fail_void_intent_update() returns trigger language plpgsql as $$
    begin
      if old.state = 'completed' and new.state = 'voided' then
        raise exception 'CP-057 forced intent finalization failure';
      end if;
      return new;
    end $$
  `);
  await db.execute(sql`
    create trigger cp057_fail_void_intent_update before update on return_label_purchase_intents
    for each row execute function cp057_fail_void_intent_update()
  `);

  const failedVoid = await labelsService.voidLabelV2(original.returnShipmentId!).then(
    () => null,
    (error) => error,
  );
  check(failedVoid instanceof Error, 'an injected intent failure rejects local void finalization');
  equal(voidProviderCalls, 1, 'the failed local finalization still follows one mocked provider success');

  const [rolledBackShipment] = await db
    .select({ voided: schema.shipments.voided })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, original.returnShipmentId!));
  const [preservedIntent] = await db.select().from(schema.returnLabelPurchaseIntents);
  const [preservedOrder] = await db
    .select({ status: schema.orders.orderStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, fixture.orderId));
  equal(rolledBackShipment?.voided, false, 'intent failure rolls back shipments.voided');
  equal(preservedIntent?.state, 'completed', 'intent failure preserves the completed intent');
  equal(preservedOrder?.status, 'shipped', 'intent failure rolls back the order workflow reset');

  await db.execute(sql`drop trigger cp057_fail_void_intent_update on return_label_purchase_intents`);
  await db.execute(sql`drop function cp057_fail_void_intent_update()`);

  voidProviderMode = 'already_voided';
  await labelsService.voidLabelV2(original.returnShipmentId!);
  const [recoveredShipment] = await db
    .select({ voided: schema.shipments.voided })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, original.returnShipmentId!));
  const [releasedIntent] = await db.select().from(schema.returnLabelPurchaseIntents);
  equal(recoveredShipment?.voided, true, 'a retry atomically records the confirmed provider void');
  equal(releasedIntent?.state, 'voided', 'the retry releases the intent for replacement');
  equal(voidProviderCalls, 2, 'recovery retries the provider void once');
  equal(voidProviderReadbacks, 1, 'already-voided retry is accepted only after provider readback');

  const replacement = await create(fixture);
  const replacementRetry = await create(fixture);
  equal(providerCalls, 2, 'recovery permits exactly one replacement provider purchase');
  equal(
    replacementRetry.returnShipmentId,
    replacement.returnShipmentId,
    'recovery retry returns the same replacement shipment',
  );
}

async function voidIntentStateMismatchScenario(): Promise<void> {
  console.log('\nCP-057 Group 5B - active intent mismatch aborts local void finalization');
  await reset();
  const fixture = await seed();
  const original = await create(fixture);
  await db
    .update(schema.returnLabelPurchaseIntents)
    .set({
      state: 'purchasing',
      leaseToken: 'cp057-active-void-mismatch',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    });

  const mismatch = await labelsService.voidLabelV2(original.returnShipmentId!).then(
    () => null,
    (error) => error,
  );
  check(mismatch instanceof Error, 'a non-completed existing intent rejects finalization');
  const [shipment] = await db
    .select({ voided: schema.shipments.voided })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, original.returnShipmentId!));
  const [intent] = await db.select().from(schema.returnLabelPurchaseIntents);
  const [order] = await db
    .select({ status: schema.orders.orderStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, fixture.orderId));
  equal(shipment?.voided, false, 'intent-state mismatch rolls back shipments.voided');
  equal(intent?.state, 'purchasing', 'intent-state mismatch preserves the active intent');
  equal(order?.status, 'shipped', 'intent-state mismatch rolls back the order workflow reset');
}

async function staleVoidFinalizerScenario(): Promise<void> {
  console.log('\nCP-057 Group 5C - stale concurrent void finalizer cannot clobber replacement');
  await reset();
  const fixture = await seed();
  const original = await create(fixture);

  let firstStarted!: () => void;
  let secondStarted!: () => void;
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const firstAtProvider = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondAtProvider = new Promise<void>((resolve) => { secondStarted = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const secondRelease = new Promise<void>((resolve) => { releaseSecond = resolve; });
  voidProviderGate = async (call) => {
    if (call === 1) {
      firstStarted();
      await firstRelease;
    } else if (call === 2) {
      secondStarted();
      await secondRelease;
    }
  };

  const firstVoid = labelsService.voidLabelV2(original.returnShipmentId!);
  await firstAtProvider;
  const staleVoid = labelsService.voidLabelV2(original.returnShipmentId!);
  await secondAtProvider;
  releaseFirst();
  await firstVoid;

  const replacement = await create(fixture);
  await db
    .update(schema.orders)
    .set({ orderStatus: 'shipped', updatedAt: new Date() })
    .where(eq(schema.orders.id, fixture.orderId));
  releaseSecond();
  const staleOutcome = await staleVoid.then(
    () => null,
    (error) => error,
  );
  check(
    staleOutcome instanceof Error && staleOutcome.message === 'Label already voided',
    'the delayed finalizer loses after the first void commits',
  );

  const [returnRow] = await db
    .select({ shipmentId: schema.returns.returnShipmentId })
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.returnId));
  const [intent] = await db.select().from(schema.returnLabelPurchaseIntents);
  const [order] = await db
    .select({ status: schema.orders.orderStatus })
    .from(schema.orders)
    .where(eq(schema.orders.id, fixture.orderId));
  equal(returnRow?.shipmentId, replacement.returnShipmentId, 'the delayed finalizer preserves the replacement link');
  equal(intent?.returnShipmentId, replacement.returnShipmentId, 'the delayed finalizer preserves replacement intent ownership');
  equal(intent?.state, 'completed', 'the delayed finalizer preserves the completed replacement intent');
  equal(order?.status, 'shipped', 'the delayed finalizer cannot reset newer order workflow state');
}

async function externalPdfOwnershipScenario(): Promise<void> {
  console.log('\nCP-057/058 Group 5D - external PDF ownership follows the linked shipment');
  await reset();
  const fixture = await seed();
  const first = await assignExternal(fixture);
  const firstPath = `returns/${fixture.returnId}/external-label/first.pdf`;
  await externalTrackingApply.attachReturnExternalLabelPdf({
    returnId: fixture.returnId,
    expectedShipmentId: first.returnShipmentId,
    objectPath: firstPath,
  });

  const [attached] = await db
    .select({ labelUrl: schema.shipments.labelUrl })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, first.returnShipmentId));
  equal(attached?.labelUrl, firstPath, 'the linked external shipment accepts its PDF path');

  await db
    .update(schema.shipments)
    .set({ voided: true, updatedAt: new Date() })
    .where(eq(schema.shipments.id, first.returnShipmentId));
  const replacement = await assignExternal(fixture);

  const lostOwnership = await externalTrackingApply.attachReturnExternalLabelPdf({
    returnId: fixture.returnId,
    expectedShipmentId: first.returnShipmentId,
    objectPath: `returns/${fixture.returnId}/external-label/stale.pdf`,
  }).then(
    () => null,
    (error) => error,
  );
  check(
    lostOwnership instanceof labelSlotService.ReturnLabelAssignmentConflictError,
    'a PDF request for the replaced shipment loses with the assignment conflict',
  );

  const [oldShipment] = await db
    .select({ labelUrl: schema.shipments.labelUrl })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, first.returnShipmentId));
  const [newShipment] = await db
    .select({ labelUrl: schema.shipments.labelUrl })
    .from(schema.shipments)
    .where(eq(schema.shipments.id, replacement.returnShipmentId));
  equal(oldShipment?.labelUrl, firstPath, 'a stale PDF request does not overwrite the old path');
  equal(newShipment?.labelUrl, null, 'a stale PDF request cannot write onto the new owner');
  equal(providerCalls, 0, 'external PDF ownership checks call no provider');
}

async function shipmentInsertRecoveryScenario(): Promise<void> {
  console.log('\nCP-057 Group 6 - provider success then shipment insert failure');
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
  console.log('\nCP-057 Group 7 - shipment success then return-row update failure');
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
  console.log('\nCP-057 Group 8 - timeout after submission');
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
  console.log('\nCP-057 Group 9 - provider absence remains held');
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
  check(result.returnShipmentId != null && result.returnShipmentId > 0, 'operator-authorized retry returns the canonical shipment');
}

async function offlineGatesScenario(): Promise<void> {
  console.log('\nCP-057 Group 10 - live purchase gates and redaction');
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
  await externalVsExternalScenario();
  await purchaseWinsExternalRaceScenario();
  await externalWinsPurchaseRaceScenario();
  await persistedPurchaseWindowVoidScenario();
  await voidedSlotReplacementScenario();
  await voidFinalizationRollbackScenario();
  await voidIntentStateMismatchScenario();
  await staleVoidFinalizerScenario();
  await externalPdfOwnershipScenario();
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
