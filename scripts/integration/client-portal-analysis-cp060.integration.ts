/* CP-060 per-shipment shipping classification proof.
 *
 * Runs the sku-orders read model against a throwaway Postgres and proves each
 * eligible label's customer shipping money lands in its own standard/expedited
 * class, that the drawer total is the SAME canonical figure the order detail
 * Shipping row shows, and that money the canonical resolver does not recognise
 * is never counted. No network, no Supabase — pure read-model + fixtures.
 */
import { sql as rawSql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { getSkuOrdersForSku } = await import('../../src/services/sku-orders');
const { orderCustomerShippingRateSql } = await import(
  '../../src/lib/client-portal/customer-shipping-rate'
);

let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message} (got ${String(actual)}, want ${String(expected)})`);
}

function money(actual: string | null | undefined, expected: number, message: string): void {
  const got = actual === null || actual === undefined ? NaN : Number(actual);
  check(Math.abs(got - expected) < 0.005, `${message} (got ${String(actual)}, want ${expected})`);
}

async function reset(): Promise<void> {
  await db.execute(rawSql`
    truncate table
      billing_line_items,
      shipments,
      order_items,
      orders,
      clients
    restart identity cascade
  `);
}

const NOW = new Date();
const WINDOW = {
  dateFrom: new Date(NOW.getTime() - 7 * 86_400_000).toISOString(),
  dateTo: new Date(NOW.getTime() + 86_400_000).toISOString(),
};

/** A ps-508 outbound tuple the canonical resolver accepts as a frozen rate. */
function frozenRate(cost: number, customer: number) {
  return {
    selectedRateCost: cost,
    cShippingRateAmount: customer,
    shippingMarginAmount: Number((customer - cost).toFixed(2)),
    shippingMarginPct: null,
    customerRateSource: 'realized_customer_shipping_rate',
    rateCostSource: 'label_final_cost',
    customerShippingMoneyPolicyVersion: 'ps-508-v1',
  };
}

type SeedLabel = {
  service: string;
  voided?: boolean;
  isReturn?: boolean;
  billed?: number;
  /** PrepShip's frozen rate snapshot, used when no billing line exists yet. */
  frozen?: { cost: number; customer: number };
};

type SeedOrder = {
  clientId: number;
  sku?: string;
  qty?: number;
  status?: string;
  labels?: SeedLabel[];
  orderGrainBilled?: number; // shipping line with shipment_id NULL (legacy)
};

let orderSeq = 0;

async function seedOrder(input: SeedOrder) {
  orderSeq += 1;
  const sku = input.sku ?? 'CP060-SKU';
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: `CP060-${orderSeq}`,
      orderStatus: input.status ?? 'shipped',
      clientId: input.clientId,
      orderDate: NOW,
      shipToName: `Customer ${orderSeq}`,
    })
    .returning();
  await db.insert(schema.orderItems).values({
    orderId: order!.id,
    sku,
    name: `Item ${sku}`,
    quantity: String(input.qty ?? 1),
    unitPrice: '10.00',
    orderStatus: input.status ?? 'shipped',
    orderDate: NOW,
    clientId: input.clientId,
  });
  let lineSeq = 0;
  const shipmentIds: number[] = [];
  for (const label of input.labels ?? []) {
    const [shipment] = await db
      .insert(schema.shipments)
      .values({
        orderId: order!.id,
        clientId: input.clientId,
        orderNumber: order!.orderNumber,
        trackingNumber: `CP060-TRACK-${orderSeq}-${lineSeq}`,
        serviceCode: label.service,
        voided: label.voided ?? false,
        isReturn: label.isReturn ?? false,
        source: 'cp060_fixture',
        ...(label.frozen
          ? { selectedRateJson: frozenRate(label.frozen.cost, label.frozen.customer) }
          : {}),
      })
      .returning();
    shipmentIds.push(shipment!.id);
    if (label.billed !== undefined) {
      lineSeq += 1;
      await db.insert(schema.billingLineItems).values({
        clientId: input.clientId,
        orderId: order!.id,
        orderNumber: order!.orderNumber,
        shipmentId: shipment!.id,
        lineType: 'shipping',
        description: `Shipping ${orderSeq}-${lineSeq}`,
        qty: '1',
        unitCost: label.billed.toFixed(2),
        totalCost: label.billed.toFixed(2),
      });
    }
  }
  if (input.orderGrainBilled !== undefined) {
    await db.insert(schema.billingLineItems).values({
      clientId: input.clientId,
      orderId: order!.id,
      orderNumber: order!.orderNumber,
      shipmentId: null,
      lineType: 'shipping',
      description: `Legacy shipping ${orderSeq}`,
      qty: '1',
      unitCost: input.orderGrainBilled.toFixed(2),
      totalCost: input.orderGrainBilled.toFixed(2),
    });
  }
  return { orderId: order!.id, orderNumber: order!.orderNumber, shipmentIds };
}

async function seedClient(name: string): Promise<number> {
  const [client] = await db
    .insert(schema.clients)
    .values({ name, isTest: false })
    .returning();
  return client!.id;
}

function run(clientId?: number) {
  return getSkuOrdersForSku({
    sku: 'CP060-SKU',
    canViewFinancials: true,
    shippingBasis: 'customer_billed',
    orderScopeSql: clientId === undefined ? undefined : rawSql`o.client_id = ${clientId}`,
    ...WINDOW,
  });
}

const STD = 'usps_priority_mail';
const EXP = 'ups_next_day_air';

// ---------------------------------------------------------------------------
console.log('\nScenario 1: mixed multi-label order splits per class');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, billed: 20 },
    ],
  });
  const result = await run(clientId);
  equal(result.orders.length, 1, 'one drawer row');
  const row = result.orders[0]!;
  money(row.shipping_total, 25, 'total covers both labels');
  money(row.shipping_standard, 5, 'standard money is the std label only');
  money(row.shipping_expedited, 20, 'expedited money is the exp label only');
  equal(row.shipping_money_state, 'attributed', 'state attributed');
  equal(result.shipCountStandard, 1, 'summary counts the order once for std');
  equal(result.shipCountExpedited, 1, 'summary counts the order once for exp');
  money(result.shippingStandardTotal, 5, 'summary std total');
  money(result.shippingExpeditedTotal, 20, 'summary exp total');
  money(result.avgShippingStandard, 5, 'std average uses only std dollars');
  money(result.avgShippingExpedited, 20, 'exp average uses only exp dollars');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 2: single-label std and exp orders keep correct totals');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({ clientId, labels: [{ service: STD, billed: 7 }] });
  await seedOrder({ clientId, labels: [{ service: EXP, billed: 30 }] });
  const result = await run(clientId);
  equal(result.orders.length, 2, 'two drawer rows');
  const byTotal = new Map(result.orders.map((o) => [Number(o.shipping_total), o]));
  const std = byTotal.get(7)!;
  const exp = byTotal.get(30)!;
  money(std.shipping_standard, 7, 'std order money classified std');
  equal(std.shipping_expedited, null, 'std order has no exp money');
  money(exp.shipping_expedited, 30, 'exp order money APPEARS (the old DTO hid it)');
  equal(exp.shipping_standard, null, 'exp order has no std money');
  money(result.avgShippingStandard, 7, 'std average');
  money(result.avgShippingExpedited, 30, 'exp average');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 3: voided newest label no longer classifies the order');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 6 },
      { service: EXP, voided: true }, // newest by id, voided, no money
    ],
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  money(row.shipping_total, 6, 'total is the surviving std money');
  money(row.shipping_standard, 6, 'money stays std');
  equal(row.shipping_expedited, null, 'voided exp label classifies nothing');
  equal(row.shipping_money_state, 'attributed', 'state attributed');
  equal(result.shipCountExpedited, 0, 'no exp order counted');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 4: external shipment (no shipment rows) is explicit');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({ clientId, status: 'shipped', labels: [] });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'external_label', 'state external_label');
  equal(row.shipping_total, null, 'no fabricated money');
  equal(row.is_external_shipped, true, 'external flag preserved');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 5: label with neither billing line nor frozen rate is pending');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({ clientId, labels: [{ service: STD }] });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'pending', 'state pending, not the false claim "unbilled"');
  equal(row.shipping_total, null, 'total null');
  equal(row.shipping_standard, null, 'std null');
  equal(result.shipCountStandard, 0, 'pending order not in std count');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 6: legacy order-grain line is not the customer shipping figure');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({ clientId, labels: [{ service: EXP }], orderGrainBilled: 12 });
  const result = await run(clientId);
  const row = result.orders[0]!;
  // A shipping line with no shipment is attached to no label, so the canonical
  // resolver does not see it and neither does the order detail Shipping row.
  // Presenting it here as the customer figure was the drift Hermes returned
  // this card for.
  equal(row.shipping_money_state, 'pending', 'state pending - the label has no resolved money');
  equal(row.shipping_total, null, 'the unattached line is NOT presented as the customer figure');
  equal(row.shipping_standard, null, 'no class guessed');
  equal(row.shipping_expedited, null, 'no class guessed for exp either');
  equal(result.shipCountExpedited, 0, 'excluded from exp average');
  money(result.avgShippingExpedited, 0, 'exp average unaffected');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 7: a legacy line alongside a billed label does not inflate the total');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [{ service: STD, billed: 5 }],
    orderGrainBilled: 3,
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'attributed', 'state attributed - nothing is unexplained');
  money(row.shipping_total, 5, 'total is the label money only, NOT label + unattached line');
  money(row.shipping_standard, 5, 'std carries the whole total');
  equal(row.shipping_expedited, null, 'no exp money');
  check(
    Math.abs(Number(row.shipping_total) - Number(row.shipping_standard ?? 0)) < 0.005,
    'total equals standard + expedited (structural, not coincidental)',
  );
  equal(result.shipCountStandard, 1, 'order counted for std');
  money(result.avgShippingStandard, 5, 'average uses the label money');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 8: tenant scope hides the other client');
await reset();
{
  const clientA = await seedClient('CP060 Client A');
  const clientB = await seedClient('CP060 Client B');
  await seedOrder({ clientId: clientA, labels: [{ service: STD, billed: 5 }] });
  await seedOrder({ clientId: clientB, labels: [{ service: EXP, billed: 50 }] });
  const result = await run(clientA);
  equal(result.orders.length, 1, 'only client A order visible');
  equal(result.shipCountExpedited, 0, "client B's expedited money invisible");
  money(result.avgShippingExpedited, 0, 'exp average untouched by client B');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 9: canViewFinancials=false redacts money, keeps state');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, billed: 20 },
    ],
  });
  const result = await getSkuOrdersForSku({
    sku: 'CP060-SKU',
    canViewFinancials: false,
    shippingBasis: 'customer_billed',
    orderScopeSql: rawSql`o.client_id = ${clientId}`,
    ...WINDOW,
  });
  const row = result.orders[0]!;
  equal(row.shipping_total, null, 'total redacted');
  equal(row.shipping_standard, null, 'std redacted');
  equal(row.shipping_expedited, null, 'exp redacted');
  equal(row.shipping_cost, null, 'per-unit redacted');
  equal(row.shipping_money_state, 'attributed', 'state survives redaction');
  equal(result.shippingStandardTotal, '0', 'summary std total zeroed');
  equal(result.avgShippingExpedited, '0', 'summary exp average zeroed');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 10: billed VOIDED label alongside an active one (the returned defect)');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // voidLabelV2 flips shipments.voided and deliberately leaves billing rows
  // alone, so a voided label keeps its shipping line. Pre-correction the drawer
  // summed that line into the order total, put it in NEITHER class, and still
  // reported 'attributed' - total 25 with std 5 shown beneath it.
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, voided: true, billed: 20 },
    ],
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  money(row.shipping_total, 5, 'voided label money is excluded from the total');
  money(row.shipping_standard, 5, 'std money unchanged');
  equal(row.shipping_expedited, null, 'the voided expedited label contributes nothing');
  equal(row.shipping_money_state, 'attributed', 'state attributed, and it is now true');
  equal(result.shipCountExpedited, 0, 'no expedited order counted');
  money(result.avgShippingExpedited, 0, 'expedited average untouched');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 11: shipping line pointing at a DIFFERENT order shipment');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  const mine = await seedOrder({ clientId, labels: [{ service: STD, billed: 5 }] });
  const other = await seedOrder({ clientId, sku: 'CP060-OTHER', labels: [{ service: EXP, billed: 99 }] });
  // No constraint ties billing_line_items.shipment_id to the line own order,
  // so this row is schema-legal: it belongs to my order but points at another
  // order label.
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: mine.orderId,
    orderNumber: mine.orderNumber,
    shipmentId: other.shipmentIds[0]!,
    lineType: 'shipping',
    description: 'Foreign-linked shipping',
    qty: '1',
    unitCost: '99.00',
    totalCost: '99.00',
  });
  const result = await run(clientId);
  const row = result.orders.find((o) => o.order_id === mine.orderId)!;
  money(row.shipping_total, 5, 'the foreign-linked 99.00 never enters my total');
  money(row.shipping_standard, 5, 'std money unchanged');
  equal(row.shipping_expedited, null, 'a different order expedited label classifies nothing here');
  equal(row.shipping_money_state, 'attributed', 'state attributed');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 12: a credit against a label reduces it; total = std + exp holds');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  const seeded = await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 30 },
      { service: EXP, billed: 20 },
    ],
  });
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: seeded.orderId,
    orderNumber: seeded.orderNumber,
    shipmentId: seeded.shipmentIds[0]!,
    lineType: 'shipping',
    description: 'Shipping credit',
    qty: '1',
    unitCost: '-10.00',
    totalCost: '-10.00',
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  money(row.shipping_total, 40, 'credit applies to the label it was issued against');
  money(row.shipping_standard, 20, 'std nets the credit');
  money(row.shipping_expedited, 20, 'exp untouched');
  check(
    Math.abs(
      Number(row.shipping_total) -
        (Number(row.shipping_standard ?? 0) + Number(row.shipping_expedited ?? 0)),
    ) < 0.005,
    'total = standard + expedited even with a credit present',
  );
  equal(row.shipping_money_state, 'attributed', 'state attributed');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 13: drawer total equals the order-detail Shipping figure');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // Every awkward shape at once: an active billed label, a billed voided label,
  // an unattached legacy line, and a return label with its own shipping row.
  const seeded = await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, voided: true, billed: 20 },
      { service: STD, isReturn: true, billed: 7 },
    ],
    orderGrainBilled: 3,
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  const [canonical] = await db.execute<{ v: string | null }>(rawSql`
    select (${orderCustomerShippingRateSql()})::text as v
    from ${schema.orders}
    where ${schema.orders.id} = ${seeded.orderId}
  `);
  // The drawer allocates the order figure across the SKU units; this order has
  // a single unit of a single SKU, so the two must match to the cent.
  money(row.shipping_total, Number(canonical!.v), 'drawer total == canonical order shipping rate');
  money(row.shipping_total, 5, 'and that figure is the eligible label only');
  equal(row.shipping_expedited, null, 'voided expedited label excluded');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 14: an eligible label with only a frozen rate is attributed, not pending');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // The normal window: label bought, PrepShip Admin has not generated billing
  // lines yet. The Orders surface already renders the frozen snapshot here, so
  // the drawer must not call this order unbilled.
  await seedOrder({ clientId, labels: [{ service: EXP, frozen: { cost: 6.2, customer: 7.73 } }] });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'attributed', 'frozen snapshot is a resolved answer');
  money(row.shipping_total, 7.73, 'total is the frozen customer amount');
  money(row.shipping_expedited, 7.73, 'classified by the label own service');
  equal(row.shipping_standard, null, 'no std money');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 15: a return label never contributes outbound shipping money');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, isReturn: true, billed: 40 },
    ],
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  money(row.shipping_total, 5, 'return label money is not outbound shipping');
  equal(row.shipping_expedited, null, 'return label classifies nothing');
  equal(result.shipCountExpedited, 0, 'no expedited order counted');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 16: a return-only order is not reported as a voided label');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // Shipped outside PrepShip, with only a return label recorded against it.
  // active_label_count and has_any_shipment must agree about which shipments
  // count, or this order claims a label was voided when none ever was.
  await seedOrder({
    clientId,
    status: 'shipped',
    labels: [{ service: STD, isReturn: true, billed: 9 }],
  });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'external_label', 'state external_label, not voided_only');
  equal(row.shipping_total, null, 'return postage is not outbound shipping money');
}

// ---------------------------------------------------------------------------
await pgClient.end({ timeout: 5 });

if (failures > 0) {
  console.error(`\n✖ CP-060 integration: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\n✓ CP-060 per-shipment shipping classification integration passed.');
process.exit(0);
