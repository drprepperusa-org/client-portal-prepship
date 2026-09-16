import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';
import type { PortalIntegration } from '../../src/lib/client-portal/contracts/connections';

setupTestEnv();
const { sql } = await import('../../src/db/client');
const { registerIntegrationReadRoutes } = await import('../../src/routes/client-portal/integrations/reads');
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw Error('Connection fixtures block external requests'); }) as typeof fetch;
function appFor(clientIds: number[], storeIds: number[] = [], admin = false) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    const actor = { userId: 'connection-filter-fixture', email: 'connections@example.test',
      role: admin ? 'admin' : 'client_user', permissions: [], clientIds, storeIds };
    for (const [key, value] of Object.entries(actor)) c.set(key as never, value as never);
    await next();
  });
  registerIntegrationReadRoutes(app);
  return app;
}
async function get(app: Hono, params = '') {
  const response = await app.request(`/integrations?${params}`);
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as { data: PortalIntegration[] };
  return body.data;
}
let clientIds: number[] = [];
try {
  for (const file of ['drizzle/0027_credential_accounts_source_of_truth.sql', 'drizzle/0037_store_account_sync_state.sql']) {
    await sql.file(file);
  }
  const [a, b] = await sql`insert into clients(name) values ('Connection Filter Alpha'), ('Connection Filter Beta') returning id`;
  assert.ok(a && b); clientIds = [a.id, b.id];
  await sql`insert into store_accounts(client_id, provider, label, account_identifier, credentials, source, active, created_at)
    select ${a.id}, 'shopify', 'Fixture ' || n, 'fixture-' || n, '{}'::jsonb, 'admin', true, '2026-09-14'
    from generate_series(1,205) n`;
  await sql`insert into store_accounts(client_id, provider, label, account_identifier, credentials, source, active, created_at, last_sync_error)
    values (${a.id},'shopify','Old 100% reconnect','private-domain.example','{}'::jsonb,'admin',true,'2025-01-01','auth'),
           (${a.id},'ebay','Pending Alpha','pending-fixture','{}'::jsonb,'portal',false,'2025-01-01',null),
           (${a.id},'walmart','Delayed Alpha','delayed-fixture','{}'::jsonb,'admin',true,'2025-01-01','network: private'),
           (${b.id},'shopify','Private Beta','beta-fixture','{}'::jsonb,'admin',true,'2026-09-15','auth')`;
  const alpha = appFor([a.id]), admin = appFor([], [], true);
  const all = await get(alpha);
  assert.equal(all.length,208,'all scoped stores beyond the old 200 cap are returned');
  const attention = await get(alpha,'status=attention');
  assert.deepEqual(attention.map(r=>r.connectionStatus).sort(),['degraded','pending','reconnect']);
  assert.equal((await get(alpha,'status=attention&provider=SHOPIFY&search=100%25'))[0]?.label,'Old 100% reconnect');
  assert.equal((await get(alpha,'status=pending')).length,1);
  assert.equal((await get(alpha,'status=active')).length,205);
  assert.equal((await get(alpha,'provider=ebay&status=reconnect')).length,0);
  assert.equal((await get(alpha,'search='+encodeURIComponent("' OR true --"))).length,0);
  assert.equal((await get(alpha,'search=private-domain')).length,0,'raw identifiers are not searchable');
  assert.equal((await get(alpha,`clientId=${b.id}`)).length,0,'selected client cannot widen tenant scope');
  assert.equal((await get(admin,`clientId=${b.id}`)).length,1,'admin selection narrows global view');
  assert.equal((await get(appFor([a.id,b.id]),`clientId=${a.id}&status=attention`)).length,3);
  assert.equal((await get(appFor([], [7711]))).length,0,'store-only scope stays fail closed');
  assert.equal((await appFor([]).request('/integrations')).status,403);
  for (const query of ['clientId=-1','clientId=abc','clientId=1.1','status=broken']) {
    assert.equal((await alpha.request(`/integrations?${query}`)).status,400);
  }
  for (const row of attention) {
    for (const key of ['credentials','accountIdentifier','lastSyncError','source','active']) assert.equal(key in row,false);
    assert.ok(!JSON.stringify(row).includes('private-domain.example'));
    assert.ok(!JSON.stringify(row).includes('network: private'));
  }
  console.log('PASS connection filters: 208 stores, attention statuses, client isolation, literal search, redaction and invalid filters');
} finally {
  if (clientIds.length) {
    await sql`delete from store_accounts where client_id in ${sql(clientIds)}`;
    await sql`delete from clients where id in ${sql(clientIds)}`;
  }
  await sql.end({timeout:5}); globalThis.fetch=originalFetch;
}
