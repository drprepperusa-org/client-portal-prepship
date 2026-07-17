/* CP-043 behavioral integration suite.
 *
 * Runs the real return-label service against a throwaway Postgres. ShipStation
 * HTTP and label purchase calls are replaced with in-memory fixtures, so no
 * provider, postage, real label, or production data can be touched.
 */
import { and, eq, sql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();
process.env.RETURNS_LIVE_LABELS = 'true';
process.env.SHIPSTATION_API_KEY_V2 = 'cp043-test-key';
process.env.PREPSHIP_API_URL = 'https://prepship.example.test';

type RateMode = 'empty' | 'success';

let rateMode: RateMode = 'empty';
let customerRateMode: 'ready' | 'unavailable' = 'ready';
let estimateCalls = 0;
let providerCalls = 0;
let customerRatePreviewCalls = 0;
const originalFetch = globalThis.fetch;

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === 'https://prepship.example.test/client-portal/customer-shipping-money/return-preview') {
    customerRatePreviewCalls += 1;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    equal(body.selectedRateCost, 6.4, 'preflight sends the selected provider total server-to-server');
    if (customerRateMode === 'unavailable') {
      return new Response(JSON.stringify({ error: 'Customer return shipping rate is not configured' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return jsonResponse({
      data: {
        cShippingRateAmount: 7.73,
        customerRateSource: 'hugrab_shipping_rate_override',
        customerShippingMoneyPolicyVersion: 'ps-437-v1',
      },
    });
  }
  if (url === 'https://prepship.example.test/client-portal/customer-shipping-money/freeze') {
    return jsonResponse({
      data: {
        cShippingRateAmount: 7.73,
        customerRateSource: 'hugrab_shipping_rate_override',
        customerShippingMoneyPolicyVersion: 'ps-437-v1',
      },
    });
  }
  if (url === 'https://api.shipstation.com/v2/carriers') {
    return jsonResponse({
      carriers: [
        {
          carrier_id: 'cp043-carrier',
          carrier_code: 'ups',
          nickname: 'CP-043 fixture carrier',
          disabled_by_billing_plan: false,
        },
      ],
    });
  }
  if (url === 'https://api.shipstation.com/v2/rates/estimate') {
    estimateCalls += 1;
    if (rateMode === 'empty') return jsonResponse([]);
    return jsonResponse([
      {
        rate_id: 'cp043-rate',
        carrier_id: 'cp043-carrier',
        carrier_code: 'ups',
        service_code: 'ups_ground',
        service_type: 'UPS Ground',
        package_type: 'package',
        shipping_amount: { currency: 'usd', amount: 6.4 },
        delivery_days: 3,
      },
    ]);
  }
  throw new Error(`CP-043 integration blocked unexpected network request: ${url}`);
}) as typeof fetch;

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const returnsService = await import('../../src/services/returns');
const { carrierConnectors } = await import('../../src/connectors/registry');

const originalCreateLabel = carrierConnectors.shipstation.createLabel;
carrierConnectors.shipstation.createLabel = async (input) => {
  providerCalls += 1;
  if (input.carrierId !== 'cp043-carrier' || input.serviceCode !== 'ups_ground') {
    throw new Error('CP-043 service did not purchase the backend-selected quote');
  }
  return {
    labelId: 'cp043-label',
    shipmentId: 43_001,
    trackingNumber: '1ZCP04300000000001',
    labelUrl: 'https://labels.example.test/cp043.pdf',
    labelFormat: 'pdf',
    cost: 6.4,
    voided: false,
    carrierCode: 'ups',
    serviceCode: 'ups_ground',
    shipDate: '2026-07-14',
    providerAccountId: 43,
  };
};

let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    failures += 1;
  }
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message} (got ${String(actual)}, want ${String(expected)})`);
}

async function reset(): Promise<void> {
  await db.execute(sql`
    truncate table
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
}

async function seed(): Promise<{
  clientId: number;
  orderId: number;
  outboundShipmentId: number;
  returnId: number;
}> {
  const [client] = await db
    .insert(schema.clients)
    .values({ name: 'CP-043 Client', isTest: false })
    .returning();
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: 'CP043-ORDER',
      orderStatus: 'shipped',
      clientId: client!.id,
      shipToName: 'CP-043 Customer',
      shipToCity: 'Los Angeles',
      shipToState: 'CA',
      shipToPostalCode: '90001',
      raw: {
        shipTo: {
          name: 'CP-043 Customer',
          street1: '100 Test Street',
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
      trackingNumber: 'OUTBOUND-CP043',
      weightOz: 16,
      dimsL: 10,
      dimsW: 8,
      dimsH: 4,
      selectedPackageId: 'package',
      voided: false,
      isReturn: false,
      source: 'cp043_fixture',
    })
    .returning();
  const [returnRow] = await db
    .insert(schema.returns)
    .values({
      orderId: order!.id,
      clientId: client!.id,
      returnReference: 'CP043-ORDER-RETURN',
      status: 'requested',
      initiatedBy: 'client',
      initiatedByEmail: 'cp043@example.test',
      reason: 'CP-043 integration fixture',
    })
    .returning();
  return {
    clientId: client!.id,
    orderId: order!.id,
    outboundShipmentId: outbound!.id,
    returnId: returnRow!.id,
  };
}

