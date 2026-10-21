import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { setupTestEnv } from './integration/guard';

process.env.TEST_DATABASE_URL = 'postgres://test:test@127.0.0.1:1/unused_billing_columns';
setupTestEnv();
const { defaultBillingColumns, parseBillingColumnUpdate, readBillingColumns, saveBillingColumns, BillingColumnsConflict } = await import('../src/lib/client-portal/billing-columns');
const { createBillingColumnsRoute } = await import('../src/routes/client-portal/billing-columns');
const { resolveClientPortalScope } = await import('../src/lib/client-portal/scope');
const { sql: appSql } = await import('../src/db/client');
const memory = new PGlite();
const database = drizzle(memory, { casing: 'snake_case' });
await memory.exec(`
  CREATE TABLE settings (key text PRIMARY KEY, value text);
  CREATE TABLE client_portal_audit_logs (id serial PRIMARY KEY, event text NOT NULL,
    actor_user_id text, actor_email text, client_ids integer[], store_ids integer[], metadata jsonb, created_at timestamptz default now());
`);
// PGlite is single-session. If advisory locks are unsupported, only the lock is
// substituted; actual persistence, transactions and audit rollback remain real SQL.
try { await memory.query('select pg_advisory_xact_lock(36422,1)'); }
catch { await memory.exec(`CREATE FUNCTION pg_advisory_xact_lock(int,int) RETURNS void LANGUAGE SQL AS 'SELECT';`); }
const conn = database as unknown as Parameters<typeof saveBillingColumns>[2];
const readConn = database as unknown as Parameters<typeof readBillingColumns>[0];
const defaults = defaultBillingColumns();
assert.deepEqual(await readBillingColumns(readConn), defaults);
assert.equal(parseBillingColumnUpdate({ ...defaults, lineItems: ['order'] }), null);
assert.equal(parseBillingColumnUpdate({ ...defaults, summary: [...defaults.summary, 'privateCost'] }), null);
assert.equal(parseBillingColumnUpdate({ ...defaults, summary: [...defaults.summary, 'fee'] }), null);

const actor = { userId: 'admin-test', role: 'admin', email: 'admin@columns.test', permissions: ['scope:global', 'financials:read'], clientIds: [], storeIds: [] };
const client = { userId: 'client-test', role: 'client_user', email: 'client@columns.test', permissions: ['financials:read'], clientIds: [4], storeIds: [] };
let writes = 0;
const route = createBillingColumnsRoute({
  read: () => readBillingColumns(readConn),
  save: async (scope, input) => {
    writes++;
    try { return await saveBillingColumns(scope, input, conn); }
    catch (error) { if (!(error instanceof BillingColumnsConflict)) console.error(error); throw error; }
  },
});
function appFor(values: typeof actor) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries(values)) c.set(key as never, value as never);
    await next();
  });
  app.route('/', route);
  return app;
}
const adminApp = appFor(actor);
const clientApp = appFor(client);
const write = (body: unknown) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const change = { ...defaults, summary: defaults.summary.filter((key) => key !== 'shipping'), lineItems: defaults.lineItems.filter((key) => key !== 'customsDuties') };
assert.equal((await clientApp.request('/billing/columns', write(change))).status, 403);
assert.equal(writes, 0, 'client is rejected before the persistence boundary');
assert.equal((await adminApp.request('/billing/columns', write({ ...change, summary: [] }))).status, 400);
assert.equal((await adminApp.request('/billing/columns', write(change))).status, 200);
const clientRead = await (await clientApp.request('/billing/columns')).json();
assert.equal(clientRead.canManage, false);
assert.deepEqual(clientRead.summary, change.summary);
assert.deepEqual(clientRead.lineItems, change.lineItems);
assert.equal((await adminApp.request('/billing/columns', write(change))).status, 409, 'stale save cannot overwrite another admin');
assert.equal((await memory.query('select * from client_portal_audit_logs')).rows.length, 1);
const before = await readBillingColumns(readConn);
await memory.exec("ALTER TABLE client_portal_audit_logs ADD CONSTRAINT reject_new_audit CHECK (event <> 'portal.billing_columns.update') NOT VALID");
await assert.rejects(() => saveBillingColumns(
  resolveClientPortalScope({ get: (key: string) => actor[key as keyof typeof actor] } as never),
  { ...defaults, revision: before.revision }, conn,
));
assert.deepEqual(await readBillingColumns(readConn), before, 'failed audit rolls back shared settings');
await memory.exec('ALTER TABLE client_portal_audit_logs DROP CONSTRAINT reject_new_audit');
await memory.exec("UPDATE settings SET value = '{}' ");
await assert.rejects(() => readBillingColumns(readConn), 'corrupt settings never silently reveal all columns');
assert.equal(BillingColumnsConflict.prototype instanceof Error, true);
await memory.close();
await appSql.end();
console.log('PASS billing column settings: persistence, client enforcement, validation, conflicts, atomic audit and fail-closed reads');
