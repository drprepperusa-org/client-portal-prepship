/* Client-portal INTEGRATION suite — the behavioral layer the static guards
 * can't provide. It seeds fixtures into a throwaway Postgres and runs the REAL
 * read-model functions, asserting actual numbers/behavior. It exists because
 * every bug that reached production this cycle (revenue drift, the sku-orders
 * 404, the carrier leak, billing/invoice drift) passed ~90 green static guards
 * — those pin the code's SHAPE, not its BEHAVIOR on real data.
 *
 * Prereqs (never touches prod — see guard.ts):
 *   export TEST_DATABASE_URL="postgres://…throwaway…"
 *   npm run test:client-portal-integration:setup    # applies the schema
 *   npm run test:client-portal-integration
 */
import { eq as drizzleEq, sql } from 'drizzle-orm';
import type { ClientPortalScope } from '../../src/lib/client-portal/scope';
import type { SkuBreakdownQuery } from '../../src/routes/analysis';
import { setupTestEnv } from './guard';

// Bind the app to the test DB BEFORE importing any db-bound module.
setupTestEnv();

// `pgClient` is the raw postgres-js connection (for teardown .end()); db.execute
// takes drizzle's `sql` tag imported above.
const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const analysis = await import('../../src/routes/analysis');
const dtoMod = await import('../../src/lib/client-portal/dto');
const invoice = await import('../../src/lib/client-portal/read-models/invoice-details');
const ordersReadModel = await import('../../src/lib/client-portal/read-models/orders');
const shippingRateSql = await import('../../src/lib/client-portal/customer-shipping-rate');

// ── tiny assertion runner ──
let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures += 1;
  }
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  const same = actual === expected || Number(actual) === Number(expected);
  check(same, `${msg} (got ${String(actual)}, want ${String(expected)})`);
}

const FROM = '2026-06-01T00:00:00.000Z';
const TO = '2026-06-30T23:59:59.999Z';
const ORDER_DATE = new Date('2026-06-10T12:00:00.000Z');

function makeScope(clientIds: number[], canViewFinancials = true): ClientPortalScope {
  return {
    clientIds,
    storeIds: [],
    isGlobal: false,
    isRestricted: true,
    userId: 'test-user',
    email: 'client@example.com',
    role: 'client_user',
    permissions: canViewFinancials ? ['financials:read'] : [],
    canViewFinancials,
    canViewCredentials: false,
  };
}

function moneyOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

async function reset(): Promise<void> {
  await db.execute(
    sql`truncate table billing_line_items, order_items, orders, inventory, clients restart identity cascade`,
  );
}

