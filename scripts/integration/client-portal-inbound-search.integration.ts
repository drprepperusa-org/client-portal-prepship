import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: route } = await import('../../src/routes/client-portal/inbound');
const oldFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('External requests blocked'); }) as typeof fetch;
function appFor(clientIds: number[] = [], global = false, storeIds: number[] = []) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries({ userId: 'inbound-search-fixture', role: global ? 'admin' : 'client_user',
      permissions: [], clientIds, storeIds })) c.set(key as never, value as never);
    await next();
  });
  app.route('/', route); return app;
}
async function get(app: Hono, query = '') {
  const response = await app.request('/inbound' + query);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  return response.json() as Promise<{ data: Array<{ id: number; reference: string; expectedUnits: number; items: unknown[] }>;
    pagination: { page: number; total: number; totalPages: number; pageSize: number } }>;
}
try {
  await sql`truncate portal_inbound_create_requests, inbound_items, inbound_shipments, client_portal_audit_logs, clients cascade`;
  const [a, b] = await sql`insert into clients(name,store_ids) values ('Search Alpha',array[6501]),('Search Beta',array[6502]) returning id`;
  const [old] = await sql`insert into inbound_shipments(client_id,reference,supplier,tracking_number,status,created_at)
    values (${a!.id},'PO-OLD-100%_literal','Older supplier','TRACK-OLD','in_transit','2020-01-01') returning id`;
  await sql`insert into inbound_items(inbound_id,sku,expected_qty) values
    (${old!.id},'SKU-OLD',3),(${old!.id},'SKU-OLD',4),(${old!.id},'OTHER',5)`;
  await sql`insert into inbound_shipments(client_id,reference,status,created_at)
    select ${a!.id},'PO-' || n,case when n=1 then 'received' when n=2 then 'cancelled' else 'expected' end,'2026-01-01'::timestamptz
    from generate_series(1,205) n`;
  await sql`insert into inbound_shipments(client_id,reference,supplier) values (${b!.id},'PO-SECRET','Older supplier')`;
  const app = appFor([a!.id]);
  const first = await get(app); assert.equal(first.data.length, 50); assert.equal(first.pagination.total, 206);
  const allIds = new Set<number>();
  for (let page = 1; page <= 5; page++) {
    const result = await get(app, `?page=${page}`);
    for (const row of result.data) { assert.ok(!allIds.has(row.id)); allIds.add(row.id); }
  }
  assert.equal(allIds.size, 206); assert.ok(allIds.has(old!.id), 'older than former 200-row cap');
  for (const search of ['po-old', 'older supplier', 'track-old', 'sku-old', '%_', '100%_literal']) {
    const result = await get(app, '?search=' + encodeURIComponent(search));
    assert.equal(result.pagination.total, 1, search); assert.equal(result.data[0]!.id, old!.id);
    assert.equal(result.data[0]!.items.length, 3); assert.equal(result.data[0]!.expectedUnits, 12, 'all items, not just matching SKU');
  }
  assert.equal((await get(app, '?search=' + encodeURIComponent('100%Xliteral'))).pagination.total, 0);
  assert.equal((await get(app, '?search=' + encodeURIComponent("' OR 1=1 --"))).pagination.total, 0);
  for (const [status, total] of [['expected', 203], ['in_transit', 1], ['received', 1], ['cancelled', 1]]) {
    assert.equal((await get(app, '?status=' + status)).pagination.total, total);
  }
  assert.equal((await get(app, '?search=SKU-OLD&status=expected')).pagination.total, 0);
  assert.equal((await get(app, `?clientId=${b!.id}`)).pagination.total, 0, 'requested client cannot expand access');
  assert.equal((await get(appFor([], false, [6501]))).pagination.total, 0, 'store-only scope cannot expose client-level POs');
  assert.equal((await get(appFor([], true))).pagination.total, 207);
  assert.equal((await get(appFor([], true), `?clientId=${b!.id}`)).pagination.total, 1);
  assert.equal((await appFor().request('/inbound')).status, 403);
  const last = await get(app, '?page=999'); assert.equal(last.pagination.page, 5); assert.equal(last.data.length, 6);
  assert.equal((await get(app, '?pageSize=999')).pagination.pageSize, 500);
  for (const query of ['?clientId=oops', '?page=-1', '?pageSize=0', '?status=unknown', '?search=' + 'x'.repeat(121)]) {
    assert.equal((await app.request('/inbound' + query)).status, 400);
  }
  console.log('PASS inbound search: full dataset, scope, literal search, SKU totals, statuses, stable paging and query validation');
} finally { globalThis.fetch = oldFetch; await sql.end({ timeout: 5 }); }
