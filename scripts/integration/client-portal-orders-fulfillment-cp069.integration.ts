/* CP-069 — orders / shipments fulfillment display contract, proven on a real Postgres.
 *
 * Seeds every row of the CP-069 acceptance matrix for client A (plus a second tenant B whose
 * order numbers collide with A's) and asserts through the REAL code paths: the orders and
 * shipments read-models, the DTO builders, the mounted Hono sub-routers (GET /orders,
 * GET /orders/:id/shipments, GET /shipments, POST /returns/refresh-tracking), and the
 * TS-twin ⇄ SQL-twin agreement of the PrepShip order-lifecycle bucket for every seeded order.
 *
 * Every network request is blocked: the suite must never reach a carrier or ShipStation.
 */
import { sql as rawSql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
  networkCalls += 1;
  throw new Error(`CP-069 integration blocked unexpected network request: ${String(input)}`);
}) as typeof fetch;

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const { listPortalOrders, getPortalOrder, awaitingActiveOrderCount } = await import(
  '../../src/lib/client-portal/read-models/orders'
);
const { listPortalShipments } = await import('../../src/lib/client-portal/read-models/shipments');
const { resolvePortalOrderFulfillmentBucket, portalOrderFulfillmentBucketSql } = await import(
  '../../src/lib/client-portal/order-lifecycle'
);
const { default: ordersRoutes } = await import('../../src/routes/client-portal/orders');
const { default: shipmentsRoutes } = await import('../../src/routes/client-portal/shipments');
const { default: returnsRoutes } = await import('../../src/routes/client-portal/returns');
import type { ClientPortalScope } from '../../src/lib/client-portal/scope';
import type { PortalOrderStatusFilter } from '../../src/lib/client-portal/read-models/orders';
import type { PortalShipmentStatus } from '../../src/lib/client-portal/shipment-status';

// ---------------------------------------------------------------------------
// Harness

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

function sameIdSet(actual: number[], expected: number[], message: string): void {
  const a = [...new Set(actual)].sort((x, y) => x - y);
  const e = [...new Set(expected)].sort((x, y) => x - y);
  check(
    a.length === e.length && a.every((id, index) => id === e[index]),
    `${message} (got [${a.join(',')}], want [${e.join(',')}])`,
  );
}

function scopeFor(clientIds: number[]): ClientPortalScope {
  return {
    kind: 'client-portal',
    userId: 'cp069-test-user',
    email: 'cp069@example.test',
    role: clientIds.length ? 'client_user' : 'admin',
    permissions: [],
    isGlobal: clientIds.length === 0,
    isRestricted: clientIds.length > 0,
    clientIds,
    storeIds: [],
    canViewFinancials: true,
    canViewCredentials: false,
  } as unknown as ClientPortalScope;
}

/** Mount a real client-portal sub-router behind a scope-injecting middleware. */
function appFor(routes: Hono, clientId: number): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, 'cp069-route-user' as never);
    c.set('email' as never, 'cp069-route@example.test' as never);
    c.set('role' as never, 'client_user' as never);
    c.set('permissions' as never, ['financials:read'] as never);
    c.set('clientIds' as never, [clientId] as never);
    c.set('storeIds' as never, [] as never);
    await next();
  });
  app.route('/', routes);
  return app;
}

async function reset(): Promise<void> {
  await db.execute(rawSql`
    truncate table
      returns,
      shipments,
      order_items,
      order_overrides,
      orders,
      clients,
      client_portal_audit_logs
    restart identity cascade
  `);
  networkCalls = 0;
}

// ---------------------------------------------------------------------------
// Seed helpers

async function seedClient(name: string): Promise<number> {
  const [client] = await db.insert(schema.clients).values({ name, isTest: false }).returning();
  return client!.id;
}

let orderSeq = 0;
async function seedOrder(input: {
  clientId: number;
  orderNumber: string;
  orderStatus: string;
  canonicalStatus?: string | null;
  externallyShipped?: boolean;
  raw?: Record<string, unknown>;
}): Promise<number> {
  orderSeq += 1;
  const [order] = await db
    .insert(schema.orders)
    .values({
      orderNumber: input.orderNumber,
      orderStatus: input.orderStatus,
      canonicalStatus: input.canonicalStatus ?? null,
      externallyShipped: input.externallyShipped ?? false,
      raw: input.raw ?? {},
      clientId: input.clientId,
      orderDate: new Date(Date.UTC(2026, 8, 1, 12, orderSeq)),
      shipToName: `CP-069 Customer ${orderSeq}`,
      items: [{ sku: `SKU-${orderSeq}`, name: `Item ${orderSeq}`, quantity: 1 }],
      orderTotal: '10.00',
    })
    .returning();
  await db.insert(schema.orderItems).values({
    orderId: order!.id,
    lineIndex: 0,
    sku: `SKU-${orderSeq}`,
    name: `Item ${orderSeq}`,
    quantity: '1',
    unitPrice: '10.00',
    lineTotal: '10.00',
    clientId: input.clientId,
    orderStatus: input.orderStatus,
    orderDate: order!.orderDate,
  });
  return order!.id;
}

async function seedShipment(input: {
  orderId: number | null;
  clientId: number | null;
  orderNumber: string;
  trackingNumber?: string | null;
  labelTracking?: string | null;
  voided?: boolean;
  isReturn?: boolean;
  source?: string;
  trackingStatus?: string | null;
  deliveredAt?: Date | null;
  shipDate?: Date | null;
}): Promise<number> {
  const [row] = await db
    .insert(schema.shipments)
    .values({
      orderId: input.orderId,
      clientId: input.clientId,
      orderNumber: input.orderNumber,
      trackingNumber: input.trackingNumber ?? null,
      labelTracking: input.labelTracking ?? null,
      voided: input.voided ?? false,
      isReturn: input.isReturn ?? false,
      source: input.source ?? 'test_offline',
      trackingStatus: input.trackingStatus ?? null,
      deliveredAt: input.deliveredAt ?? null,
      shipDate: input.shipDate ?? new Date('2026-09-01T12:00:00.000Z'),
      trackingCheckedAt: input.trackingStatus ? new Date('2026-08-01T00:00:00.000Z') : null,
    })
    .returning();
  return row!.id;
}

