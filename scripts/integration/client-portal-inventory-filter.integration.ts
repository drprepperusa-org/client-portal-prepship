/** Exercise the actual Inventory routes against disposable PostgreSQL only. */
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { default: inventoryRoute } = await import('../../src/routes/client-portal/inventory');

function appFor(clientIds: number[], storeIds: number[] = [], global = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'inventory-fixture', email: 'inventory@example.test',
      role: global ? 'admin' : 'client_user', permissions: global ? ['scope:global'] : [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', inventoryRoute);
  return app;
}
async function get(app: Hono, path: string) {
  const response = await app.request(path);
  assert.equal(response.status, 200, path);
  return response.json() as Promise<{ data: any[]; pagination: { total: number; page: number; totalPages: number } }>;
}
try {
  await sql`truncate inventory, clients restart identity cascade`;
  const [a, b] = await sql`insert into clients(name, active, store_ids)
    values ('Inventory Alpha', true, array[8801]), ('Inventory Beta', true, array[8802]) returning id`;
  assert.ok(a && b);
  const [a1, a2, b1] = await sql`insert into inventory(client_id, sku, name, reorder_level)
    values (${a.id}, 'A-1', 'Alpha first', 10), (${a.id}, 'A-2', 'Alpha second', 0),
      (${b.id}, 'B-1', 'Beta first', 5) returning id`;
  assert.ok(a1 && a2 && b1);
  await sql`insert into inventory(client_id, sku, active) values (${a.id}, 'INACTIVE', false), (null, 'ORPHAN', true)`;
  for (const movement of [
    { id: a1.id, client: a.id, sku: 'A-1', type: 'receive', qty: 10, date: '2026-08-01' },
    { id: a1.id, client: a.id, sku: 'A-1', type: 'ship', qty: -3, date: '2026-09-10' },
    { id: a2.id, client: a.id, sku: 'A-2', type: 'ship', qty: -3, date: '2026-09-11' },
    { id: b1.id, client: b.id, sku: 'B-1', type: 'receive', qty: 50, date: '2026-09-12' },
  ]) {
    const key = `${movement.sku}-${movement.type}`;
    await sql`insert into inventory_ledger(inventory_id, client_id, sku, type, qty, effective_at,
      created_by, idempotency_key, source_entity, source_id)
      values (${movement.id}, ${movement.client}, ${movement.sku}, ${movement.type}, ${movement.qty},
        ${movement.date}::timestamptz, 'fixture', ${key}, 'fixture', ${key})`;
  }
  const admin = appFor([], [], true), alpha = appFor([a.id]), betaStore = appFor([], [8802]);
  const all = await get(admin, '/inventory?sortBy=sku&sortDir=asc');
  assert.deepEqual(all.data.map(row => [row.sku, row.inventoryQuantity, row.stockStatus]),
    [['A-1', 7, 'low'], ['A-2', -3, 'out'], ['B-1', 50, 'in']]);
  assert.equal(all.pagination.total, 3, 'inactive and orphan rows remain hidden');
  const selected = await get(admin, `/inventory?clientId=${b.id}`);
  assert.deepEqual(selected.data.map(row => row.sku), ['B-1'], 'admin client selection narrows stock rows');
  assert.equal(selected.pagination.total, 1, 'admin client selection also narrows count');
  assert.equal((await get(admin, '/inventory?storeId=8802')).pagination.total, 1);
  assert.equal((await get(admin, `/inventory?clientId=${a.id}&storeId=8802`)).pagination.total, 0);
  assert.equal((await get(alpha, `/inventory?clientId=${b.id}`)).pagination.total, 0);
  assert.deepEqual((await get(betaStore, '/inventory')).data.map(row => row.sku), ['B-1']);
  assert.equal((await get(alpha, '/inventory?storeId=8802')).pagination.total, 0);
  assert.equal((await get(admin, '/inventory?search=Beta')).pagination.total, 1);
  assert.equal((await get(admin, '/inventory?lowStock=1')).pagination.total, 2);
  const second = await get(admin, `/inventory?clientId=${a.id}&sortBy=sku&sortDir=asc&pageSize=1&page=2`);
  assert.equal(second.data[0].sku, 'A-2');
  assert.equal(second.pagination.totalPages, 2);
  const range = 'from=2026-09-01T00:00:00.000Z&to=2026-09-15T23:59:59.999Z';
  const history = await get(admin, `/inventory-history?clientId=${a.id}&${range}&sortBy=sku&sortDir=asc`);
  assert.deepEqual(history.data.map(row => [row.sku, row.qty]), [['A-1', -3], ['A-2', -3]]);
  assert.equal(history.pagination.total, 2, 'history narrows by client and effective date');
  assert.equal((await get(admin, `/inventory-history?clientId=${b.id}&${range}`)).pagination.total, 1);
  assert.equal((await get(alpha, `/inventory-history?clientId=${b.id}&${range}`)).pagination.total, 0);
  assert.equal((await get(betaStore, `/inventory-history?${range}`)).pagination.total, 1);
  assert.equal((await get(admin, `/inventory-history?sku=A-1&type=ship&${range}`)).pagination.total, 1);
  assert.equal((await appFor([]).request('/inventory')).status, 403);
  assert.equal((await appFor([]).request('/inventory-history')).status, 403);
  // A committed new movement is immediately reflected; no stale stock/count cache.
  await sql`insert into inventory_ledger(inventory_id, client_id, sku, type, qty, effective_at,
    created_by, idempotency_key, source_entity, source_id)
    values (${a1.id}, ${a.id}, 'A-1', 'receive', 5, '2026-09-13', 'fixture', 'new-receive', 'fixture', 'new-receive')`;
  const refreshed = await get(alpha, '/inventory?search=A-1');
  assert.equal(refreshed.data[0].inventoryQuantity, 12);
  assert.equal(refreshed.data[0].stockStatus, 'in');
  assert.equal((await get(alpha, '/inventory?lowStock=1')).pagination.total, 1);
  console.log('PASS Inventory selected-client/store filtering, ledger quantities, history dates, search, pagination and fresh reads');
} finally { await sql.end({ timeout: 5 }); }
