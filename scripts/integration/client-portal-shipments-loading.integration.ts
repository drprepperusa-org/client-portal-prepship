import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';

setupTestEnv();
const { db, sql } = await import('../../src/db/client');
let active = 0, peak = 0, reads = 0, delayMs = 40;
// Execute the real query and bound parameters; only add I/O delay for the
// round-trip scenario. Native runs use zero added delay.
function measured(query: any): any {
  return new Proxy(query, { get(target, property) {
    if (property === 'then') return (resolve: any, reject: any) => {
      reads++; active++; peak = Math.max(peak, active);
      return (async () => {
        try {
          if (delayMs) await new Promise(done => setTimeout(done, delayMs));
          return await target.execute();
        } finally { active--; }
      })().then(resolve, reject);
    };
    const value = Reflect.get(target, property);
    if (typeof value !== 'function') return value;
    return (...args: any[]) => {
      const result = value.apply(target, args);
      return ['from', 'leftJoin', 'where', 'orderBy', 'limit', 'offset'].includes(String(property)) ? measured(result) : result;
    };
  } });
}
const { listPortalShipments } = loadFixtureModule('src/lib/client-portal/read-models/shipments.ts', {
  '../../../db/client': { db: { select: (...args: any[]) => measured((db.select as any)(...args)) } },
});
const scope = (clientIds: number[], storeIds: number[] = [], global = false, financials = true) => ({
  userId: 'shipments-fixture', clientIds, storeIds, isGlobal: global, isRestricted: !global,
  permissions: [], canViewFinancials: financials, canViewCredentials: false,
});
const opts = { page: 1, pageSize: 50, search: '' };
try {
  await sql`truncate shipments, orders, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, store_ids) values ('Ship Alpha', array[9901]), ('Ship Beta', array[9902]) returning id`;
  assert.ok(a && b);
  const [oa, ob] = await sql`insert into orders(client_id, store_id, order_number, order_status, items)
    values (${a.id}, 9901, 'SHARED-100', 'shipped', '[{"name":"First","sku":"SKU-A","quantity":2}]'),
      (${b.id}, 9902, 'SHARED-100', 'shipped', '[]') returning id`;
  assert.ok(oa && ob);
  const [sa, orphan, sb] = await sql`insert into shipments(order_id, client_id, order_number, tracking_number, label_tracking,
    ship_date, carrier_code, service_code, cost, tracking_status)
    values (${oa.id}, ${a.id}, 'SHARED-100', 'LEGACY-A', 'CANON-A', '2026-09-14', 'ups', 'internal-service', 1, 'exception'),
      (null, ${a.id}, 'ORPHAN-4002', 'ORPHAN-TRACK', null, '2026-09-13', 'ups', 'internal-service', 2, null),
      (${ob.id}, ${b.id}, 'SHARED-100', 'B-TRACK', null, '2026-09-12', 'ups', 'internal-service', 3, null) returning id`;
  assert.ok(sa && orphan && sb);
  await sql`insert into shipments(order_id, client_id, order_number, voided, is_return, source)
    values (${oa.id}, ${a.id}, 'VOID', true, false, null), (${oa.id}, ${a.id}, 'RETURN', false, true, null),
      (${oa.id}, ${a.id}, 'REPLACE', false, false, 'replacement'), (null, null, 'SEAuto-hidden', false, false, null)`;
  await sql`insert into billing_line_items(client_id, order_id, shipment_id, line_type, description, unit_cost, total_cost)
    values (${a.id}, ${oa.id}, ${sa.id}, 'shipping', 'Frozen shipping', 8.75, 8.75)`;
  const alpha = scope([a.id]), admin = scope([], [], true);
  // Warm the owner/pool before timing so first-use connection setup is excluded.
  delayMs = 0;
  await listPortalShipments(alpha, opts);
  reads = 0; peak = 0; delayMs = 40;
  const before = performance.now();
  const initial = await listPortalShipments(alpha, opts);
  console.log(JSON.stringify({ scenario: '40ms added per database read', elapsedMs: Math.round(performance.now() - before), reads, peak }));
  const initialPeak = peak;
  assert.equal(reads, 2);
  assert.equal(active, 0);
  assert.equal(initial.pagination.total, 2);
  assert.deepEqual(initial.data.map((row: any) => row.id), [sa.id, orphan.id]);
  assert.equal(initial.data[0].shipmentStatus, 'shipped', 'carrier exception does not change fulfillment status');
  assert.equal(initial.data[0].displayTrackingNumber, 'CANON-A');
  assert.equal(Number(initial.data[0].customerShippingRate), 8.75, 'frozen billing rate, not carrier cost');
  assert.equal(initial.data[0].carrierCode, null);
  assert.equal(initial.data[0].serviceCode, null);
  delayMs = 0;
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await listPortalShipments(alpha, opts);
    times.push(performance.now() - start);
  }
  times.sort((x, y) => x - y);
  console.log(JSON.stringify({ scenario: '20 native PostgreSQL reads', medianMs: Math.round(times[10]!), p95Ms: Math.round(times[18]!) }));
  const list = (search: string, caller = alpha, extra = {}) => listPortalShipments(caller, { ...opts, search, ...extra });
  for (const search of ['CANON-A', 'LEGACY-A', 'SHARED-100']) {
    assert.deepEqual((await list(search)).data.map((row: any) => row.id), [sa.id]);
  }
  assert.deepEqual((await list('ORPHAN-4002')).data.map((row: any) => row.id), [orphan.id], 'search finds the displayed shipment order number without an order link');
  assert.equal((await list('ORPHAN-TRACK')).pagination.total, 1);
  assert.equal((await list('B-TRACK')).pagination.total, 0, 'search never widens client scope');
  assert.equal((await list('', admin, { clientId: b.id })).pagination.total, 1);
  assert.equal((await list('', admin, { storeId: 9902 })).pagination.total, 1);
  assert.equal((await list('', alpha, { clientId: b.id })).pagination.total, 0);
  assert.equal((await list('', scope([], [9902]))).pagination.total, 1);
  assert.equal((await list('', alpha, { status: 'voided' })).pagination.total, 1);
  assert.equal((await list('', alpha, { status: 'shipped' })).pagination.total, 1);
  const second = await list('', alpha, { page: 2, pageSize: 1, sortBy: 'order', sortDir: 'asc' });
  assert.equal(second.data[0].id, sa.id);
  assert.equal(second.pagination.totalPages, 2);
  assert.equal((await list('', alpha, { page: 99 })).data.length, 0);
  assert.equal((await list('CANON-A', scope([a.id], [], false, false))).data[0].customerShippingRate, null);
  assert.equal(initialPeak, 2, 'independent page and count reads start together with at most two active queries');
  console.log('PASS Shipments concurrent reads, order/tracking search, scope, status, money redaction and pagination');
} finally { await sql.end({ timeout: 5 }); }