async function seed() {
  const [hugrabRow, otherRow] = await db
    .insert(schema.clients)
    .values([{ name: 'HUGRAB' }, { name: 'Other Co' }])
    .returning();
  const hugrab = hugrabRow!;
  const other = otherRow!;

  // Same SKU has a global (client_id NULL, SMALLER id) inventory row AND the
  // client's own row — the exact shape that 404'd the Analysis drawer.
  // Stock is not a column on inventory (PS-439: quantity = Σ inventory_ledger.qty);
  // this fixture only asserts id resolution, so it seeds no ledger movements.
  const invGlobal = (await db
    .insert(schema.inventory)
    .values({ sku: 'SKU-A', name: 'Item A', clientId: null, reorderLevel: 10 })
    .returning())[0]!;
  const invHugrab = (await db
    .insert(schema.inventory)
    .values({ sku: 'SKU-A', name: 'Item A', clientId: hugrab.id, reorderLevel: 10 })
    .returning())[0]!;

  // HUGRAB shipped order: SKU-A ×2 @10 + SKU-B ×3 @5 → line revenue 35, units 5.
  const order1 = (await db
    .insert(schema.orders)
    .values({
      orderNumber: '1001',
      orderStatus: 'shipped',
      clientId: hugrab.id,
      orderDate: ORDER_DATE,
      orderTotal: '99.99',
      shippingAmount: '0',
      shipToName: 'Judy Mai',
      shipToCity: 'Boston',
      shipToState: 'MA',
      shipToPostalCode: '02101',
      items: [
        { sku: 'SKU-A', name: 'Item A', quantity: 2, unitPrice: 10 },
        { sku: 'SKU-B', name: 'Item B', quantity: 3, unitPrice: 5 },
      ],
      raw: { shipTo: { street1: '123 Main St', country: 'US' } },
    })
    .returning())[0]!;
  await db.insert(schema.orderItems).values([
    { orderId: order1.id, lineIndex: 0, sku: 'SKU-A', name: 'Item A', orderStatus: 'shipped', quantity: '2', unitPrice: '10.00', clientId: hugrab.id, orderDate: ORDER_DATE },
    { orderId: order1.id, lineIndex: 1, sku: 'SKU-B', name: 'Item B', orderStatus: 'shipped', quantity: '3', unitPrice: '5.00', clientId: hugrab.id, orderDate: ORDER_DATE },
  ]);

  // HUGRAB CANCELLED order — must be excluded from revenue/units.
  const cancelled = (await db
    .insert(schema.orders)
    .values({ orderNumber: '1002', orderStatus: 'cancelled', clientId: hugrab.id, orderDate: ORDER_DATE })
    .returning())[0]!;
  await db.insert(schema.orderItems).values({ orderId: cancelled.id, lineIndex: 0, sku: 'SKU-A', name: 'Item A', orderStatus: 'cancelled', quantity: '5', unitPrice: '10.00', clientId: hugrab.id, orderDate: ORDER_DATE });

  // OTHER-client order — must be excluded by scope.
  const otherOrder = (await db
    .insert(schema.orders)
    .values({ orderNumber: '2001', orderStatus: 'shipped', clientId: other.id, orderDate: ORDER_DATE })
    .returning())[0]!;
  await db.insert(schema.orderItems).values({ orderId: otherOrder.id, lineIndex: 0, sku: 'SKU-A', name: 'Item A', orderStatus: 'shipped', quantity: '10', unitPrice: '10.00', clientId: other.id, orderDate: ORDER_DATE });

  // Billing for the HUGRAB order: pick&pack 2.00 + shipping 7.73 → 9.73.
  await db.insert(schema.billingLineItems).values([
    { clientId: hugrab.id, orderId: order1.id, orderNumber: '1001', shipDate: ORDER_DATE, lineType: 'pick_pack', description: 'Pick & Pack', unitCost: '2.00', totalCost: '2.00' },
    { clientId: hugrab.id, orderId: order1.id, orderNumber: '1001', shipDate: ORDER_DATE, lineType: 'shipping', description: 'Shipping', unitCost: '7.73', totalCost: '7.73' },
  ]);

  return { hugrab, other, invGlobal, invHugrab, order1 };
}

async function insertCp046PendingFixture(clientId: number): Promise<void> {
  const cp046Sku = 'SKU-CP046-PENDING-SOT';
  const awaitingOrder = (await db
    .insert(schema.orders)
    .values({
      orderNumber: 'CP046-AWAITING',
      orderStatus: 'awaiting_shipment',
      clientId,
      orderDate: ORDER_DATE,
      orderTotal: '12.00',
      shippingAmount: '0',
      items: [{ sku: cp046Sku, name: 'CP046 Awaiting SKU', quantity: 1, unitPrice: 12 }],
      raw: {},
    })
    .returning())[0]!;
  await db.insert(schema.orderItems).values({
    orderId: awaitingOrder.id,
    lineIndex: 0,
    sku: cp046Sku,
    name: 'CP046 Awaiting SKU',
    orderStatus: 'awaiting_shipment',
    quantity: '1',
    unitPrice: '12.00',
    clientId,
    orderDate: ORDER_DATE,
  });

  const shippedNoBillingOrder = (await db
    .insert(schema.orders)
    .values({
      orderNumber: 'CP046-SHIPPED-NO-BILLING',
      orderStatus: 'shipped',
      clientId,
      orderDate: ORDER_DATE,
      orderTotal: '12.00',
      shippingAmount: '0',
      items: [{ sku: cp046Sku, name: 'CP046 Awaiting SKU', quantity: 1, unitPrice: 12 }],
      raw: {},
    })
    .returning())[0]!;
  await db.insert(schema.orderItems).values({
    orderId: shippedNoBillingOrder.id,
    lineIndex: 0,
    sku: cp046Sku,
    name: 'CP046 Awaiting SKU',
    orderStatus: 'shipped',
    quantity: '1',
    unitPrice: '12.00',
    clientId,
    orderDate: ORDER_DATE,
  });
  await db.insert(schema.shipments).values({
    orderId: shippedNoBillingOrder.id,
    clientId,
    orderNumber: shippedNoBillingOrder.orderNumber,
    shipDate: ORDER_DATE,
    cost: '6.66',
    labelCost: '6.66',
    otherCost: '0',
    carrierCode: 'fedex',
    voided: false,
  });

  await db.insert(schema.orders).values({
    orderNumber: 'SEAuto-CP046-EMPTY',
    orderStatus: 'awaiting_shipment',
    clientId,
    orderDate: ORDER_DATE,
    orderTotal: '0',
    shippingAmount: '0',
    items: [],
    raw: { orderNumber: 'SEAuto-CP046-EMPTY' },
  });
}