async function main(): Promise<void> {
  await reset();
  const fixture = await seed();

  console.log('\nCP-043 Group 1 - no-rate recovery state');
  let rateError: unknown;
  try {
    await returnsService.createReturnLabel({
      returnId: fixture.returnId,
      orderId: fixture.orderId,
      actorType: 'client',
      actorEmail: 'cp043@example.test',
      authorization: 'Bearer cp043-fixture',
    });
  } catch (error) {
    rateError = error;
  }
  check(
    rateError instanceof returnsService.ReturnLabelRateUnavailableError,
    'no-rate response is a retryable return-label rate error',
  );
  if (rateError instanceof returnsService.ReturnLabelRateUnavailableError) {
    equal(rateError.diagnostics.failureKind, 'no_rates', 'no-rate failure is classified safely');
    equal(rateError.diagnostics.rawRateCount, 0, 'safe diagnostics record zero raw rates');
  }

  const [failedReturn] = await db
    .select()
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.returnId));
  equal(failedReturn?.status, 'label_failed', 'failure persists the recoverable workflow state');
  equal(
    failedReturn?.deliveryError,
    'No return rates were returned for this shipment',
    'failure persists client-safe copy',
  );
  equal(providerCalls, 0, 'no-rate path never calls the label provider');

  const returnRowsAfterFailure = await db
    .select()
    .from(schema.shipments)
    .where(
      and(
        eq(schema.shipments.orderId, fixture.orderId),
        eq(schema.shipments.isReturn, true),
      ),
    );
  equal(returnRowsAfterFailure.length, 0, 'no-rate path creates no return shipment');

  console.log('\nCP-043 Group 2 - customer pricing fails closed before postage');
  rateMode = 'success';
  customerRateMode = 'unavailable';
  let customerRateError: unknown;
  try {
    await returnsService.createReturnLabel({
      returnId: fixture.returnId,
      orderId: fixture.orderId,
      actorType: 'client',
      actorEmail: 'cp043@example.test',
      authorization: 'Bearer cp043-fixture',
    });
  } catch (error) {
    customerRateError = error;
  }
  check(
    customerRateError instanceof returnsService.ReturnCustomerRateUnavailableError,
    'missing customer pricing returns a safe retryable error',
  );
  equal(providerCalls, 0, 'missing customer pricing blocks the provider mutation');

  const failedPricingShipments = await db
    .select()
    .from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, fixture.orderId), eq(schema.shipments.isReturn, true)));
  equal(failedPricingShipments.length, 0, 'missing customer pricing persists no return shipment');

  console.log('\nCP-043 Group 3 - retry and canonical success persistence');
  customerRateMode = 'ready';
  const result = await returnsService.createReturnLabel({
    returnId: fixture.returnId,
    orderId: fixture.orderId,
    actorType: 'client',
    actorEmail: 'cp043@example.test',
    authorization: 'Bearer cp043-fixture',
  });
  equal(estimateCalls, 3, 'each retry forces a fresh live quote instead of stale cache data');
  equal(customerRatePreviewCalls, 2, 'customer pricing is checked before each purchase-capable attempt');
  equal(providerCalls, 1, 'successful retry purchases exactly once through the provider fixture');

  const [completedReturn] = await db
    .select()
    .from(schema.returns)
    .where(eq(schema.returns.id, fixture.returnId));
  equal(completedReturn?.status, 'label_created', 'successful retry advances the workflow');
  equal(
    completedReturn?.returnShipmentId,
    result.returnShipmentId,
    'workflow links the canonical return shipment returned to the client',
  );

  const [returnShipment] = await db
    .select()
    .from(schema.shipments)
    .where(eq(schema.shipments.id, result.returnShipmentId!));
  equal(returnShipment?.isReturn, true, 'canonical shipment is marked as a return');
  equal(
    returnShipment?.returnForShipmentId,
    fixture.outboundShipmentId,
    'canonical return shipment links the original outbound shipment',
  );
  equal(
    (returnShipment?.selectedRateJson as { rate_id?: string } | null)?.rate_id,
    'cp043-rate',
    'canonical shipment freezes the backend-selected quote',
  );
  equal(Number(returnShipment?.cost), 6.4, 'canonical shipment persists the provider cost');
  equal(result.returnCustomerShippingRate, 7.73, 'client price comes from backend return billing policy');
  check(!('carrierCode' in result), 'client result omits carrier identity');
  check(!('serviceCode' in result), 'client result omits service identity');
  check(!('selectedRateJson' in result), 'client result omits the selected quote');

  const activity = await db
    .select()
    .from(schema.returnActivityEvents)
    .where(eq(schema.returnActivityEvents.returnId, fixture.returnId));
  check(
    activity.some((event) => event.eventType === 'label_failed'),
    'failure activity is preserved',
  );
  check(
    activity.some((event) => event.eventType === 'label_created'),
    'success activity is preserved',
  );
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\n✓ CP-043 returns integration suite passed.\n'
      : `\n✗ ${failures} CP-043 assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\n✗ CP-043 integration suite errored:',
    error instanceof Error ? error.stack : error,
  );
} finally {
  carrierConnectors.shipstation.createLabel = originalCreateLabel;
  globalThis.fetch = originalFetch;
  try {
    await reset();
  } catch {
    /* best-effort cleanup in the throwaway database */
  }
  await pgClient.end({ timeout: 5 });
}

process.exit(exitCode);
