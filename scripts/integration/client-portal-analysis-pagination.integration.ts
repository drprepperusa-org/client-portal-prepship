import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: routes } = await import('../../src/routes/client-portal/analysis');
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('Analysis fixtures block external requests'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], admin = false, financials = true) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'analysis-page-fixture', email: 'analysis@example.test', role: admin ? 'admin' : 'client_user',
      permissions: financials ? ['financials:read'] : [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', routes);
  return app;
}
const dates = 'dateFrom=2026-09-01T00:00:00.000Z&dateTo=2026-09-14T23:59:59.999Z';
async function get(app: Hono, params = '', endpoint = '/analysis') {
  const response = await app.request(`${endpoint}?${dates}&${params}`);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<any>;
}
try {
  await sql`truncate order_items, orders, inventory, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, store_ids) values ('Alpha', array[7701]), ('Beta', array[7702]) returning id`;
  assert.ok(a && b);
  await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, items)
    select ${a.id}, 7701, 'AN-' || n, 'shipped', '2026-09-14T23:59:59.999Z', '[]' from generate_series(1,420) n`;
  await sql`insert into order_items(order_id, sku, name, quantity, unit_price, line_total, client_id, store_id, order_status, order_date)
    select id, case when id > 210 then 'DETAIL' else 'SKU-' || lpad(id::text, 3, '0') end,
      case when id=5 then '100% balm' else 'Item ' || id end, 1, 2, 2, client_id, store_id, order_status, order_date from orders`;
  const [other] = await sql`insert into orders(client_id, store_id, order_number, order_status, order_date, items)
    values (${b.id},7702,'PRIVATE-BETA','shipped','2026-09-10','[]') returning id`;
  assert.ok(other);
  await sql`insert into order_items(order_id, sku, name, quantity, unit_price, line_total, client_id, store_id, order_status, order_date)
    values (${other.id},'DETAIL','Private Beta',5000,2,10000,${b.id},7702,'shipped','2026-09-10')`;
  await sql`insert into inventory(client_id, sku, name)
    select client_id, sku, max(name) from order_items group by client_id, sku`;
  const [inv] = await sql`select id from inventory where client_id=${a.id} and sku='DETAIL'`;
  assert.ok(inv);
  const alpha = appFor([a.id]), admin = appFor([], [], true);
  const first = await get(alpha);
  assert.deepEqual(first.pagination, {page:1,pageSize:50,total:211,totalPages:5});
  assert.equal(first.totalSkus,211);
  assert.equal(first.totalUnits,420);
  assert.equal(first.totalRevenue,840);
  assert.equal(first.topSkus[0].sku,'DETAIL');
  const seen = new Set<string>();
  for (let page=1;page<=5;page++) {
    const result=await get(alpha,`page=${page}`);
    assert.deepEqual(result.topSkus,first.topSkus);
    assert.deepEqual(result.orderCombinations,first.orderCombinations);
    assert.equal(result.totalUnits,420);
    for (const row of result.data) {
      assert.ok(!seen.has(row.sku),'tied quantities must not duplicate rows'); seen.add(row.sku);
      assert.equal(row.client_id,a.id);
      for (const field of ['total_shipping','std_total','service_code']) assert.equal(field in row,false);
    }
  }
  assert.equal(seen.size,211,'all SKUs beyond old 200 cap are reachable');
  for (const search of ['sku-210','item 210','100%']) {
    const result=await get(alpha,`search=${encodeURIComponent(search)}&page=999`);
    assert.equal(result.pagination.total,1); assert.equal(result.pagination.page,1);
    assert.equal(result.totalSkus,211); assert.equal(result.totalUnits,420); assert.equal(result.totalRevenue,840);
    assert.deepEqual(result.topSkus,first.topSkus);
  }
  const empty=await get(alpha,'search='+encodeURIComponent("' OR true --"));
  assert.equal(empty.pagination.total,0); assert.deepEqual(empty.data,[]); assert.equal(empty.totalSkus,211);
  const sorted=await get(alpha,'sortKey=sku&sortDir=asc&page=5');
  assert.equal(sorted.data.at(-1).sku,'SKU-210');
  assert.equal((await get(alpha,'sortKey=constructor')).data[0].sku,'DETAIL');
  assert.equal((await get(alpha,'page=999')).pagination.page,5);
  assert.equal((await get(alpha,'page=-1&pageSize=99999')).pagination.pageSize,500);
  assert.equal((await get(alpha,`clientId=${b.id}`)).pagination.total,0);
  assert.equal((await get(admin,`clientId=${b.id}`)).totalUnits,5000);
  assert.equal((await get(admin,'storeId=7702')).pagination.total,1);
  assert.equal((await get(appFor([], [7701]))).totalSkus,211);
  assert.equal((await appFor([]).request('/analysis')).status,403);
  const hidden=await get(appFor([a.id],[],false,false),'sortKey=revenue&sortDir=desc');
  assert.equal(hidden.totalRevenue,0);
  assert.ok([...hidden.data,...hidden.topSkus].every((r:any)=>r.total_revenue==='0'));
  const orderIds=new Set<number>();
  for (let page=1;page<=5;page++) {
    const result=await get(alpha,`inventoryId=${inv.id}&page=${page}`,'/analysis/sku-orders');
    assert.equal(result.pagination.total,210); assert.equal(result.totalUnits,210);
    assert.equal(result.dailySales.at(-1).units,210,'inclusive end day includes its last millisecond');
    for (const row of result.orders) { assert.ok(!orderIds.has(row.order_id)); orderIds.add(row.order_id); }
  }
  assert.equal(orderIds.size,210,'all SKU orders beyond 40/200 caps are reachable');
  assert.equal((await get(admin,`inventoryId=${inv.id}&clientId=${a.id}`,'/analysis/sku-orders')).pagination.total,210);
  assert.equal((await alpha.request(`/analysis/sku-orders?inventoryId=${inv.id}&clientId=${b.id}`)).status,404);
  console.log('PASS Analysis: 211 SKUs/210 drawer orders, literal search, stable pages/sort, full-period charts/totals, scope and redaction');
} finally { await sql.end({timeout:5}); globalThis.fetch=originalFetch; }