async function insertCustomerShippingSnapshotCase(
  name: string,
  selectedRateJson: Record<string, unknown> | null,
  opts: { isReturn?: boolean } = {},
) {
  const [client] = await db
    .insert(schema.clients)
    .values({ name: `PS437 ${name}` })
    .returning();
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: `PS437-${name}`,
      orderStatus: 'shipped',
      clientId: client!.id,
      orderDate: ORDER_DATE,
    })
    .returning();
  const [shipment] = await db
    .insert(schema.shipments)
    .values({
      orderId: order!.id,
      clientId: client!.id,
      orderNumber: order!.orderNumber,
      shipDate: ORDER_DATE,
      cost: '5.70',
      labelCost: '5.70',
      otherCost: '0',
      carrierCode: 'stamps_com',
      selectedRateJson,
      voided: false,
      isReturn: opts.isReturn ?? false,
    })
    .returning();
  return { client: client!, order: order!, shipment: shipment! };
}

async function main(): Promise<number> {
  await reset();
  const { hugrab, invGlobal, invHugrab, order1 } = await seed();

  const q: SkuBreakdownQuery = {
    dateFrom: FROM,
    dateTo: TO,
    clientIds: [hugrab.id],
    scopeRestricted: true,
    canViewFinancials: true,
    includeCancelled: false,
    hideTestOrders: false,
    limit: 2000,
  };

  // ── Group 1: Dashboard/Analysis revenue parity (CP-010) ──
  console.log('\nGroup 1 — Dashboard/Analysis revenue parity (CP-010)');
  const totals = await analysis.getClientPortalSalesTotals(q);
  eq(totals.revenue, 35, 'canonical revenue = Σ(unit_price×qty), cancelled + other-client excluded');
  eq(totals.units, 5, 'canonical units = Σ qty, cancelled + other-client excluded');
  const breakdown = await analysis.getSkuBreakdownFromOrderItems(q);
  eq(breakdown.totalRevenue, 35, 'Analysis totalRevenue == the canonical revenue');
  eq(breakdown.totalUnits, 5, 'Analysis totalUnits == the canonical units');
  eq(breakdown.rows.reduce((n, r) => n + Number(r.total_revenue), 0), 35, 'per-SKU rows roll up to the same revenue total');
  eq(breakdown.rows.reduce((n, r) => n + Number(r.total_qty), 0), 5, 'per-SKU rows roll up to the same units total');

  // ── Group 2: scoped inventory resolution (the sku-orders 404 fix) ──
  console.log('\nGroup 2 — Scoped inventory resolution (sku-orders 404 fix)');
  const skuA = breakdown.rows.find((r) => r.sku === 'SKU-A');
  eq(skuA?.inv_sku_id, invHugrab.id, 'scoped user resolves to the OPENABLE own-client inventory id, not the global one');
  const globalRows = await analysis.getSkuBreakdownFromOrderItems({ ...q, clientIds: [], scopeRestricted: false });
  eq(globalRows.rows.find((r) => r.sku === 'SKU-A')?.inv_sku_id, invGlobal.id, 'global user resolves to the smallest id (unchanged)');

  // ── Group 3: carrier/service never exposed to a client (CP-009) ──
  console.log('\nGroup 3 — Carrier/service redaction (CP-009)');
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const orderRow: any = {
    id: order1.id, clientId: hugrab.id, clientName: 'HUGRAB', orderNumber: '1001', orderStatus: 'shipped',
    orderDate: ORDER_DATE, carrierCode: 'stamps_com', serviceCode: 'usps_ground_advantage',
    shipToName: 'Judy Mai', shipToCity: 'Boston', shipToState: 'MA', shipToPostalCode: '02101',
    weightOz: 10, orderTotal: '99.99', shippingAmount: '0',
    items: [{ sku: 'SKU-A', name: 'Item A', quantity: 2, unitPrice: 10 }],
    canonicalItems: [{ sku: 'SKU-A', name: 'Item A', quantity: '2', unitPrice: '10.00', lineTotal: '20.00', imageUrl: null }],
    raw: { shipTo: { street1: '123 Main St', country: 'US' } },
  };
  const clientOrder: any = dtoMod.toPortalOrderDto(orderRow, { includeFinancials: false });
  check(clientOrder.carrierCode === null && clientOrder.serviceCode === null && clientOrder.shippingService === null, 'client order DTO exposes NO carrier / service');
  check(clientOrder.shipToLine1 === '123 Main St', 'client order DTO still exposes the ship-to address (address is not gated)');
  check(!('bestRateAmount' in clientOrder) && !('bestRateJson' in clientOrder), 'client order DTO exposes no raw rate JSON / gated rate money');
  const financialOrder: any = dtoMod.toPortalOrderDto(orderRow, { includeFinancials: true });
  check(financialOrder.carrierCode === null && financialOrder.serviceCode === null, 'financials order DTO ALSO exposes no carrier/service (CP-009 — never in the portal)');
  check(financialOrder.orderTotal != null, 'financials order DTO still exposes money (order total)');
  const clientShipment: any = dtoMod.toPortalShipmentDto(
    { id: 1, orderId: order1.id, clientId: hugrab.id, carrierCode: 'stamps_com', serviceCode: 'usps_ground_advantage', trackingNumber: '9400abc', voided: false } as any,
    { includeFinancials: false },
  );
  check(clientShipment.carrierCode === null && clientShipment.serviceCode === null, 'client shipment DTO exposes NO carrier / service');
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ── Group 4: billing totals reconcile with invoice detail (CP-011) ──
  console.log('\nGroup 4 — Billing totals reconcile with invoice detail (CP-011)');
  const s = makeScope([hugrab.id]);
  const details = await invoice.portalInvoiceDetails(s, { clientId: hugrab.id, dateFrom: FROM, dateTo: TO });
  const detailTotal = details.reduce((n, r) => n + Number(r.rowTotal), 0);
  eq(detailTotal, 9.73, 'invoice detail row totals sum to the billed amount');
  const period = await invoice.portalInvoicePeriodSummary(s, { clientId: hugrab.id, dateFrom: FROM, dateTo: TO, granularity: 'month' });
  eq(period.reduce((n, r) => n + Number(r.rowTotal), 0), detailTotal, 'billing period-summary total == Σ invoice detail rows (no footer drift)');

  // PS-437: Client Portal reads only PrepShip's frozen tuple.
  console.log('\nGroup 5 - Frozen customer shipping snapshot projection (PS-437)');
  const frozenTuple = {
    selectedRateCost: 5.7,
    cShippingRateAmount: 6.77,
    shippingMarginAmount: 1.07,
    shippingMarginPct: 15.8,
    customerRateSource: 'hugrab_shipping_rate_override',
    rateCostSource: 'label_final_cost',
    customerShippingMoneyPolicyVersion: 'ps-437-v1',
  };
  // Hermes PS-508 round-4 (P4 lane boundary): ps-437's only non-return writer is the
  // replacement freeze, and PS-502's tables are not applied in production — so the non-return
  // union no longer accepts ps-437 at all. This fixture used to expect 6.77 here; that was the
  // exact unsafe case the boundary removes. The return-lane case below proves ps-437 money is
  // still projected where it legitimately lives.
  const snapshotCase = await insertCustomerShippingSnapshotCase('snapshot', frozenTuple);
  const [snapshotRow] = await db
    .select({ projected: shippingRateSql.projectedCustomerShippingRateSql() })
    .from(schema.shipments)
    .where(drizzleEq(schema.shipments.id, snapshotCase.shipment.id));
  eq(moneyOrNull(snapshotRow?.projected), null,
    'a NON-return ps-437 tuple projects null (no relational replacement-lane proof)');

  const returnCase = await insertCustomerShippingSnapshotCase('return-lane', frozenTuple, { isReturn: true });
  const [returnRow] = await db
    .select({ projected: shippingRateSql.projectedCustomerShippingRateSql() })
    .from(schema.shipments)
    .where(drizzleEq(schema.shipments.id, returnCase.shipment.id));
  eq(moneyOrNull(returnRow?.projected), 6.77,
    'the SAME ps-437 tuple on a RETURN shipment still projects the frozen amount');

  const missingCase = await insertCustomerShippingSnapshotCase('missing', null);
  const [missingRow] = await db
    .select({ projected: shippingRateSql.projectedCustomerShippingRateSql() })
    .from(schema.shipments)
    .where(drizzleEq(schema.shipments.id, missingCase.shipment.id));
  eq(moneyOrNull(missingRow?.projected), null,
    'raw shipment cost is never promoted when the frozen tuple is missing');

  const frozen = await insertCustomerShippingSnapshotCase('frozen-line-wins', frozenTuple);
  await db.insert(schema.billingLineItems).values({
    clientId: frozen.client.id,
    orderId: frozen.order.id,
    orderNumber: frozen.order.orderNumber,
    shipmentId: frozen.shipment.id,
    shipDate: ORDER_DATE,
    lineType: 'shipping',
    description: 'Frozen shipping',
    unitCost: '7.77',
    totalCost: '7.77',
  });
  const [frozenRow] = await db
    .select({ resolved: shippingRateSql.shipmentCustomerShippingRateSql() })
    .from(schema.shipments)
    .where(drizzleEq(schema.shipments.id, frozen.shipment.id));
  eq(
    moneyOrNull(frozenRow?.resolved),
    7.77,
    'shipmentCustomerShippingRateSql prefers frozen billing line over live projection',
  );

  console.log('\nGroup 6 - CP-046 Analysis pending awaiting-order SOT');
  await insertCp046PendingFixture(hugrab.id);
  const cp046Breakdown = await analysis.getSkuBreakdownFromOrderItems({
    ...q,
    shippingBasis: 'customer_billed',
    limit: 2000,
  });
  const cp046Row = cp046Breakdown.rows.find((r) => r.sku === 'SKU-CP046-PENDING-SOT');
  const awaitingSotCount = await ordersReadModel.awaitingActiveOrderCount(makeScope([hugrab.id]), {});
  eq(awaitingSotCount, 1, 'Orders awaiting SOT counts the real awaiting order and excludes the SEAuto no-item placeholder');
  eq(cp046Row?.orders, 2, 'fixture has two SKU rows: one awaiting plus one shipped with no billed shipping line');
  eq(cp046Row?.pending, 1, 'Analysis pending counts only awaiting-shipment SKU orders, not shipped rows missing billing');

  return failures;
}

let code = 1;
try {
  const failed = await main();
  code = failed === 0 ? 0 : 1;
  console.log(failed === 0 ? '\n✓ client-portal integration suite passed.\n' : `\n✗ ${failed} assertion(s) failed.\n`);
} catch (err) {
  console.error('\n✗ integration suite errored:', err instanceof Error ? err.stack : err);
  code = 1;
} finally {
  try {
    await reset();
  } catch {
    /* best-effort cleanup */
  }
  await pgClient.end({ timeout: 5 });
}
process.exit(code);
