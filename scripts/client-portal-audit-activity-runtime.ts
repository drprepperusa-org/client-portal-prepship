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

  await pg.exec('delete from client_portal_audit_logs');
  const events = ['portal.me.view', 'portal.orders.awaiting_active_count', 'portal.orders.list',
    'portal.inventory.history', 'portal.orders.detail', 'portal.ui.click', 'portal.access_list.update',
    'portal.inventory.receive.requested', 'portal.inventory.receive.completed', 'portal.inventory.receive.failed',
    'portal.access_list.denied', 'portal.future.unknown'];
  await memory.insert(clientPortalAuditLogs).values(events.map(event => ({ event, actorEmail: 'types@example.test',
    createdAt: new Date('2026-09-16T01:00:00Z') })));
  const allTypes = await read('?actorEmail=types%40example.test');
  for (const activity of ['views', 'actions', 'navigation', 'failed', 'denied']) {
    const filtered = await read(`?actorEmail=types%40example.test&activity=${activity}`);
    const expected = events.filter(event => {
      const info = buildPortalAuditActivity(event, {});
      if (activity === 'views') return info.category === 'Data request';
      if (activity === 'navigation') return info.category === 'Navigation';
      if (activity === 'actions') return info.category === 'Action' && !['Failed', 'Denied'].includes(info.outcome);
      return info.outcome.toLowerCase() === activity;
    });
    assert.deepEqual(filtered.data.map((row: { event: string }) => row.event).sort(), expected.sort(), 'SQL agrees with historical DTO classification');
  }
  const noBackground = await read('?actorEmail=types%40example.test&hideBackground=true');
  assert.equal(noBackground.data.length, events.length - 2);
  assert.ok(noBackground.data.every((row: { activity: { category: string } }) => row.activity.category !== 'Background check'));
  assert.equal((await read('?actorEmail=types%40example.test')).data.length, allTypes.data.length, 'hiding does not remove saved events');
  const from = '2026-09-15T16:00:00.000Z', to = '2026-09-16T16:00:00.000Z';
  const times = ['2026-09-15T15:59:59.999Z', from, '2026-09-16T15:59:59.999Z', to];
  await memory.insert(clientPortalAuditLogs).values(times.map(time => ({ event: 'portal.ui.click',
    actorEmail: 'bounds@example.test', createdAt: new Date(time) })));
  const range = `dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`;
  const bounded = await read(`?actorEmail=bounds%40example.test&${range}`);
  assert.deepEqual(bounded.data.map((row: { createdAt: string }) => row.createdAt).sort(), times.slice(1, 3));
  assert.equal((await read(`?actorEmail=bounds%40example.test&dateFrom=${from}`)).data.length, 3);
  assert.equal((await read(`?actorEmail=bounds%40example.test&dateTo=${to}`)).data.length, 3);
  for (const invalid of ['activity=not-real', 'hideBackground=maybe', 'dateFrom=2026-02-30', `dateFrom=${to}&dateTo=${from}`]) {
    assert.equal((await app.request('/audit-log?' + invalid, { headers: { 'x-fixture-admin': 'yes' } })).status, 400);
  }
  await memory.insert(clientPortalAuditLogs).values([
    ...Array.from({ length: 120 }, () => ({ event: 'portal.me.view', actorEmail: 'paging@example.test', createdAt: new Date('2026-09-16T02:00:00Z') })),
    ...Array.from({ length: 5 }, () => ({ event: 'portal.labels.failed', actorEmail: 'paging@example.test', createdAt: new Date('2026-09-16T01:00:00Z') })),
  ]);
  const filteredQuery = `?actorEmail=paging%40example.test&${range}&activity=failed&hideBackground=true&limit=2`;
  const seen = new Set<number>();
  for (let page = 1; page <= 3; page++) {
    const result = await read(`${filteredQuery}&page=${page}`);
    assert.equal(result.pagination.hasMore, page < 3);
    for (const row of result.data) { assert.ok(!seen.has(row.id)); seen.add(row.id); }
  }
  assert.equal(seen.size, 5, 'filters run before pagination, beyond 120 background rows');
  await pg.exec(`create table orders (id int, store_id int, client_id int);
    create table returns (id int, order_id int, client_id int);
    create table shipments (id int, order_id int, client_id int);
    create table inventory (id int, client_id int);`);
  await memory.insert(clientPortalAuditLogs).values([77, 88].map(storeId => ({ event: 'portal.access_list.denied',
    actorEmail: 'scoped@example.test', storeIds: [77, 88], metadata: { storeId }, createdAt: new Date('2026-09-16T01:00:00Z') })));
  const storeCombined = await read(`?actorEmail=scoped%40example.test&storeId=77&search=access&activity=denied&hideBackground=true&${range}`);
  assert.equal(storeCombined.data.length, 1, 'date, actor, activity, search and store attribution intersect');
  assert.equal(storeCombined.data[0].metadata.storeId, 77);
} finally { db.select = select; db.selectDistinct = selectDistinct; db.insert = insert; await pg.close(); }
console.log('PASS audit: recorded facts, redaction, admin-only access, all-user discovery, client identity and paginated history');