// ---------------------------------------------------------------------------
// Fixture: the acceptance matrix

type Bucket = 'pending' | 'shipped' | 'cancelled';
type Fulfillment = 'pending' | 'shipped' | 'cancelled' | 'voided';

type OrderExpectation = {
  key: string;
  id: number;
  clientId: number;
  orderNumber: string;
  bucket: Bucket;
  fulfillment: Fulfillment;
  /** expected displayTrackingNumber on the order DTO (null = none) */
  displayTrackingNumber: string | null;
  /** expected customerShippingRatePending on the order DTO */
  ratePending: boolean;
};

type ShipmentExpectation = {
  key: string;
  id: number;
  /** null = excluded from every outbound surface (return / replacement rows) */
  status: PortalShipmentStatus | null;
};

const orderExpectations: OrderExpectation[] = [];
const shipmentExpectations: ShipmentExpectation[] = [];
const orderIdByKey = new Map<string, number>();
const shipmentIdByKey = new Map<string, number>();

function expectOrder(e: Omit<OrderExpectation, 'id'> & { id: number }): void {
  orderExpectations.push(e);
  orderIdByKey.set(e.key, e.id);
}

function expectShipment(key: string, id: number, status: PortalShipmentStatus | null): void {
  shipmentExpectations.push({ key, id, status });
  shipmentIdByKey.set(key, id);
}

function shipmentId(key: string): number {
  const id = shipmentIdByKey.get(key);
  if (id === undefined) throw new Error(`no seeded shipment ${key}`);
  return id;
}

function orderId(key: string): number {
  const id = orderIdByKey.get(key);
  if (id === undefined) throw new Error(`no seeded order ${key}`);
  return id;
}

const DELIVERED_AT = new Date('2026-08-20T15:00:00.000Z');
let clientA = 0;
let clientB = 0;
let returnIdS21 = 0;
let returnIdLive = 0;
let liveReturnShipmentId = 0;

