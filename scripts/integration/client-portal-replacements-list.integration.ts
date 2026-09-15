import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('Replacement list tests block external requests'); }) as typeof fetch;
const { sql } = await import('../../src/db/client');
const { default: routes } = await import('../../src/routes/client-portal/replacements');
function appFor(clientIds: number[], storeIds: number[] = [], global = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'replacement-list-test', email: 'replace@example.test', role: global ? 'admin' : 'client_user',
      permissions: [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', routes);
  return app;
}
async function get(app: Hono, params = '') {
  const response = await app.request('/replacements?' + params);
  assert.equal(response.status, 200);
  return response.json() as Promise<{ data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>;
}
try {
  await sql`truncate replacement_items, replacements, orders, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, store_ids) values ('Alpha', array[7701]), ('Beta', array[7702]) returning id`;
  assert.ok(a && b);
  const [oa, ob] = await sql`insert into orders(client_id, store_id, order_number, order_status, items)
    values (${a.id}, 7701, 'ORDER-ALPHA', 'shipped', '[]'), (${b.id}, 7702, 'ORDER-BETA', 'shipped', '[]') returning id`;
  assert.ok(oa && ob);
  await sql`insert into replacements(order_id, client_id, reference, status, reason, requested_at)
    select ${oa.id}, ${a.id}, 'RP-' || lpad(n::text, 4, '0'), case when n % 2 = 0 then 'shipped' else 'requested' end,
      'private legacy reason', '2026-09-01'::timestamptz from generate_series(1, 210) n`;
  const [rb] = await sql`insert into replacements(order_id, client_id, reference, status, reason)
    values (${ob.id}, ${b.id}, 'RP-BETA', 'requested', 'damaged') returning id`;
  assert.ok(rb);
  await sql`insert into replacement_items(replacement_id, order_id, sku, quantity)
    values (1, ${oa.id}, 'SKU-A', 7), (1, ${oa.id}, 'SKU-B', 3)`;
  const alpha = appFor([a.id]), admin = appFor([], [], true);
  const first = await get(alpha);
  assert.deepEqual(first.pagination, { page: 1, pageSize: 50, total: 210, totalPages: 5 });
  assert.equal(first.data[0].reference, 'RP-0210');
  const ids = new Set<number>();
  for (let page = 1; page <= 5; page++) {
    const result = await get(alpha, `page=${page}`);
    for (const row of result.data) {
      assert.ok(!ids.has(row.id), 'tied dates cannot duplicate rows across pages');
      ids.add(row.id);
      assert.equal(row.clientId, a.id);
      assert.equal(row.reasonCode, null);
      for (const key of ['reason', 'cost', 'carrierCode', 'billable', 'liability']) assert.equal(key in row, false);
    }
  }
  assert.equal(ids.size, 210, 'all records beyond the old 200-row cutoff are reachable');
  const found = await get(alpha, 'search=rp-0001');
  assert.equal(found.pagination.total, 1);
  assert.equal(found.data[0].itemCount, 2, 'item count counts lines, not ten units');
  assert.equal((await get(alpha, 'search=ORDER-ALPHA')).pagination.total, 210);
  assert.equal((await get(alpha, 'search=RP-&status=shipped')).pagination.total, 105);
  assert.equal((await get(alpha, 'search=RP-BETA')).pagination.total, 0);
  assert.equal((await get(alpha, 'search=' + encodeURIComponent("' OR true --"))).pagination.total, 0);
  assert.equal((await get(alpha, `clientId=${b.id}`)).pagination.total, 0);
  assert.equal((await get(admin, `clientId=${b.id}`)).pagination.total, 1, 'global client switch narrows rows and count');
  assert.equal((await get(admin, 'storeId=7702')).pagination.total, 1);
  assert.equal((await get(appFor([], [7702]))).data[0].id, rb.id);
  assert.equal((await get(alpha, 'page=999')).data.length, 0);
  assert.equal((await get(alpha, 'page=999')).pagination.total, 210);
  assert.equal((await get(alpha, 'page=-1&pageSize=0')).pagination.page, 1);
  assert.equal((await get(alpha, 'pageSize=99999')).pagination.pageSize, 500);
  assert.equal((await get(alpha, 'status=unknown-status')).pagination.total, 0);
  assert.equal((await admin.request(`/replacements/${rb.id}?clientId=${a.id}`)).status, 404);
  assert.equal((await alpha.request(`/replacements/${rb.id}`)).status, 404);
  assert.equal((await appFor([]).request('/replacements')).status, 403);
  const [audits] = await sql`select count(*)::int as count from client_portal_audit_logs where event = 'portal.replacements.list'`;
  assert.ok(audits && audits.count > 0);
  console.log('PASS Replacement route pagination beyond 200, search, status, scope, redaction, detail and audit');
} finally { await sql.end({ timeout: 5 }); globalThis.fetch = originalFetch; }
