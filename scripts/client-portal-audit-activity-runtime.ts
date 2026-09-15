import assert from 'node:assert/strict';
import { buildPortalAuditActivity } from '../src/lib/client-portal/read-models/audit-log-activity';

const orders = buildPortalAuditActivity('portal.orders.list', {
  status: 'awaiting_shipment', page: 2, pageSize: 50, search: '4002', rows: 8, total: 58,
});
assert.equal(orders.category, 'Data request');
assert.match(orders.label, /^Loaded/);
assert.ok(orders.details.some(field => field.label === 'Search' && field.value === '4002'));
assert.ok(orders.details.some(field => field.label === 'Matching rows' && field.value === '58'));
assert.match(orders.note, /preloading or refreshing/);

const background = buildPortalAuditActivity('portal.orders.awaiting_active_count', { count: 16 });
assert.equal(background.category, 'Background check');
assert.match(background.note, /not evidence of a deliberate click/);
assert.equal(buildPortalAuditActivity('portal.me.view', {}).label, 'Portal session checked');

const click = buildPortalAuditActivity('portal.ui.click', { target: 'Audit log', from: '/billing?token=secret', to: '/audit-log' });
assert.equal(click.outcome, 'Reported');
assert.match(click.summary, /Clicked Audit log from billing to audit log/);
assert.doesNotMatch(JSON.stringify(click), /secret|token=/);

for (const [event, outcome] of [['requested', 'Requested'], ['completed', 'Completed'], ['failed', 'Failed'], ['denied', 'Denied']] as const) {
  assert.equal(buildPortalAuditActivity(`portal.inventory.receive.${event}`, {}).outcome, outcome);
}
const requested = buildPortalAuditActivity('portal.inventory.receive.requested', { inventoryIds: [41, 42], totalUnits: 7 });
assert.match(requested.note, /not proof/);
assert.ok(requested.details.some(field => field.value === '41, 42'));

const historical = buildPortalAuditActivity('portal.access_list.update', { role: 'client_user', active: false, clientIds: [], password: 'secret', payload: { customerAddress: 'private' } });
assert.match(historical.note, /cannot be reconstructed/);
assert.ok(historical.details.some(field => field.label === 'Submitted active status' && field.value === 'No'));
assert.ok(historical.details.some(field => field.label === 'Assigned client IDs' && field.value === 'None'));
assert.doesNotMatch(JSON.stringify(historical), /secret|private|customerAddress/);
assert.match(buildPortalAuditActivity('portal.unrecognized.event', {}).summary, /not recorded/);

// Exercise the actual HTTP selector/DTO against an isolated in-memory PostgreSQL database.
// No database connection, credentials, provider calls or live audit inserts.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/audit_fixture';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.SUPABASE_JWT_SECRET = 'test';
const { Hono } = await import('hono');
const { PGlite } = await import('@electric-sql/pglite');
const { drizzle } = await import('drizzle-orm/pglite');
const { db } = await import('../src/db/client');
const { clientPortalAuditLogs } = await import('../src/db/schema/client-portal-audit-logs');
const { default: auditRoute } = await import('../src/routes/client-portal/audit-log');
const fixture = { id: 7, event: 'portal.orders.detail.view', actorUserId: 'user-1', actorEmail: 'operator@example.test',
  clientIds: [], storeIds: [], metadata: { orderId: 22, orderNumber: '4002', apiToken: 'secret-value' }, createdAt: new Date('2026-09-15T03:00:00Z') };
let selects = 0;
const select = db.select;
const selectDistinct = db.selectDistinct;
const insert = db.insert;
const pg = new PGlite();
await pg.exec(`create table client_portal_audit_logs (
  id serial primary key, event text not null, actor_user_id text, actor_email text,
  client_ids int[] not null default '{}', store_ids int[] not null default '{}',
  metadata jsonb not null default '{}', created_at timestamptz not null default now());
  create table clients (id int primary key, name text, store_ids int[]);`);