async function seedMatrix(): Promise<void> {
  clientA = await seedClient('CP069 Client A');
  clientB = await seedClient('CP069 Client B');
  const A = clientA;
  const B = clientB;

  // S1 — shipped + active outbound row with delivered telemetry: telemetry is ignored.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S1', orderStatus: 'shipped' });
    const s = await seedShipment({
      orderId: id, clientId: A, orderNumber: 'CP069-S1',
      trackingNumber: 'TRK-S1', labelTracking: 'LBL-S1',
      trackingStatus: 'delivered', deliveredAt: DELIVERED_AT,
    });
    expectOrder({ key: 'S1', id, clientId: A, orderNumber: 'CP069-S1', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'LBL-S1', ratePending: true });
    expectShipment('S1', s, 'shipped');
  }
  // S2 — shipped + active row with NO tracking number: still Shipped, tracking '—'.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S2', orderStatus: 'shipped' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S2', trackingStatus: 'in_transit' });
    expectOrder({ key: 'S2', id, clientId: A, orderNumber: 'CP069-S2', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: null, ratePending: true });
    expectShipment('S2', s, 'shipped');
  }
  // S3 — awaiting order with a non-voided label (in-transit telemetry, future ship date).
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S3', orderStatus: 'awaiting_shipment' });
    const s = await seedShipment({
      orderId: id, clientId: A, orderNumber: 'CP069-S3', trackingNumber: 'TRK-S3',
      trackingStatus: 'in_transit', shipDate: new Date('2030-01-01T00:00:00.000Z'),
    });
    expectOrder({ key: 'S3', id, clientId: A, orderNumber: 'CP069-S3', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: 'TRK-S3', ratePending: true });
    expectShipment('S3', s, 'label_created');
  }
  // S4 — cancelled, no rows.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S4', orderStatus: 'cancelled' });
    expectOrder({ key: 'S4', id, clientId: A, orderNumber: 'CP069-S4', bucket: 'cancelled', fulfillment: 'cancelled', displayTrackingNumber: null, ratePending: false });
  }
  // S5 — cancelled order with a live (non-voided) outbound label.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S5', orderStatus: 'cancelled' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S5', trackingNumber: 'TRK-S5', trackingStatus: 'delivered', deliveredAt: DELIVERED_AT });
    expectOrder({ key: 'S5', id, clientId: A, orderNumber: 'CP069-S5', bucket: 'cancelled', fulfillment: 'cancelled', displayTrackingNumber: 'TRK-S5', ratePending: true });
    expectShipment('S5', s, 'cancelled');
  }
  // S6 — shipped, voided-only outbound rows, externallyFulfilled absent → Voided.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S6', orderStatus: 'shipped' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S6', trackingNumber: 'TRK-S6', voided: true });
    expectOrder({ key: 'S6', id, clientId: A, orderNumber: 'CP069-S6', bucket: 'shipped', fulfillment: 'voided', displayTrackingNumber: null, ratePending: false });
    expectShipment('S6', s, 'voided');
  }
  // S7 — shipped, voided row + active replacement outbound row → Shipped (active wins).
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S7', orderStatus: 'shipped' });
    const v = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S7', trackingNumber: 'TRK-S7-V', voided: true });
    const a = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S7', trackingNumber: 'TRK-S7-A' });
    expectOrder({ key: 'S7', id, clientId: A, orderNumber: 'CP069-S7', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S7-A', ratePending: true });
    expectShipment('S7-V', v, 'voided');
    expectShipment('S7-A', a, 'shipped');
  }
  // S8 — externally_shipped=true on an awaiting order, no rows → Shipped.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S8', orderStatus: 'awaiting_shipment', externallyShipped: true });
    expectOrder({ key: 'S8', id, clientId: A, orderNumber: 'CP069-S8', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: null, ratePending: false });
  }
  // S9 — raw.externallyFulfilled=true + voided-only rows → Shipped (#1298).
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S9', orderStatus: 'shipped', raw: { externallyFulfilled: true } });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S9', trackingNumber: 'TRK-S9', voided: true });
    expectOrder({ key: 'S9', id, clientId: A, orderNumber: 'CP069-S9', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: null, ratePending: false });
    expectShipment('S9', s, 'voided');
  }
  // S10 — raw.externallyFulfilled=false + voided-only rows → Voided.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S10', orderStatus: 'shipped', raw: { externallyFulfilled: false } });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S10', trackingNumber: 'TRK-S10', voided: true });
    expectOrder({ key: 'S10', id, clientId: A, orderNumber: 'CP069-S10', bucket: 'shipped', fulfillment: 'voided', displayTrackingNumber: null, ratePending: false });
    expectShipment('S10', s, 'voided');
  }
  // S11 — raw.externallyFulfilled is a garbage string + voided-only rows → Voided, and the
  // list must not throw (no SQL ::boolean cast of the raw value).
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S11', orderStatus: 'shipped', raw: { externallyFulfilled: 'yes' } });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S11', trackingNumber: 'TRK-S11', voided: true });
    expectOrder({ key: 'S11', id, clientId: A, orderNumber: 'CP069-S11', bucket: 'shipped', fulfillment: 'voided', displayTrackingNumber: null, ratePending: false });
    expectShipment('S11', s, 'voided');
  }
  // S12 — shipped, no rows, not external (missing shipment sync) → Shipped.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S12', orderStatus: 'shipped' });
    expectOrder({ key: 'S12', id, clientId: A, orderNumber: 'CP069-S12', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: null, ratePending: false });
  }
  // S13 — canonical_status cancelled while order_status shipped, live label, delivered telemetry.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S13', orderStatus: 'shipped', canonicalStatus: 'cancelled' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S13', trackingNumber: 'TRK-S13', trackingStatus: 'delivered', deliveredAt: DELIVERED_AT });
    expectOrder({ key: 'S13', id, clientId: A, orderNumber: 'CP069-S13', bucket: 'cancelled', fulfillment: 'cancelled', displayTrackingNumber: 'TRK-S13', ratePending: true });
    expectShipment('S13', s, 'cancelled');
  }
  // S14 — canonical_status cancelled while order_status awaiting_shipment (webhook hold).
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S14', orderStatus: 'awaiting_shipment', canonicalStatus: 'cancelled' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S14', trackingNumber: 'TRK-S14' });
    expectOrder({ key: 'S14', id, clientId: A, orderNumber: 'CP069-S14', bucket: 'cancelled', fulfillment: 'cancelled', displayTrackingNumber: 'TRK-S14', ratePending: true });
    expectShipment('S14', s, 'cancelled');
  }
  // S15 / S16 — canonical shipped_pending_confirmation / confirmation_failed + shipped.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S15', orderStatus: 'shipped', canonicalStatus: 'shipped_pending_confirmation' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S15', trackingNumber: 'TRK-S15' });
    expectOrder({ key: 'S15', id, clientId: A, orderNumber: 'CP069-S15', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S15', ratePending: true });
    expectShipment('S15', s, 'shipped');
  }
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S16', orderStatus: 'shipped', canonicalStatus: 'confirmation_failed' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S16', trackingNumber: 'TRK-S16' });
    expectOrder({ key: 'S16', id, clientId: A, orderNumber: 'CP069-S16', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S16', ratePending: true });
    expectShipment('S16', s, 'shipped');
  }
  // S17 — reopened: awaiting_shipment with voided-only rows → Awaiting shipment.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S17', orderStatus: 'awaiting_shipment' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S17', trackingNumber: 'TRK-S17', voided: true });
    expectOrder({ key: 'S17', id, clientId: A, orderNumber: 'CP069-S17', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: null, ratePending: false });
    expectShipment('S17', s, 'voided');
  }
  // S18 — on_hold with a non-voided row → pending bucket; row is Label Created.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S18', orderStatus: 'on_hold' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S18', trackingNumber: 'TRK-S18' });
    expectOrder({ key: 'S18', id, clientId: A, orderNumber: 'CP069-S18', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: 'TRK-S18', ratePending: true });
    expectShipment('S18', s, 'label_created');
  }
  // S19 / S20 — 'refunded' and 'canceled' (US spelling) are NOT cancelled: pending, as PrepShip.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S19', orderStatus: 'refunded' });
    const s = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S19', trackingNumber: 'TRK-S19' });
    expectOrder({ key: 'S19', id, clientId: A, orderNumber: 'CP069-S19', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: 'TRK-S19', ratePending: true });
    expectShipment('S19', s, 'label_created');
  }
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S20', orderStatus: 'canceled' });
    expectOrder({ key: 'S20', id, clientId: A, orderNumber: 'CP069-S20', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: null, ratePending: false });
  }
  // S21 — shipped, voided outbound + an ACTIVE return label (is_return) with a returns row:
  // the order badge is decided by its outbound rows only → Voided; the return label's number
  // is never the order's tracking number; no "Pending" rate from a return label.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S21', orderStatus: 'shipped' });
    const v = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S21', trackingNumber: 'TRK-S21-V', voided: true });
    const r = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S21', trackingNumber: 'TRK-S21-R', isReturn: true, trackingStatus: 'in_transit' });
    const [ret] = await db
      .insert(schema.returns)
      .values({
        orderId: id,
        clientId: A,
        returnShipmentId: r,
        returnReference: 'CP069-S21-RETURN',
        status: 'label_created',
        initiatedBy: 'client',
        reason: 'CP-069 fixture',
      })
      .returning();
    returnIdS21 = ret!.id;
    expectOrder({ key: 'S21', id, clientId: A, orderNumber: 'CP069-S21', bucket: 'shipped', fulfillment: 'voided', displayTrackingNumber: null, ratePending: false });
    expectShipment('S21-V', v, 'voided');
    expectShipment('S21-R', r, null);
  }
  // RET-LIVE — a shipped order whose ONLY row is a LIVE (trackable, non-offline) return label:
  // outbound rows none → PS missing_shipment_sync → Shipped; the return label never lists on the
  // outbound surfaces; scenario 4 uses it to prove the returns refresh scope check discriminates.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-RET-LIVE', orderStatus: 'shipped' });
    const r = await seedShipment({
      orderId: id, clientId: A, orderNumber: 'CP069-RET-LIVE',
      trackingNumber: 'TRK-RET-LIVE', isReturn: true, source: 'prepship_return_v2',
    });
    const [ret] = await db
      .insert(schema.returns)
      .values({
        orderId: id,
        clientId: A,
        returnShipmentId: r,
        returnReference: 'CP069-RET-LIVE-RETURN',
        status: 'label_created',
        initiatedBy: 'client',
        reason: 'CP-069 fixture (live label)',
      })
      .returning();
    returnIdLive = ret!.id;
    liveReturnShipmentId = r;
    expectOrder({ key: 'RET-LIVE', id, clientId: A, orderNumber: 'CP069-RET-LIVE', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: null, ratePending: false });
    expectShipment('RET-LIVE-R', r, null);
  }
  // S22 — multi-shipment partial: two active rows + one voided → Shipped, newest active tracking.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S22', orderStatus: 'shipped' });
    const a = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S22', trackingNumber: 'TRK-S22-A' });
    const b = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S22', trackingNumber: 'TRK-S22-B' });
    const v = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S22', trackingNumber: 'TRK-S22-V', voided: true });
    expectOrder({ key: 'S22', id, clientId: A, orderNumber: 'CP069-S22', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S22-B', ratePending: true });
    expectShipment('S22-A', a, 'shipped');
    expectShipment('S22-B', b, 'shipped');
    expectShipment('S22-V', v, 'voided');
  }
  // S23 — order_id-null row whose order_number matches an OLDER awaiting order and a NEWER
  // shipped order of the same client (Walmart-direct duplicate + ShipStation copy), and the
  // same order_number also exists for client B. The row resolves to the same-client shipped
  // order; each order evaluates its own (tenant-scoped) outbound match; B's order is untouched.
  {
    const older = await seedOrder({ clientId: A, orderNumber: 'CP069-S23', orderStatus: 'awaiting_shipment' });
    const newer = await seedOrder({ clientId: A, orderNumber: 'CP069-S23', orderStatus: 'shipped' });
    const s = await seedShipment({ orderId: null, clientId: A, orderNumber: 'CP069-S23', trackingNumber: 'TRK-S23' });
    expectOrder({ key: 'S23-awaiting', id: older, clientId: A, orderNumber: 'CP069-S23', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: 'TRK-S23', ratePending: true });
    expectOrder({ key: 'S23-shipped', id: newer, clientId: A, orderNumber: 'CP069-S23', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S23', ratePending: true });
    expectShipment('S23', s, 'shipped');
    const bOrder = await seedOrder({ clientId: B, orderNumber: 'CP069-S23', orderStatus: 'awaiting_shipment' });
    expectOrder({ key: 'B-S23', id: bOrder, clientId: B, orderNumber: 'CP069-S23', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: null, ratePending: false });
  }
  // S23b — the shipped-preferring rule beats "newest": shipped order OLDER, awaiting NEWER.
  {
    const shipped = await seedOrder({ clientId: A, orderNumber: 'CP069-S23B', orderStatus: 'shipped' });
    const awaiting = await seedOrder({ clientId: A, orderNumber: 'CP069-S23B', orderStatus: 'awaiting_shipment' });
    const s = await seedShipment({ orderId: null, clientId: A, orderNumber: 'CP069-S23B', trackingNumber: 'TRK-S23B' });
    expectOrder({ key: 'S23B-shipped', id: shipped, clientId: A, orderNumber: 'CP069-S23B', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S23B', ratePending: true });
    expectOrder({ key: 'S23B-awaiting', id: awaiting, clientId: A, orderNumber: 'CP069-S23B', bucket: 'pending', fulfillment: 'pending', displayTrackingNumber: 'TRK-S23B', ratePending: true });
    expectShipment('S23B', s, 'shipped');
  }
  // S24 — order_id-null rows of client A whose order_number exists ONLY for client B (a
  // shipped order with no rows of its own): A sees Unavailable / Voided; B's order never sees
  // the rows (stays Shipped via missing-sync, not Voided; no tracking number leaks).
  {
    const bOrder = await seedOrder({ clientId: B, orderNumber: 'CP069-S24', orderStatus: 'shipped' });
    const a = await seedShipment({ orderId: null, clientId: A, orderNumber: 'CP069-S24', trackingNumber: 'TRK-S24-A' });
    const v = await seedShipment({ orderId: null, clientId: A, orderNumber: 'CP069-S24', trackingNumber: 'TRK-S24-V', voided: true });
    expectOrder({ key: 'B-S24', id: bOrder, clientId: B, orderNumber: 'CP069-S24', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: null, ratePending: false });
    expectShipment('S24-A', a, 'unavailable');
    expectShipment('S24-V', v, 'voided');
  }
  // S25 — orphan: order_id null, no order with that number anywhere → Unavailable.
  {
    const s = await seedShipment({ orderId: null, clientId: A, orderNumber: 'CP069-ORPHAN', trackingNumber: 'TRK-ORPHAN' });
    expectShipment('S25', s, 'unavailable');
  }
  // S26 — replacement vessel rows (source='replacement'): the orderless PS shape, plus a
  // defensively-linked one with no tracking. Both are excluded from the outbound list and the
  // drill-in; the original order keeps its own Shipped badge and tracking number.
  {
    const id = await seedOrder({ clientId: A, orderNumber: 'CP069-S26', orderStatus: 'shipped' });
    const a = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S26', trackingNumber: 'TRK-S26' });
    const vessel = await seedShipment({ orderId: null, clientId: A, orderNumber: 'CP069-S26-REPLACE', trackingNumber: 'TRK-S26-REPLACE', source: 'replacement' });
    const linked = await seedShipment({ orderId: id, clientId: A, orderNumber: 'CP069-S26', source: 'replacement' });
    expectOrder({ key: 'S26', id, clientId: A, orderNumber: 'CP069-S26', bucket: 'shipped', fulfillment: 'shipped', displayTrackingNumber: 'TRK-S26', ratePending: true });
    expectShipment('S26-A', a, 'shipped');
    expectShipment('S26-REPLACE', vessel, null);
    expectShipment('S26-REPLACE-LINKED', linked, null);
  }
}

// ---------------------------------------------------------------------------
// Scenario 1 — orders read-model: badge, tabs, awaiting count, tracking, rate pending

type OrderDto = {
  id: number;
  clientId: number | null;
  fulfillmentStatus: string;
  displayTrackingNumber: string | null;
  customerShippingRatePending?: boolean;
};

async function ordersScenario(): Promise<void> {
  console.log('\nScenario 1: orders read-model — badge per matrix row, tabs, awaiting count');
  const scopeA = scopeFor([clientA]);
  const all = await listPortalOrders(scopeA, { page: 1, pageSize: 200, search: '' });
  const expectedA = orderExpectations.filter((e) => e.clientId === clientA);
  equal(all.pagination.total, expectedA.length, 'unfiltered list total = every client-A order');
  sameIdSet(all.data.map((o: OrderDto) => o.id), expectedA.map((e) => e.id), 'unfiltered list = exactly client A\'s orders');
  const byId = new Map<number, OrderDto>(all.data.map((o: OrderDto) => [o.id, o]));

  for (const e of expectedA) {
    const dto = byId.get(e.id);
    equal(dto?.fulfillmentStatus, e.fulfillment, `${e.key}: list fulfillmentStatus`);
    equal(dto?.displayTrackingNumber, e.displayTrackingNumber, `${e.key}: list displayTrackingNumber`);
    equal(dto?.customerShippingRatePending, e.ratePending, `${e.key}: list customerShippingRatePending`);
    const detail = (await getPortalOrder(scopeA, e.id)) as OrderDto | null;
    equal(detail?.fulfillmentStatus, e.fulfillment, `${e.key}: detail fulfillmentStatus`);
    equal(detail?.displayTrackingNumber, e.displayTrackingNumber, `${e.key}: detail displayTrackingNumber`);
  }
  check(
    !all.data.some((o: OrderDto) => o.displayTrackingNumber === 'TRK-S21-R'),
    'a return label\'s tracking number is never an order\'s displayTrackingNumber',
  );

  const tabs: Array<{ status: PortalOrderStatusFilter; bucket: Bucket }> = [
    { status: 'awaiting_shipment', bucket: 'pending' },
    { status: 'shipped', bucket: 'shipped' },
    { status: 'cancelled', bucket: 'cancelled' },
  ];
  let tabTotal = 0;
  for (const tab of tabs) {
    const page = await listPortalOrders(scopeA, { page: 1, pageSize: 200, status: tab.status, search: '' });
    const want = expectedA.filter((e) => e.bucket === tab.bucket).map((e) => e.id);
    sameIdSet(page.data.map((o: OrderDto) => o.id), want, `tab ${tab.status} membership`);
    equal(page.pagination.total, want.length, `tab ${tab.status} total`);
    tabTotal += page.pagination.total;
    if (tab.status === 'awaiting_shipment') {
      const count = await awaitingActiveOrderCount(scopeA, {});
      equal(count, page.pagination.total, 'awaitingActiveOrderCount equals the Awaiting tab total');
      check(page.data.every((o: OrderDto) => o.fulfillmentStatus === 'pending'), 'every Awaiting-tab row carries the pending badge');
    }
    if (tab.status === 'shipped') {
      check(
        page.data.every((o: OrderDto) => o.fulfillmentStatus === 'shipped' || o.fulfillmentStatus === 'voided'),
        'Shipped tab rows are Shipped or Voided, never anything else',
      );
    }
    if (tab.status === 'cancelled') {
      check(page.data.every((o: OrderDto) => o.fulfillmentStatus === 'cancelled'), 'every Cancelled-tab row carries the cancelled badge');
    }
  }
  equal(tabTotal, all.pagination.total, 'the three tabs partition the unfiltered list');
  const explicitAll = await listPortalOrders(scopeA, { page: 1, pageSize: 200, status: null, search: '' });
  equal(explicitAll.pagination.total, all.pagination.total, 'status null = unfiltered');
}

// ---------------------------------------------------------------------------
// Scenario 2 — shipments read-model: default list, each status filter, exclusions

type ShipmentDto = { id: number; shipmentStatus: string; displayTrackingNumber: string | null; customerShippingRatePending: boolean };

async function shipmentsScenario(): Promise<void> {
  console.log('\nScenario 2: shipments read-model — default list, status filters, exclusions');
  const scopeA = scopeFor([clientA]);
  const listed = shipmentExpectations.filter((e) => e.status !== null);
  const defaultExpected = listed.filter((e) => e.status !== 'voided');

  const page = await listPortalShipments(scopeA, { page: 1, pageSize: 200, search: '' });
  sameIdSet(page.data.map((s: ShipmentDto) => s.id), defaultExpected.map((e) => e.id), 'default list = non-voided outbound rows');
  equal(page.pagination.total, defaultExpected.length, 'default list count');
  const byId = new Map<number, ShipmentDto>(page.data.map((s: ShipmentDto) => [s.id, s]));
  for (const e of defaultExpected) {
    equal(byId.get(e.id)?.shipmentStatus, e.status, `${e.key}: shipmentStatus`);
  }
  check(!byId.has(shipmentId('S21-R')), 'return label row is excluded from the outbound list');
  check(!byId.has(shipmentId('S26-REPLACE')), 'orderless replacement vessel is excluded from the outbound list');
  check(!byId.has(shipmentId('S26-REPLACE-LINKED')), 'order-linked replacement row is excluded from the outbound list');
  check(
    page.data.every((s: ShipmentDto) => !('deliveredAt' in s) && !('shipmentStatusDetail' in s)),
    'shipment DTOs carry no deliveredAt / shipmentStatusDetail',
  );

  const statuses: PortalShipmentStatus[] = ['shipped', 'label_created', 'cancelled', 'voided', 'unavailable'];
  for (const status of statuses) {
    const filtered = await listPortalShipments(scopeA, { page: 1, pageSize: 200, search: '', status });
    const want = listed.filter((e) => e.status === status).map((e) => e.id);
    sameIdSet(filtered.data.map((s: ShipmentDto) => s.id), want, `status=${status} rows`);
    equal(filtered.pagination.total, want.length, `status=${status} count`);
    check(filtered.data.every((s: ShipmentDto) => s.shipmentStatus === status), `status=${status} rows all project ${status}`);
  }
  const voided = await listPortalShipments(scopeA, { page: 1, pageSize: 200, search: '', status: 'voided' });
  check(!voided.data.some((s: ShipmentDto) => s.id === shipmentId('S21-R')), 'voided filter never surfaces the return label');
}

// ---------------------------------------------------------------------------
// Scenario 3 — GET /orders, GET /orders/:id/shipments, GET /shipments through the real routers

type ListBody = { data?: Array<{ id: number; shipmentStatus?: string }>; pagination?: { total: number }; error?: string };

async function routesScenario(): Promise<void> {
  console.log('\nScenario 3: routes — GET /orders, GET /orders/:id/shipments, GET /shipments');
  const ordersApp = appFor(ordersRoutes, clientA);
  const shipmentsApp = appFor(shipmentsRoutes, clientA);
  const expectedA = orderExpectations.filter((e) => e.clientId === clientA);

  const bogus = await ordersApp.request('/orders?status=bogus');
  const bogusBody = (await bogus.json()) as ListBody;
  equal(bogus.status, 400, 'GET /orders?status=bogus → 400');
  equal(bogusBody.error, 'Unknown status filter. Expected one of: awaiting_shipment, shipped, cancelled', 'GET /orders?status=bogus error text');
  const raw = await ordersApp.request('/orders?status=delivered');
  equal(raw.status, 400, 'GET /orders?status=delivered (raw order_status vocabulary) → 400');

  const none = (await (await ordersApp.request('/orders?pageSize=200')).json()) as ListBody;
  const all = (await (await ordersApp.request('/orders?pageSize=200&status=all')).json()) as ListBody;
  equal(none.pagination?.total, expectedA.length, 'GET /orders (no status) is unfiltered');
  equal(all.pagination?.total, expectedA.length, 'GET /orders?status=all is unfiltered');
  for (const tab of [['awaiting_shipment', 'pending'], ['shipped', 'shipped'], ['cancelled', 'cancelled']] as const) {
    const body = (await (await ordersApp.request(`/orders?pageSize=200&status=${tab[0]}`)).json()) as ListBody;
    const want = expectedA.filter((e) => e.bucket === tab[1]).map((e) => e.id);
    sameIdSet((body.data ?? []).map((o) => o.id), want, `GET /orders?status=${tab[0]} membership`);
  }

  const drill = async (key: string) => {
    const res = await ordersApp.request(`/orders/${orderId(key)}/shipments`);
    equal(res.status, 200, `GET /orders/${key}/shipments → 200`);
    return ((await res.json()) as ListBody).data ?? [];
  };
  const s21 = await drill('S21');
  sameIdSet(s21.map((s) => s.id), [], 'S21 drill-in: return label and voided outbound both excluded');
  const s26 = await drill('S26');
  sameIdSet(s26.map((s) => s.id), [shipmentId('S26-A')], 'S26 drill-in: replacement rows excluded, active row kept');
  equal(s26[0]?.shipmentStatus, 'shipped', 'S26 drill-in row is shipped');
  const s7 = await drill('S7');
  sameIdSet(s7.map((s) => s.id), [shipmentId('S7-A')], 'S7 drill-in: voided row excluded');
  const s5 = await drill('S5');
  sameIdSet(s5.map((s) => s.id), [shipmentId('S5')], 'S5 drill-in: cancelled order\'s live label listed');
  equal(s5[0]?.shipmentStatus, 'cancelled', 'S5 drill-in row is cancelled');
  const s22 = await drill('S22');
  sameIdSet(s22.map((s) => s.id), [shipmentId('S22-A'), shipmentId('S22-B')], 'S22 drill-in: both active rows, voided excluded');

  const listed = shipmentExpectations.filter((e) => e.status !== null);
  const shippedIds = listed.filter((e) => e.status === 'shipped').map((e) => e.id);
  const defaultIds = listed.filter((e) => e.status !== 'voided').map((e) => e.id);
  const shipmentsList = async (query: string) => {
    const res = await shipmentsApp.request(`/shipments?pageSize=200${query}`);
    equal(res.status, 200, `GET /shipments${query} → 200`);
    return (await res.json()) as ListBody;
  };
  for (const alias of ['delivered', 'in_transit', 'exception', 'attempted']) {
    const body = await shipmentsList(`&status=${alias}`);
    sameIdSet((body.data ?? []).map((s) => s.id), shippedIds, `GET /shipments?status=${alias} aliases to shipped`);
    equal(body.pagination?.total, shippedIds.length, `GET /shipments?status=${alias} count`);
  }
  for (const status of ['shipped', 'label_created', 'cancelled', 'voided', 'unavailable']) {
    const body = await shipmentsList(`&status=${status}`);
    const want = listed.filter((e) => e.status === status).map((e) => e.id);
    sameIdSet((body.data ?? []).map((s) => s.id), want, `GET /shipments?status=${status} rows`);
  }
  const unknown = await shipmentsList('&status=bogus');
  sameIdSet((unknown.data ?? []).map((s) => s.id), defaultIds, 'GET /shipments?status=bogus is the unfiltered default list');
  const plain = await shipmentsList('');
  sameIdSet((plain.data ?? []).map((s) => s.id), defaultIds, 'GET /shipments (no status) is the default list');
}

// ---------------------------------------------------------------------------
// Scenario 4 — POST /returns/refresh-tracking is returns-scoped and offline-safe

type RefreshBody = { checked?: unknown; failed?: unknown; updated?: unknown; error?: unknown };

async function returnsRefreshScenario(): Promise<void> {
  console.log('\nScenario 4: POST /returns/refresh-tracking — scope check, counts-only response');
  networkCalls = 0;
  const post = async (clientId: number, body: unknown) =>
    appFor(returnsRoutes, clientId).request('/returns/refresh-tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const crossTenant = await post(clientB, { returnIds: [returnIdS21] });
  const crossBody = (await crossTenant.json()) as RefreshBody;
  equal(crossTenant.status, 200, 'client-B scope asking for a client-A return → 200');
  equal(JSON.stringify(crossBody), JSON.stringify({ checked: 0, failed: 0, updated: 0 }), 'client-B scope gets {checked:0,failed:0,updated:0}');
  equal(networkCalls, 0, 'client-B scope triggers no carrier lookup');

  const inScope = await post(clientA, { returnIds: [returnIdS21, 999999, -1, 'x'] });
  const inScopeBody = (await inScope.json()) as RefreshBody;
  equal(inScope.status, 200, 'in-scope refresh → 200 (does not throw)');
  equal(typeof inScopeBody.checked, 'number', 'response.checked is a number');
  equal(typeof inScopeBody.failed, 'number', 'response.failed is a number');
  equal(typeof inScopeBody.updated, 'number', 'response.updated is a number (count, not a list)');
  equal(Object.keys(inScopeBody).sort().join(','), 'checked,failed,updated', 'response carries counts only');
  equal(inScopeBody.checked, 0, 'test_offline return label is not trackable → checked 0');
  equal(networkCalls, 0, 'in-scope refresh makes no network call for an offline label');

  const empty = await post(clientA, {});
  equal(JSON.stringify(await empty.json()), JSON.stringify({ checked: 0, failed: 0, updated: 0 }), 'empty body → zero counts');

  const [ret] = await db
    .select({ status: schema.returns.status })
    .from(schema.returns)
    .where(rawSql`${schema.returns.id} = ${returnIdS21}`);
  equal(ret?.status, 'label_created', 'the return status is unchanged by an offline refresh');

  // The scope check must be DISCRIMINATING: RET-LIVE is a LIVE (trackable) return label for
  // client A that the refresh service would actually look up. The blocked fetch / missing
  // credentials make every lookup fail, so the in-scope call records a failed lookup
  // (trackingFailedAt) on that shipment while the cross-tenant call must not touch it at all.
  // Without returnScopePredicate both calls would look identical on the offline label above.
  const liveShipment = liveReturnShipmentId;
  const liveReturn = { id: returnIdLive };
  const failedAtOf = async () => {
    const [row] = await db
      .select({ trackingFailedAt: schema.shipments.trackingFailedAt, trackingCheckedAt: schema.shipments.trackingCheckedAt })
      .from(schema.shipments)
      .where(rawSql`${schema.shipments.id} = ${liveShipment}`);
    return row!;
  };
  const crossLive = await post(clientB, { returnIds: [liveReturn!.id] });
  const crossLiveBody = (await crossLive.json()) as RefreshBody;
  equal(JSON.stringify(crossLiveBody), JSON.stringify({ checked: 0, failed: 0, updated: 0 }), 'client-B scope cannot reach client A\'s LIVE return label (counts stay zero)');
  const untouched = await failedAtOf();
  equal(untouched.trackingFailedAt, null, 'the cross-tenant call never ran the refresh service on the live label');
  equal(untouched.trackingCheckedAt, null, 'the cross-tenant call never advanced the live label\'s check clock');
  const inScopeLive = await post(clientA, { returnIds: [liveReturn!.id] });
  const inScopeLiveBody = (await inScopeLive.json()) as RefreshBody;
  equal(inScopeLive.status, 200, 'in-scope refresh of a live label → 200 even though every lookup is blocked');
  check(Number(inScopeLiveBody.checked) + Number(inScopeLiveBody.failed) >= 1, `in-scope refresh actually attempted the live label (checked ${String(inScopeLiveBody.checked)}, failed ${String(inScopeLiveBody.failed)})`);
  const touched = await failedAtOf();
  check(touched.trackingFailedAt !== null || touched.trackingCheckedAt !== null, 'the in-scope call ran the refresh service on the resolved return shipment (failed/checked clock written)');
  // The one lookup the service attempted is exactly the network request the harness blocks —
  // proof the resolved shipment id reached the carrier lookup. Reset so the suite-wide
  // "no unexpected network" assertion still holds.
  check(networkCalls >= 1, `the in-scope live refresh attempted a carrier lookup that the harness blocked (${networkCalls})`);
  networkCalls = 0;
  const [liveRet] = await db
    .select({ status: schema.returns.status })
    .from(schema.returns)
    .where(rawSql`${schema.returns.id} = ${liveReturn!.id}`);
  equal(liveRet?.status, 'label_created', 'a failed lookup never advances the return lifecycle');
}

// ---------------------------------------------------------------------------
// Scenario 5 — TS twin ⇄ SQL twin agreement for every seeded order

async function twinScenario(): Promise<void> {
  console.log('\nScenario 5: resolvePortalOrderFulfillmentBucket (TS) == portalOrderFulfillmentBucketSql (SQL)');
  const rows = await db
    .select({
      id: schema.orders.id,
      orderStatus: schema.orders.orderStatus,
      canonicalStatus: schema.orders.canonicalStatus,
      externallyShipped: schema.orders.externallyShipped,
      sqlBucket: portalOrderFulfillmentBucketSql(),
    })
    .from(schema.orders);
  equal(rows.length, orderExpectations.length, 'every seeded order is evaluated');
  for (const row of rows) {
    const ts = resolvePortalOrderFulfillmentBucket({
      orderStatus: row.orderStatus,
      canonicalStatus: row.canonicalStatus,
      externallyShipped: row.externallyShipped,
    });
    const expectation = orderExpectations.find((e) => e.id === row.id);
    const rawResult = await db.execute(
      rawSql`select ${portalOrderFulfillmentBucketSql()} as bucket from ${schema.orders} where ${schema.orders.id} = ${row.id}`,
    );
    const rawRows = (Array.isArray(rawResult) ? rawResult : (rawResult as { rows?: unknown[] }).rows ?? []) as Array<{ bucket: string }>;
    const rawBucket = rawRows[0]?.bucket;
    equal(ts, row.sqlBucket, `${expectation?.key ?? row.id}: TS twin == SQL twin (drizzle select)`);
    equal(ts, rawBucket, `${expectation?.key ?? row.id}: TS twin == SQL twin (raw db.execute)`);
    equal(ts, expectation?.bucket, `${expectation?.key ?? row.id}: bucket matches the matrix`);
  }
}

// ---------------------------------------------------------------------------
// Scenario 6 — tenant isolation

async function tenantScenario(): Promise<void> {
  console.log('\nScenario 6: tenant isolation — client B never sees A\'s rows; collisions stay per-tenant');
  const scopeB = scopeFor([clientB]);
  const expectedB = orderExpectations.filter((e) => e.clientId === clientB);
  const ordersB = await listPortalOrders(scopeB, { page: 1, pageSize: 200, search: '' });
  sameIdSet(ordersB.data.map((o: OrderDto) => o.id), expectedB.map((e) => e.id), 'client B order list = exactly B\'s orders');
  for (const e of expectedB) {
    const dto = ordersB.data.find((o: OrderDto) => o.id === e.id) as OrderDto | undefined;
    equal(dto?.fulfillmentStatus, e.fulfillment, `${e.key}: B keeps its own badge`);
    equal(dto?.displayTrackingNumber, e.displayTrackingNumber, `${e.key}: A's orderless row never leaks a tracking number to B`);
    equal(dto?.customerShippingRatePending, e.ratePending, `${e.key}: A's orderless row never makes B's rate Pending`);
  }
  const awaitingB = await listPortalOrders(scopeB, { page: 1, pageSize: 200, status: 'awaiting_shipment', search: '' });
  sameIdSet(awaitingB.data.map((o: OrderDto) => o.id), [orderId('B-S23')], 'B Awaiting tab = its collision order only');
  equal(await awaitingActiveOrderCount(scopeB, {}), 1, 'B awaiting count = 1');
  const crossDetail = await getPortalOrder(scopeB, orderId('S1'));
  equal(crossDetail, null, 'B cannot read A\'s order detail');
  const shipmentsB = await listPortalShipments(scopeB, { page: 1, pageSize: 200, search: '' });
  equal(shipmentsB.pagination.total, 0, 'B has no outbound shipments (A\'s S23/S24 rows are A\'s)');
  const voidedB = await listPortalShipments(scopeB, { page: 1, pageSize: 200, search: '', status: 'voided' });
  equal(voidedB.pagination.total, 0, 'B sees none of A\'s voided rows');
  const drill = await appFor(ordersRoutes, clientB).request(`/orders/${orderId('S5')}/shipments`);
  equal(((await drill.json()) as ListBody).data?.length, 0, 'B drill-in on A\'s order returns no rows');
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Scenario 7 — PrepShip-unattributed labels (order_id NULL AND client_id NULL, PS-467 shipment-sync)
// never match the tenant-scoped fallback: 'unavailable' for a global scope, invisible to the
// client, and never the order's tracking number. Plus: the future ship date renders as stored.

async function unattributedOrphanScenario(): Promise<void> {
  console.log('\nScenario 7: client-less unattributed label + future ship date');
  const s1 = orderExpectations.find((e) => e.key === 'S1')!;
  const orphan = await seedShipment({ orderId: null, clientId: null, orderNumber: s1.orderNumber, trackingNumber: 'TRK-NULLNULL' });
  const adminList = await listPortalShipments(scopeFor([]), { page: 1, pageSize: 500, search: '' });
  const adminRow = adminList.data.find((row: { id: number }) => row.id === orphan) as { shipmentStatus?: string } | undefined;
  equal(adminRow?.shipmentStatus, 'unavailable', 'a global scope sees the client-less orphan as unavailable (no tenant-scoped order match)');
  const clientList = await listPortalShipments(scopeFor([clientA]), { page: 1, pageSize: 500, search: '' });
  equal(clientList.data.some((row: { id: number }) => row.id === orphan), false, 'the client scope never sees a client-less row');
  const s1Detail = await getPortalOrder(scopeFor([clientA]), s1.id);
  equal(s1Detail?.displayTrackingNumber, 'LBL-S1', 'the orphan never becomes the order\'s tracking number');
  equal(s1Detail?.fulfillmentStatus, 'shipped', 'the order badge is unchanged by the orphan');
  const s3 = shipmentExpectations.find((e) => e.key === 'S3')!;
  const s3Row = clientList.data.find((row: { id: number }) => row.id === s3.id) as { shipDate?: string | null; shipmentStatus?: string } | undefined;
  equal(s3Row?.shipDate, '2030-01-01T00:00:00.000Z', 'a future ship_date renders as stored');
  equal(s3Row?.shipmentStatus, 'label_created', 'and does not influence the status');
}

async function main(): Promise<void> {
  await reset();
  await seedMatrix();
  console.log(`seeded ${orderExpectations.length} orders and ${shipmentExpectations.length} shipments for clients ${clientA}/${clientB}`);
  await ordersScenario();
  await shipmentsScenario();
  await routesScenario();
  await returnsRefreshScenario();
  await twinScenario();
  await tenantScenario();
  await unattributedOrphanScenario();
  equal(networkCalls, 0, 'the whole suite made zero network requests');
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\nPASS CP-069 orders/shipments fulfillment display integration suite.\n'
      : `\nFAIL ${failures} CP-069 fulfillment display assertion(s) failed.\n`,
  );
} catch (error) {
  console.error('\nFAIL CP-069 fulfillment display suite errored:', error instanceof Error ? error.stack : error);
} finally {
  globalThis.fetch = originalFetch;
  try {
    await reset();
  } catch {
    // Best-effort cleanup only; setupTestEnv already guarantees a throwaway DB.
  }
  await pgClient.end({ timeout: 2 });
  process.exit(exitCode);
}
