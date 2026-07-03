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
import { sql } from 'drizzle-orm';
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
  const invGlobal = (await db
    .insert(schema.inventory)
    .values({ sku: 'SKU-A', name: 'Item A', clientId: null, stockQty: 4, reorderLevel: 10 })
    .returning())[0]!;
  const invHugrab = (await db
    .insert(schema.inventory)
    .values({ sku: 'SKU-A', name: 'Item A', clientId: hugrab.id, stockQty: 100, reorderLevel: 10 })
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
    raw: { shipTo: { street1: '123 Main St', country: 'US' } },
  };
  const clientOrder: any = dtoMod.toPortalOrderDto(orderRow, { includeFinancials: false });
  check(clientOrder.carrierCode === null && clientOrder.serviceCode === null && clientOrder.shippingService === null, 'client order DTO exposes NO carrier / service');
  check(clientOrder.shipToLine1 === '123 Main St', 'client order DTO still exposes the ship-to address (address is not gated)');
  check(!('bestRateAmount' in clientOrder) && !('bestRateJson' in clientOrder), 'client order DTO exposes no raw rate JSON / gated rate money');
  const adminOrder: any = dtoMod.toPortalOrderDto(orderRow, { includeFinancials: true });
  check(adminOrder.carrierCode === 'stamps_com', 'operator (financials) order DTO keeps carrier — gated path unchanged');
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