const memory = drizzle(pg, { casing: 'snake_case' });
try {
  db.select = ((...args: Parameters<typeof memory.select>) => { selects++; return memory.select(...args); }) as unknown as typeof db.select;
  db.selectDistinct = memory.selectDistinct.bind(memory) as unknown as typeof db.selectDistinct;
  db.insert = memory.insert.bind(memory) as unknown as typeof db.insert;
  await memory.insert(clientPortalAuditLogs).values(fixture);
  await pg.exec("select setval('client_portal_audit_logs_id_seq', 7)");
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'fixture-user'); c.set('role', c.req.header('x-fixture-admin') === 'yes' ? 'admin' : 'client_user');
    c.set('clientIds', [1]); c.set('storeIds', [101]); c.set('permissions', []);
    await next();
  });
  app.route('/', auditRoute);
  const denied = await app.request('/audit-log');
  assert.equal(denied.status, 403);
  assert.equal(selects, 0, 'non-admin cannot read audit rows');
  // The denied request is recorded but is not needed for this projection fixture.
  await pg.exec("delete from client_portal_audit_logs where event = 'portal.audit_log.denied'");
  const response = await app.request('/audit-log', { headers: { 'x-fixture-admin': 'yes' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data[0].createdAt, '2026-09-15T03:00:00.000Z');
  assert.equal(body.data[0].activity.category, 'Data request');
  assert.ok(body.data[0].activity.details.some((field: { value: string }) => field.value === '4002'));
  assert.equal(body.data[0].metadata.apiToken, '[redacted]');
  assert.doesNotMatch(JSON.stringify(body), /secret-value/);
  await memory.insert(clientPortalAuditLogs).values([
    ...Array.from({ length: 101 }, (_, index) => ({ event: 'portal.orders.list', actorEmail: 'admin@example.test', actorUserId: 'admin', createdAt: new Date(2026, 8, 16, 0, 0, index) })),
    { event: 'portal.inventory.list', actorEmail: 'client-a@example.test', actorUserId: 'client-a', createdAt: new Date('2026-09-14T00:00:00Z') },
  ]);
  const { recordPortalAudit } = await import('../src/lib/client-portal/audit');
  await recordPortalAudit('portal.ui.click', { userId: 'client-b', email: 'client-b@example.test', clientIds: [2], storeIds: [22] }, { target: 'Inventory' });
  const read = async (query = '') => (await (await app.request(`/audit-log${query}`, { headers: { 'x-fixture-admin': 'yes' } })).json());
  const all = await read();
  assert.equal(all.data.length, 100);
  assert.equal(all.pagination.hasMore, true);
  assert.ok(all.filters.users.includes('client-a@example.test'), 'user picker includes actors outside latest 100');
  const client = await read('?actorEmail=client-a%40example.test');
  assert.deepEqual(client.data.map((row: { actorEmail: string }) => row.actorEmail), ['client-a@example.test']);
  assert.equal(client.pagination.hasMore, false);
  const otherClient = await read('?actorEmail=client-b%40example.test');
  assert.equal(otherClient.data[0].actorUserId, 'client-b', 'client activity is stored under its own identity');
  const older = await read('?page=2');
  assert.equal(older.pagination.page, 2);
  assert.equal(older.pagination.hasMore, false);
  assert.ok(older.data.some((row: { actorEmail: string }) => row.actorEmail === 'client-a@example.test'));
  assert.ok(!older.data.some((row: { id: number }) => all.data.some((first: { id: number }) => first.id === row.id)), 'pages do not overlap');
  const combined = await read('?actorEmail=client-a%40example.test&search=orders');
  assert.equal(combined.data.length, 0, 'user and search filters both apply');
} finally { db.select = select; db.selectDistinct = selectDistinct; db.insert = insert; await pg.close(); }
console.log('PASS audit: recorded facts, redaction, admin-only access, all-user discovery, client identity and paginated history');
