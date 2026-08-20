/* CP-060 per-shipment shipping classification proof.
 *
 * Runs the sku-orders read model against a throwaway Postgres and proves each
 * non-voided label's billed shipping lands in its own standard/expedited class,
 * with explicit money states for everything that cannot be attributed. No
 * network, no Supabase — pure read-model + fixtures.
 */
import { sql as rawSql } from 'drizzle-orm';
import { setupTestEnv } from './guard';

setupTestEnv();

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { getSkuOrdersForSku } = await import('../../src/services/sku-orders');

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

type SeedOrder = {
  clientId: number;
  sku?: string;
  qty?: number;
  status?: string;
  labels?: Array<{ service: string; voided?: boolean; billed?: number }>;
  orderGrainBilled?: number; // shipping line with shipment_id NULL (legacy)
};

let orderSeq = 0;

async function seedOrder(input: SeedOrder): Promise<number> {
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
        isReturn: false,
        source: 'cp060_fixture',
      })
      .returning();
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
  return order!.id;
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
console.log('\nScenario 5: label without billing is unbilled, never plausible money');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({ clientId, labels: [{ service: STD }] });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'unbilled', 'state unbilled');
  equal(row.shipping_total, null, 'total null');
  equal(row.shipping_standard, null, 'std null');
  equal(result.shipCountStandard, 0, 'unbilled order not in std count');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 6: legacy order-grain line (shipment_id NULL) stays classless');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({ clientId, labels: [{ service: EXP }], orderGrainBilled: 12 });
  const result = await run(clientId);
  const row = result.orders[0]!;
  equal(row.shipping_money_state, 'unattributed_legacy', 'state unattributed_legacy');
  money(row.shipping_total, 12, 'total shows the money');
  equal(row.shipping_standard, null, 'no class guessed');
  equal(row.shipping_expedited, null, 'no class guessed for exp either');
  equal(result.shipCountExpedited, 0, 'excluded from exp average');
  money(result.avgShippingExpedited, 0, 'exp average unaffected');
}

// ---------------------------------------------------------------------------
console.log('\nScenario 7: mixed attributed + legacy line is partial');
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
  equal(row.shipping_money_state, 'partial_unattributed', 'state partial_unattributed');
  money(row.shipping_total, 8, 'total covers attributed + legacy');
  money(row.shipping_standard, 5, 'std covers only the attributed part');
  equal(row.shipping_expedited, null, 'no exp money');
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
await pgClient.end({ timeout: 5 });

if (failures > 0) {
  console.error(`\n✖ CP-060 integration: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\n✓ CP-060 per-shipment shipping classification integration passed.');
process.exit(0);
