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
const { getSkuBreakdownFromOrderItems } = await import('../../src/routes/analysis');
const { projectDashboardTopSkus } = await import(
  '../../src/lib/client-portal/read-models/dashboard'
);

/** The Analysis TABLE owner, on the basis the client portal and Dashboard use. */
function runTable(clientId: number) {
  return getSkuBreakdownFromOrderItems({
    dateFrom: WINDOW.dateFrom,
    dateTo: WINDOW.dateTo,
    clientId,
    limit: 50,
    canViewFinancials: true,
    shippingBasis: 'customer_billed',
    includeCancelled: false,
    hideTestOrders: false,
    includeOrderCombinations: false,
  } as never) as Promise<{ rows: Array<Record<string, unknown>> }>;
}

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
  // A shipping line with no shipment is attached to no label, so the canonical
  // resolver cannot classify it - but Billing still charges it, so it must be
  // disclosed rather than silently dropped.
  equal(row.shipping_money_state, 'billing_mismatch', 'unattached invoiced money is disclosed');
  money(row.shipping_total, 12, 'the row shows the invoiced amount');
  equal(row.shipping_reconciled, null, 'nothing was attributable to a label');
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
  equal(row.shipping_money_state, 'billing_mismatch', 'the extra invoiced 3.00 is disclosed');
  money(row.shipping_total, 8, 'the row shows the full invoiced amount');
  money(row.shipping_reconciled, 5, 'of which 5.00 is attributable to the label');
  equal(row.shipping_standard, null, 'no class split while money is unattributable');
  equal(result.shipCountStandard, 0, 'mismatch rows stay out of the counts');
  money(result.avgShippingStandard, 0, 'and out of the averages');
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
  // The $20 on the voided label is STILL INVOICED - invoice-details.ts and
  // billing-summaries.ts sum every 'shipping' line by order_id. Reporting $5 and
  // calling it 'attributed' would hide charged money behind a clean state.
  equal(row.shipping_money_state, 'billing_mismatch', 'state billing_mismatch, not a clean attributed');
  money(row.shipping_total, 25, 'the row shows what Billing charges');
  money(row.shipping_reconciled, 5, 'and what the eligible labels actually account for');
  equal(row.shipping_standard, null, 'unattributable money gets no class');
  equal(row.shipping_expedited, null, 'and no expedited class either');
  equal(result.shipCountStandard, 0, 'mismatch row excluded from the std count');
  equal(result.shipCountExpedited, 0, 'and from the exp count');
  money(result.avgShippingStandard, 0, 'and from the averages');
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
  // The line belongs to MY order (b.order_id = mine) but points at another
  // order's shipment. Billing charges it to me; the labels cannot account for it.
  equal(row.shipping_money_state, 'billing_mismatch', 'foreign-linked money is disclosed, not dropped');
  money(row.shipping_total, 104, 'the row shows the invoiced 5.00 + 99.00');
  money(row.shipping_reconciled, 5, 'only 5.00 is attributable to my eligible labels');
  equal(row.shipping_standard, null, 'no class is guessed for the unattributable part');
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
  // This order has a single unit of a single SKU, so the SKU's allocation IS the
  // whole order figure. That is the only case where row-level equality holds -
  // Scenario 17 covers the multi-SKU case where it does not.
  money(row.shipping_reconciled, Number(canonical!.v), 'reconciled figure == canonical order shipping rate');
  money(row.shipping_reconciled, 5, 'and that figure is the eligible label only');
  equal(row.shipping_money_state, 'billing_mismatch', 'the voided and unattached lines are invoiced, so disclosed');
  money(row.shipping_total, 35, 'the invoiced sum is 5 + 20 voided + 3 unattached + 7 return-linked');
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
  money(row.shipping_reconciled, 5, 'only the outbound label is attributable');
  equal(row.shipping_money_state, 'billing_mismatch', 'the return-linked shipping line is invoiced, so disclosed');
  money(row.shipping_total, 45, 'the row shows the invoiced 5 + 40');
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
  // The order still has an invoiced 'shipping' line, so the mismatch state wins
  // over the shipment-shape state - the customer is charged and must see it.
  equal(row.shipping_money_state, 'billing_mismatch', 'charged money outranks the shape caption');
  money(row.shipping_total, 9, 'the invoiced amount is shown');
  equal(row.shipping_reconciled, null, 'no eligible outbound label to attribute it to');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 17: multi-SKU order - rows are allocations that RECONCILE, not copies');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // Hermes CP-060 return: the drawer row was documented as equal to the
  // order-detail Shipping row. That is only true when the SKU owns every unit.
  // Order: SKU A x1, SKU B x2, one std label billed 12.00.
  const seeded = await seedOrder({
    clientId,
    sku: 'CP060-SKU',
    qty: 1,
    labels: [{ service: STD, billed: 12 }],
  });
  await db.insert(schema.orderItems).values({
    orderId: seeded.orderId,
    // line_index defaults to 0 and (order_id, line_index) is unique, so a second
    // item on the same order needs its own index.
    lineIndex: 1,
    sku: 'CP060-SKU-B',
    name: 'Item CP060-SKU-B',
    quantity: '2',
    unitPrice: '10.00',
    orderStatus: 'shipped',
    orderDate: NOW,
    clientId,
  });

  const [canonical] = await db.execute<{ v: string | null }>(rawSql`
    select (${orderCustomerShippingRateSql()})::text as v
    from ${schema.orders}
    where ${schema.orders.id} = ${seeded.orderId}
  `);
  money(canonical!.v as unknown as string, 12, 'canonical order shipping is 12.00');

  const aRow = (await run(clientId)).orders[0]!;
  const bResult = await getSkuOrdersForSku({
    sku: 'CP060-SKU-B',
    canViewFinancials: true,
    shippingBasis: 'customer_billed',
    orderScopeSql: rawSql`o.client_id = ${clientId}`,
    ...WINDOW,
  });
  const bRow = bResult.orders[0]!;

  money(aRow.shipping_total, 4, 'SKU A (1 of 3 units) receives one third');
  money(bRow.shipping_total, 8, 'SKU B (2 of 3 units) receives two thirds');
  check(
    Math.abs(Number(aRow.shipping_total) + Number(bRow.shipping_total) - 12) < 0.005,
    'allocations across all SKU rows reconcile to the canonical order amount',
  );
  check(
    Math.abs(Number(aRow.shipping_standard) + Number(bRow.shipping_standard) - 12) < 0.005,
    'standard allocations reconcile independently on the same basis',
  );
  check(
    Math.abs(Number(aRow.shipping_total) - Number(canonical!.v)) > 0.005,
    'and NO single SKU row equals the full order amount - the retracted claim',
  );
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 18: average admission matches row display for zero and negative net');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // Hermes CP-060 return: rows displayed class money when non-zero while the
  // summary admitted only positive, so a net-negative row displayed and then
  // vanished from both numerator and denominator.
  // Order 1: net -3.00 standard (10.00 billed, 13.00 credited).
  const neg = await seedOrder({ clientId, labels: [{ service: STD, billed: 10 }] });
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: neg.orderId,
    orderNumber: neg.orderNumber,
    shipmentId: neg.shipmentIds[0]!,
    lineType: 'shipping',
    description: 'Overcharge credit',
    qty: '1',
    unitCost: '-13.00',
    totalCost: '-13.00',
  });
  // Order 2: net exactly 0.00 standard.
  const zero = await seedOrder({ clientId, labels: [{ service: STD, billed: 6 }] });
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: zero.orderId,
    orderNumber: zero.orderNumber,
    shipmentId: zero.shipmentIds[0]!,
    lineType: 'shipping',
    description: 'Full refund',
    qty: '1',
    unitCost: '-6.00',
    totalCost: '-6.00',
  });
  // Order 3: ordinary positive 9.00 standard.
  await seedOrder({ clientId, labels: [{ service: STD, billed: 9 }] });

  const result = await run(clientId);
  const byTotal = new Map(result.orders.map((o) => [Number(o.shipping_total), o]));
  const negRow = byTotal.get(-3)!;
  const zeroRow = byTotal.get(0)!;

  equal(negRow.shipping_money_state, 'attributed', 'a net-negative order is still fully attributed');
  money(negRow.shipping_standard, -3, 'the row displays the negative net');
  money(zeroRow.shipping_total, 0, 'a net-zero order shows 0.00, which is an answer');
  equal(zeroRow.shipping_standard, null, 'zero carries no class amount to display');

  // Contract: the average is a NET average over every displayed attributed row.
  // -3 and +9 are displayed and admitted; the 0.00 row displays no class amount
  // and is admitted by neither rule.
  equal(result.shipCountStandard, 2, 'both displayed class rows are counted');
  check(
    Math.abs(Number(result.avgShippingStandard) - 3) < 0.005,
    `net average over displayed rows ((-3 + 9) / 2 units) = 3.00 (got ${result.avgShippingStandard})`,
  );
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 19: invoice sum equals the displayed figure when nothing is odd');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  const seeded = await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, billed: 20 },
    ],
  });
  const [invoiced] = await db.execute<{ v: string }>(rawSql`
    select coalesce(sum(total_cost), 0)::text as v
    from billing_line_items
    where order_id = ${seeded.orderId} and line_type = 'shipping'
  `);
  const row = (await run(clientId)).orders[0]!;
  money(invoiced!.v, 25, 'the Billing definition sums to 25.00');
  money(row.shipping_total, 25, 'and the drawer shows the same 25.00');
  equal(row.shipping_money_state, 'attributed', 'no mismatch when every line is attributable');
  equal(row.shipping_reconciled, null, 'no reconciliation figure needed');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 20: NEGATIVE unattached credit - the reverse mismatch');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // Hermes CP-060 second return. A positive-only delta test misses this: the
  // invoice is LOWER than the label sum, so the drawer would show 5.00 under a
  // clean attributed state while the customer is billed 2.00. Overstating the
  // bill is the mirror of hiding part of it.
  const seeded = await seedOrder({ clientId, labels: [{ service: STD, billed: 5 }] });
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: seeded.orderId,
    orderNumber: seeded.orderNumber,
    shipmentId: null,
    lineType: 'shipping',
    description: 'Unattached shipping credit',
    qty: '1',
    unitCost: '-3.00',
    totalCost: '-3.00',
  });
  const row = (await run(clientId)).orders[0]!;
  equal(row.shipping_money_state, 'billing_mismatch', 'a negative abnormal line is a mismatch too');
  money(row.shipping_total, 2, 'the row shows what Billing actually charges');
  money(row.shipping_reconciled, 5, 'and what the labels resolved to');
  equal(row.shipping_standard, null, 'no class split while the lineage is abnormal');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 21: foreign-linked NEGATIVE line');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  const mine = await seedOrder({ clientId, labels: [{ service: STD, billed: 5 }] });
  const other = await seedOrder({ clientId, sku: 'CP060-OTHER', labels: [{ service: EXP, billed: 40 }] });
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: mine.orderId,
    orderNumber: mine.orderNumber,
    shipmentId: other.shipmentIds[0]!,
    lineType: 'shipping',
    description: 'Foreign-linked credit',
    qty: '1',
    unitCost: '-2.00',
    totalCost: '-2.00',
  });
  const result = await run(clientId);
  const row = result.orders.find((o) => o.order_id === mine.orderId)!;
  equal(row.shipping_money_state, 'billing_mismatch', 'foreign-linked negative money is disclosed');
  money(row.shipping_total, 3, 'invoiced 5.00 - 2.00');
  money(row.shipping_reconciled, 5, 'labels resolved 5.00');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 22: abnormal lines that NET TO ZERO still expose the lineage');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // +20 voided-linked and -20 unattached cancel, so both totals read 5.00 and
  // every money delta is zero. Presence of abnormal lineage - not the net - is
  // what makes this row unsafe to present as cleanly attributed.
  const seeded = await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, voided: true, billed: 20 },
    ],
  });
  await db.insert(schema.billingLineItems).values({
    clientId,
    orderId: seeded.orderId,
    orderNumber: seeded.orderNumber,
    shipmentId: null,
    lineType: 'shipping',
    description: 'Offsetting correction',
    qty: '1',
    unitCost: '-20.00',
    totalCost: '-20.00',
  });
  const row = (await run(clientId)).orders[0]!;
  money(row.shipping_total, 5, 'the invoiced total happens to equal the label sum');
  money(row.shipping_reconciled, 5, 'and so does the reconciled figure');
  equal(
    row.shipping_money_state,
    'billing_mismatch',
    'a zero net delta does not make abnormal lineage acceptable',
  );
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 23: ordinary pre-billing window is NOT a mismatch');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // The regression this exemption exists for: a frozen snapshot with no Billing
  // lines yet has zero abnormal lines and a negative delta. It must stay
  // attributed, or every freshly-labelled order would cry mismatch.
  await seedOrder({ clientId, labels: [{ service: STD, frozen: { cost: 4.1, customer: 5.5 } }] });
  const row = (await run(clientId)).orders[0]!;
  equal(row.shipping_money_state, 'attributed', 'pre-billing stays attributed, not mismatch');
  money(row.shipping_total, 5.5, 'the frozen snapshot figure is shown');
  money(row.shipping_standard, 5.5, 'and it keeps its class');
  equal(row.shipping_reconciled, null, 'nothing to reconcile');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 24: canViewFinancials=false redacts a billing_mismatch row');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, voided: true, billed: 20 },
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
  equal(row.shipping_money_state, 'billing_mismatch', 'the state survives redaction');
  equal(row.shipping_total, null, 'invoiced money redacted');
  equal(row.shipping_reconciled, null, 'the reconciliation figure is money too, and is redacted');
  equal(row.shipping_standard, null, 'std redacted');
  equal(row.shipping_cost, null, 'per-unit redacted');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 25: AC-4 - the TABLE splits a mixed order per shipment, like the drawer');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // Pre-CP-060 the table put the WHOLE order in one class, chosen by whichever
  // label was newest. That model was still serving the client Dashboard.
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, billed: 20 },
    ],
  });

  const drawer = await run(clientId);
  const table = await runTable(clientId);
  const row = table.rows.find((r) => String(r.sku).toLowerCase() === 'cp060-sku')!;

  money(String(row.std_total), 5, 'table std_total is the standard label only');
  money(String(row.exp_total), 20, 'table exp_total is the expedited label only');
  money(String(row.total_shipping), 25, 'table total is both');
  // The definitions are shared, so the two surfaces must agree in aggregate.
  check(
    Math.abs(Number(row.total_shipping) - Number(drawer.orders[0]!.shipping_total)) < 0.005,
    'table and drawer report the same money for the same order (AC-4)',
  );
  check(
    Math.abs(Number(row.std_total) - Number(drawer.orders[0]!.shipping_standard)) < 0.005,
    'and the same standard split',
  );
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 26: the charged-unit denominator does not double-count a mixed order');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  // One order, 2 units, carrying BOTH classes. std_qty_total and exp_qty_total
  // now OVERLAP (2 and 2); adding them would say 4 units and halve the
  // Dashboard average for exactly the mixed clients CP-060 exists to serve.
  await seedOrder({
    clientId,
    qty: 2,
    labels: [
      { service: STD, billed: 6 },
      { service: EXP, billed: 18 },
    ],
  });
  const table = await runTable(clientId);
  const row = table.rows.find((r) => String(r.sku).toLowerCase() === 'cp060-sku')!;

  equal(Number(row.std_qty_total), 2, 'std units counted');
  equal(Number(row.exp_qty_total), 2, 'exp units counted - the SAME 2 units');
  equal(
    Number(row.charged_qty_total),
    2,
    'charged_qty_total counts them ONCE, unlike std + exp',
  );

  const [top] = projectDashboardTopSkus([row as never], 10);
  money(String(top!.avgShippingPrice), 12, 'Dashboard average is 24.00 / 2 units, not / 4');
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 27: a billing_mismatch order is excluded from table money and counted');
await reset();
{
  const clientId = await seedClient('CP060 Client');
  await seedOrder({
    clientId,
    labels: [
      { service: STD, billed: 5 },
      { service: EXP, voided: true, billed: 20 },
    ],
  });
  const table = await runTable(clientId);
  const row = table.rows.find((r) => String(r.sku).toLowerCase() === 'cp060-sku')!;

  money(String(row.total_shipping), 0, 'unattributable money is not counted as attributed');
  money(String(row.std_total), 0, 'and gets no class');
  equal(Number(row.mismatch_orders), 1, 'but the order IS counted as a mismatch');
  money(String(row.invoiced_shipping), 25, 'and the invoiced figure stays visible');
  equal(
    Number(row.charged_qty_total),
    0,
    'a mismatch order contributes no charged units to the average',
  );
}

// ---------------------------------------------------------------------------
console.log('\\nScenario 28: tenant scope holds on the table path too');
await reset();
{
  const clientA = await seedClient('CP060 Client A');
  const clientB = await seedClient('CP060 Client B');
  await seedOrder({ clientId: clientA, labels: [{ service: STD, billed: 5 }] });
  await seedOrder({ clientId: clientB, labels: [{ service: EXP, billed: 50 }] });
  const table = await runTable(clientA);
  const row = table.rows.find((r) => String(r.sku).toLowerCase() === 'cp060-sku')!;
  money(String(row.total_shipping), 5, "only client A's money is visible");
  money(String(row.exp_total), 0, "client B's expedited money is invisible");
}

// ---------------------------------------------------------------------------
await pgClient.end({ timeout: 5 });

if (failures > 0) {
  console.error(`\n✖ CP-060 integration: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\n✓ CP-060 per-shipment shipping classification integration passed.');
process.exit(0);
