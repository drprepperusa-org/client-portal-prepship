/* CP-062 — the returns read model surfaces the linked return shipment's carrier delivery
 * signal, and the receiving queue puts arrived parcels first.
 *
 * Runs the real list, detail and receiving-queue routes against a throwaway PostgreSQL. It
 * proves, at the read-model boundary: a delivered return shipment yields the arrived signal
 * and a non-delivered one does not (AC-1/AC-5); an already-received return is not "ready to
 * receive" even though its parcel was delivered; a voided label never arrives; the queue is
 * ordered arrived-first by the SQL twin, agreeing with the JS rule row for row (AC-3); no read
 * advances returns.status (AC-4); tenant scope, the operator gate, customer-safe redaction and
 * the audit trail are unchanged (AC-5).
 *
 * Every network request is blocked; no provider, storage, or postage call is made.
 */
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();

// The receiving route imports the Supabase media-upload helper, and supabase-js initialises its
// optional realtime client at import time. Node 20 (CI) has no native WebSocket; nothing here
// opens a socket, and every fetch is blocked below. Same stub as the CP-045 integration.
if (!('WebSocket' in globalThis)) {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: class TestWebSocket {},
    configurable: true,
    writable: true,
  });
}

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  networkCalls += 1;
  throw new Error(`CP-062 integration blocked unexpected network request: ${String(input)}`);
}) as typeof fetch;

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { registerReturnReadRoutes } = await import('../../src/routes/client-portal/returns/reads');
const { registerReturnReceivingRoutes } = await import('../../src/routes/client-portal/returns/receiving');
const { resolveReturnArrival } = await import('../../src/services/return-arrival');

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

function appFor(clientId: number, opts: { global?: boolean } = {}): Hono {
  const routes = new Hono();
  registerReturnReadRoutes(routes);
  registerReturnReceivingRoutes(routes);
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'cp062-user' as never);
    c.set('email' as never, 'cp062@example.test' as never);
    c.set('role' as never, (opts.global ? 'admin' : 'client_user') as never);
    c.set('permissions' as never, [] as never);
    c.set('clientIds' as never, (opts.global ? [] : [clientId]) as never);
    c.set('storeIds' as never, [] as never);
    await next();
  });
  app.route('/', routes);
  return app;
}

async function reset(): Promise<void> {
  await db.execute(sql`
    truncate table
      return_activity_events,
      client_portal_audit_logs,
      returns,
      shipments,
      orders,
      clients
    restart identity cascade
  `);
  networkCalls = 0;
}

const DELIVERED_AT = new Date('2026-07-24T18:04:00Z');
const daysAgo = (days: number): Date => new Date(Date.UTC(2026, 7, 27) - days * 86_400_000);

type ShipmentSeed = { trackingStatus: string | null; deliveredAt: Date | null; voided: boolean };
type ReturnSeed = { key: string; status: string; requestedAt: Date; shipment: ShipmentSeed | null };

async function seedClient(name: string): Promise<{ clientId: number; prefix: string }> {
  const [client] = await db.insert(schema.clients).values({ name, isTest: false }).returning();
  return { clientId: client!.id, prefix: name.replace(/\s+/g, '-').toUpperCase() };
}

// One order per return: the schema allows a single active return per order
// (returns_one_active_per_order_idx), which is exactly what production looks like.
async function seedReturn(tenant: { clientId: number; prefix: string }, seed: ReturnSeed): Promise<number> {
  const orderNumber = `${tenant.prefix}-${seed.key}`;
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber,
      orderStatus: 'shipped',
      clientId: tenant.clientId,
      shipToName: 'CP-062 Customer',
      shipToCity: 'Los Angeles',
      shipToState: 'CA',
      shipToPostalCode: '90001',
      raw: { shipTo: { name: 'CP-062 Customer' } },
    })
    .returning();
  const owner = { clientId: tenant.clientId, orderId: order!.id, orderNumber };
  let returnShipmentId: number | null = null;
  if (seed.shipment) {
    const [shipment] = await db
      .insert(schema.shipments)
      .values({
        orderId: owner.orderId,
        clientId: owner.clientId,
        orderNumber: owner.orderNumber,
        trackingNumber: `1Z${seed.key}CP062`,
        labelTracking: `1Z${seed.key}CP062`,
        labelCarrier: 'ups',
        isReturn: true,
        voided: seed.shipment.voided,
        source: 'prepship_return_v2',
        trackingStatus: seed.shipment.trackingStatus,
        deliveredAt: seed.shipment.deliveredAt,
      })
      .returning();
    returnShipmentId = shipment!.id;
  }
  const [row] = await db
    .insert(schema.returns)
    .values({
      orderId: owner.orderId,
      clientId: owner.clientId,
      returnReference: `${owner.orderNumber}-RETURN`,
      status: seed.status,
      initiatedBy: 'client',
      reason: `CP-062 fixture ${seed.key}`,
      returnShipmentId,
      requestedAt: seed.requestedAt,
    })
    .returning();
  return row!.id;
}

