import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import { loadFixtureModule } from '../lib/load-fixture-module';

setupTestEnv();
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('Returns loading test blocks all external requests'); }) as typeof fetch;
const { db, sql } = await import('../../src/db/client');
let active = 0, peak = 0, reads = 0, delayMs = 0;
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
const { registerReturnReadRoutes } = loadFixtureModule('src/routes/client-portal/returns/reads.ts', {
  '../../../db/client': { db: { select: (...args: any[]) => measured((db.select as any)(...args)) } },
});
function appFor(clientIds: number[], storeIds: number[] = [], global = false, financials = true) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'returns-loading-fixture', email: 'returns@example.test', role: global ? 'admin' : 'client_user',
      permissions: financials ? ['financials:read'] : [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  registerReturnReadRoutes(app);
  return app;
}
async function get(app: Hono, params = '') {
  const response = await app.request('/returns?' + params);
  assert.equal(response.status, 200, params);
  return response.json() as Promise<{ data: any[]; pagination: { total: number; totalPages: number } }>;
}
try {
  await sql`truncate returns, shipments, orders, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, store_ids) values ('Return Alpha', array[7701]), ('Return Beta', array[7702]) returning id`;
  assert.ok(a && b);
  const [oa, empty, custom, ob] = await sql`insert into orders(client_id, store_id, order_number, order_status, items)
    values (${a.id}, 7701, '  LEGACY  100  ', 'shipped', '[]'), (${a.id}, 7701, ' ', 'shipped', '[]'),
      (${a.id}, 7701, '777', 'shipped', '[]'), (${b.id}, 7702, '  LEGACY  100  ', 'shipped', '[]') returning id`;
  assert.ok(oa && empty && custom && ob);
  const [shipment] = await sql`insert into shipments(order_id, client_id, is_return, label_tracking, tracking_number,
    tracking_status, delivered_at, cost, selected_rate_json)
    values (${oa.id}, ${a.id}, true, 'RETURN-CANON', 'RETURN-LEGACY', 'delivered', '2026-09-14', 5,
      '{"selectedRateCost":5,"cShippingRateAmount":8.75,"shippingMarginAmount":3.75,"shippingMarginPct":75,
        "customerRateSource":"realized_customer_shipping_rate","rateCostSource":"label_final_cost",
        "customerShippingMoneyPolicyVersion":"ps-437-v1"}') returning id`;
  assert.ok(shipment);
  const [ra, re, rc, rb] = await sql`insert into returns(order_id, client_id, return_shipment_id, return_reference,
    status, initiated_by, return_customer_shipping_rate)
    values (${oa.id}, ${a.id}, ${shipment.id}, null, 'label_created', 'client', 8.75),
      (${empty.id}, ${a.id}, null, ' ', 'requested', 'client', null),
      (${custom.id}, ${a.id}, null, 'CUSTOM-REF-9', 'closed', 'client', null),
      (${ob.id}, ${b.id}, null, null, 'requested', 'client', null) returning id`;
  assert.ok(ra && re && rc && rb);
  await sql`insert into return_items(return_id, order_id, sku, quantity) values (${ra.id}, ${oa.id}, 'SKU-A', 2)`;
  const alpha = appFor([a.id]), admin = appFor([], [], true);
  await get(alpha);
  reads = 0; peak = 0; delayMs = 40;
  const start = performance.now();
  const initial = await get(alpha);
  console.log(JSON.stringify({ scenario: 'warmed route with 40ms added per list SQL read', elapsedMs: Math.round(performance.now() - start), reads, peak }));
  const initialPeak = peak;
  assert.equal(reads, 2);
  assert.equal(active, 0);
  assert.equal(initial.pagination.total, 3);
  const legacy = initial.data.find(row => row.id === ra.id)!;
  assert.equal(legacy.returnReference, 'LEGACY-100-RETURN');
  assert.equal(legacy.status, 'label_created', 'arrival does not advance the return lifecycle');
  assert.equal(legacy.arrivedReadyToReceive, true);
  assert.equal(legacy.returnCustomerShippingRate, 8.75);
  assert.equal(legacy.returnedQuantity, 2);
  assert.deepEqual(legacy.returnedSkus, ['SKU-A']);
  assert.equal('carrierCode' in legacy, false);
  delayMs = 0;
  assert.deepEqual((await get(alpha, 'search=LEGACY-100-RETURN')).data.map(row => row.id), [ra.id], 'search finds the displayed legacy reference');
  assert.deepEqual((await get(alpha, `search=${empty.id}-RETURN`)).data.map(row => row.id), [re.id], 'order-id fallback reference is searchable');
  assert.deepEqual((await get(alpha, 'search=CUSTOM-REF-9')).data.map(row => row.id), [rc.id]);
  for (const value of ['777', 'RETURN-CANON', 'RETURN-LEGACY']) assert.equal((await get(alpha, `search=${value}`)).pagination.total, 1);
  assert.equal((await get(alpha, 'status=closed')).data[0].id, rc.id);
  assert.equal((await get(alpha, `orderId=${empty.id}`)).data[0].id, re.id);
  assert.equal((await get(admin, `clientId=${b.id}`)).pagination.total, 1);
  assert.equal((await get(admin, 'storeId=7702')).pagination.total, 1);
  assert.equal((await get(alpha, `clientId=${b.id}&search=LEGACY-100-RETURN`)).pagination.total, 0);
  assert.equal((await get(appFor([], [7702]), 'search=LEGACY-100-RETURN')).data[0].id, rb.id);
  const sorted = await get(alpha, 'sortBy=returnReference&sortDir=asc&pageSize=1&page=2');
  assert.equal(sorted.pagination.totalPages, 3);
  assert.equal(sorted.data[0].id, rc.id);
  assert.equal((await get(alpha, 'page=999')).data.length, 0);
  assert.equal((await get(appFor([a.id], [], false, false), `orderId=${oa.id}`)).data[0].returnCustomerShippingRate, null);
  assert.equal((await appFor([]).request('/returns')).status, 403);
  assert.equal(initialPeak, 2, 'only the two independent list reads overlap');
  const [persisted] = await sql`select status from returns where id = ${ra.id}`;
  assert.equal(persisted?.status, 'label_created');
  console.log('PASS Returns loading, displayed reference search, order/tracking search, scope, arrival, money and pagination');
} finally { await sql.end({ timeout: 5 }); globalThis.fetch = originalFetch; }
