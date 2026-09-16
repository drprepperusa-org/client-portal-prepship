import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: attentionRoute } = await import('../../src/routes/client-portal/attention');
const { default: inventoryRoute } = await import('../../src/routes/client-portal/inventory');
const { registerIntegrationReadRoutes } = await import('../../src/routes/client-portal/integrations/reads');
function appFor(clientIds: number[], storeIds: number[] = [], admin = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'attention-fixture', email: 'attention@example.test',
      role: admin ? 'admin' : 'client_user', permissions: [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', attentionRoute); app.route('/', inventoryRoute); registerIntegrationReadRoutes(app);
  return app;
}
async function get(app: Hono, path = '/attention') {
  const response = await app.request(path);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<any>;
}
let clientIds: number[] = [];
try {
  const [a, b] = await sql`insert into clients(name,store_ids)
    values ('Attention Alpha',array[98761]), ('Attention Beta',array[98762]) returning id`;
  assert.ok(a && b);
  clientIds = [a.id,b.id];
  await sql`insert into inventory(client_id,sku,reorder_level)
    select ${a.id}, 'attention-' || n, 5 from generate_series(1,105) n`;
  const [inStock] = await sql`insert into inventory(client_id,sku,reorder_level)
    values (${a.id},'attention-in-stock',5) returning id`;
  assert.ok(inStock);
  await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,created_by,idempotency_key,source_entity,source_id)
    values (${inStock.id},${a.id},'attention-in-stock','receive',10,'fixture','attention-in-stock','fixture','attention-in-stock')`;
  await sql`insert into inventory(client_id,sku,active)
    values (${a.id},'attention-inactive',false), (${b.id},'attention-private',true)`;
  await sql`insert into store_accounts(client_id,provider,label,account_identifier,credentials,source,active,last_sync_error)
    values (${a.id},'shopify','Attention reconnect','reconnect-fixture','{}'::jsonb,'admin',true,'auth'),
      (${a.id},'ebay','Attention pending','pending-fixture','{}'::jsonb,'portal',false,null),
      (${a.id},'walmart','Attention delayed','delayed-fixture','{}'::jsonb,'admin',true,'private-network-details'),
      (${a.id},'shopify','Attention active','active-fixture','{}'::jsonb,'admin',true,null),
      (${b.id},'shopify','Private Beta','private-fixture','{}'::jsonb,'admin',true,'auth')`;
  const alpha=appFor([a.id]), admin=appFor([],[],true);
  const summary=await get(alpha);
  assert.deepEqual(Object.keys(summary).sort(),['checkedAt','connectionCount','inventoryCount','totalCount']);
  assert.equal(summary.inventoryCount,105); assert.equal(summary.connectionCount,3); assert.equal(summary.totalCount,108);
  assert.ok(Number.isFinite(Date.parse(summary.checkedAt)));
  assert.equal(summary.inventoryCount,(await get(alpha,'/inventory?lowStock=1&pageSize=1')).pagination.total);
  assert.equal(summary.connectionCount,(await get(alpha,'/integrations?status=attention')).data.length);
  const selected=await get(admin,`/attention?clientId=${b.id}`);
  assert.equal(selected.totalCount,2);
  assert.equal((await get(alpha,`/attention?clientId=${b.id}`)).totalCount,0,'cannot widen assigned scope');
  assert.equal((await get(appFor([],[98762]))).inventoryCount,1,'inventory follows existing store scope');
  assert.equal((await get(appFor([],[98762]))).connectionCount,0,'connections remain fail closed for store-only users');
  assert.equal((await appFor([]).request('/attention')).status,403);
  for (const id of ['', '-1','1.1','abc','9007199254740992']) {
    assert.equal((await alpha.request(`/attention?clientId=${id}`)).status,400);
  }
  assert.equal((await alpha.request('/attention')).headers.get('cache-control'),'private, no-store');
  const [stock] = await sql`select id from inventory where client_id=${a.id} and sku='attention-1'`;
  assert.ok(stock);
  await sql`insert into inventory_ledger(inventory_id,client_id,sku,type,qty,created_by,idempotency_key,source_entity,source_id)
    values (${stock.id},${a.id},'attention-1','receive',20,'fixture','attention-refresh','fixture','attention-refresh')`;
  assert.equal((await get(alpha)).inventoryCount,104,'fresh committed ledger movement clears attention');
  await sql`alter table store_accounts rename to attention_fixture_store_accounts`;
  try {
    const failed=await alpha.request('/attention');
    assert.equal(failed.status,503); assert.deepEqual(await failed.json(),{error:'attention_unavailable'});
  } finally { await sql`alter table attention_fixture_store_accounts rename to store_accounts`; }
  console.log('PASS attention: full counts, canonical list parity, scoped permissions, refresh, validation and unavailable state');
} finally {
  if (clientIds.length) {
    await sql`delete from store_accounts where client_id in ${sql(clientIds)}`;
    await sql`delete from inventory where client_id in ${sql(clientIds)}`;
    await sql`delete from clients where id in ${sql(clientIds)}`;
  }
  await sql.end({timeout:5});
}