type Row = {
  id: number;
  status: string;
  trackingStatus: string | null;
  deliveredAt: string | null;
  arrivedReadyToReceive: boolean;
  [key: string]: unknown;
};
type ListBody = { data?: Row[]; error?: unknown };

const delivered: ShipmentSeed = { trackingStatus: 'delivered', deliveredAt: DELIVERED_AT, voided: false };
const enRoute: ShipmentSeed = { trackingStatus: 'in_transit', deliveredAt: null, voided: false };

async function run(): Promise<void> {
  console.log('\nCP-062 - seeding one tenant with five returns and a second tenant with one');
  await reset();
  const tenant = await seedClient('CP-062 Tenant');
  const other = await seedClient('CP-062 Other');
  const ids = {
    A: await seedReturn(tenant, { key: 'A', status: 'in_transit', requestedAt: daysAgo(5), shipment: delivered }),
    B: await seedReturn(tenant, { key: 'B', status: 'in_transit', requestedAt: daysAgo(1), shipment: enRoute }),
    C: await seedReturn(tenant, { key: 'C', status: 'received', requestedAt: daysAgo(2), shipment: delivered }),
    D: await seedReturn(tenant, { key: 'D', status: 'in_transit', requestedAt: daysAgo(3), shipment: { ...delivered, voided: true } }),
    E: await seedReturn(tenant, { key: 'E', status: 'requested', requestedAt: daysAgo(4), shipment: null }),
    F: await seedReturn(other, { key: 'F', status: 'in_transit', requestedAt: daysAgo(6), shipment: delivered }),
  };

  console.log('\nCP-062 AC-1/AC-2 - the tenant list carries the carrier signal per row');
  const listRes = await appFor(tenant.clientId).request('/returns?pageSize=50');
  const list = (await listRes.json()) as ListBody;
  equal(listRes.status, 200, 'the tenant list responds');
  const rows = new Map((list.data ?? []).map((row) => [row.id, row]));
  equal(rows.size, 5, 'the tenant sees exactly its five returns (the other tenant is out of scope)');
  check(!rows.has(ids.F), 'the other tenant\'s arrived return is not in this tenant\'s list');
  const a = rows.get(ids.A)!;
  equal(a.arrivedReadyToReceive, true, 'A (in_transit, parcel delivered) is arrived — ready to receive');
  equal(a.deliveredAt, DELIVERED_AT.toISOString(), 'A surfaces the carrier delivered_at as an ISO instant');
  equal(a.trackingStatus, 'delivered', 'A surfaces the carrier tracking_status');
  equal(a.status, 'in_transit', 'A keeps its lifecycle status (delivery is a separate signal)');
  const b = rows.get(ids.B)!;
  equal(b.arrivedReadyToReceive, false, 'B (in_transit, parcel en route) is not arrived');
  equal(b.deliveredAt, null, 'B has no delivered_at');
  equal(b.trackingStatus, 'in_transit', 'B surfaces its carrier state');
  const c = rows.get(ids.C)!;
  equal(c.arrivedReadyToReceive, false, 'C (received, parcel delivered) is not "ready to receive" again');
  equal(c.deliveredAt, DELIVERED_AT.toISOString(), 'C still shows when its parcel was delivered');
  equal(rows.get(ids.D)!.arrivedReadyToReceive, false, 'D (voided return label) never arrives');
  const e = rows.get(ids.E)!;
  equal(e.arrivedReadyToReceive, false, 'E (no return shipment) is not arrived');
  equal(e.trackingStatus, null, 'E has no carrier state');
  equal(e.deliveredAt, null, 'E has no delivered_at');

  console.log('\nCP-062 AC-5 - customer-safe redaction unchanged on the list row');
  for (const key of ['labelCarrier', 'carrierCode', 'serviceCode', 'cost', 'labelUrl', 'source', 'providerAccountId', 'selectedRateJson', 'returnShipmentVoided']) {
    check(!(key in a), `the list row carries no ${key}`);
  }

  console.log('\nCP-062 AC-1 - the detail carries the same signal');
  const detailRes = await appFor(tenant.clientId).request(`/returns/${ids.A}`);
  const detail = (await detailRes.json()) as { data?: Row };
  equal(detailRes.status, 200, 'the tenant detail responds');
  equal(detail.data?.arrivedReadyToReceive, true, 'detail A is arrived');
  equal(detail.data?.deliveredAt, DELIVERED_AT.toISOString(), 'detail A carries delivered_at');
  equal(detail.data?.trackingStatus, 'delivered', 'detail A carries tracking_status');
  const otherDetail = await appFor(tenant.clientId).request(`/returns/${ids.F}`);
  equal(otherDetail.status, 404, 'the other tenant\'s return is not readable from this tenant');

  console.log('\nCP-062 AC-3 - the receiving queue puts arrived parcels first, then newest requested');
  const queueRes = await appFor(tenant.clientId, { global: true }).request('/returns/receiving');
  const queue = (await queueRes.json()) as ListBody;
  equal(queueRes.status, 200, 'the operator queue responds');
  const order = (queue.data ?? []).map((row) => row.id);
  equal(order.join(','), [ids.A, ids.F, ids.B, ids.C, ids.D, ids.E].join(','), 'queue order: arrived (A, F) first, then B, C, D, E by requested time');
  const qa = (queue.data ?? []).find((row) => row.id === ids.A)!;
  equal(qa.arrivedReadyToReceive, true, 'queue row A is flagged arrived');
  equal(qa.deliveredAt, DELIVERED_AT.toISOString(), 'queue row A carries delivered_at');
  equal(qa.trackingStatus, 'delivered', 'queue row A carries tracking_status');
  equal((queue.data ?? []).filter((row) => row.arrivedReadyToReceive).length, 2, 'exactly the two arrived returns are flagged');

  console.log('\nCP-062 - the SQL twin and the JS rule agree row for row');
  const twin = await db
    .select({
      id: schema.returns.id,
      status: schema.returns.status,
      trackingStatus: schema.shipments.trackingStatus,
      deliveredAt: schema.shipments.deliveredAt,
      voided: schema.shipments.voided,
    })
    .from(schema.returns)
    .leftJoin(schema.shipments, eq(schema.shipments.id, schema.returns.returnShipmentId));
  for (const row of twin) {
    const js = resolveReturnArrival({ status: row.status, trackingStatus: row.trackingStatus, deliveredAt: row.deliveredAt, shipmentVoided: row.voided }).arrivedReadyToReceive;
    const queued = (queue.data ?? []).find((q) => q.id === row.id)?.arrivedReadyToReceive;
    equal(queued, js, `return ${row.id}: SQL-ordered queue flag == JS rule`);
  }

  console.log('\nCP-062 AC-5 - the operator gate still holds for a client user');
  const gated = await appFor(tenant.clientId).request('/returns/receiving');
  equal(gated.status, 403, 'a client user cannot read the receiving queue');

  console.log('\nCP-062 AC-4 - no read advanced returns.status');
  for (const [key, id, want] of [['A', ids.A, 'in_transit'], ['D', ids.D, 'in_transit'], ['C', ids.C, 'received'], ['E', ids.E, 'requested']] as const) {
    const [row] = await db.select({ status: schema.returns.status }).from(schema.returns).where(eq(schema.returns.id, id));
    equal(row?.status, want, `${key} is still ${want}`);
  }

  console.log('\nCP-062 AC-5 - audit trail and network');
  const audit = await db.execute(sql`select count(*)::int as n from client_portal_audit_logs`);
  const auditRows = (Array.isArray(audit) ? audit : (audit as { rows?: unknown[] }).rows ?? []) as Array<{ n: number }>;
  check((auditRows[0]?.n ?? 0) >= 3, `the list, detail and queue reads were audited (${auditRows[0]?.n ?? 0} rows)`);
  equal(networkCalls, 0, 'no provider or storage network call was made');
}

try {
  await run();
} finally {
  globalThis.fetch = originalFetch;
  await pgClient.end({ timeout: 5 }).catch(() => undefined);
}

if (failures > 0) {
  console.error(`\nCP-062 integration: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nCP-062 integration: all checks passed');
