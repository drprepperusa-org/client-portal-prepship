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

// Exercise the actual HTTP selector/DTO with an isolated in-memory query seam.
// No database connection, credentials, provider calls or live audit inserts.
process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/audit_fixture';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.SUPABASE_JWT_SECRET = 'test';
const { Hono } = await import('hono');
const { db } = await import('../src/db/client');
const { clientPortalAuditLogs } = await import('../src/db/schema/client-portal-audit-logs');
const { default: auditRoute } = await import('../src/routes/client-portal/audit-log');
const fixture = { id: 7, event: 'portal.orders.detail.view', actorUserId: 'user-1', actorEmail: 'operator@example.test',
  clientIds: [], storeIds: [], metadata: { orderId: 22, orderNumber: '4002', apiToken: 'secret-value' }, createdAt: new Date('2026-09-15T03:00:00Z') };
let selects = 0;
const select = db.select;
const insert = db.insert;
try {
  db.select = (() => ({ from: (table: unknown) => {
    selects++;
    const result = table === clientPortalAuditLogs ? [fixture] : [];
    const query = { where: () => query, orderBy: () => query, limit: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  } })) as typeof db.select;
  db.insert = (() => ({ values: async () => undefined })) as unknown as typeof db.insert;
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
  const response = await app.request('/audit-log', { headers: { 'x-fixture-admin': 'yes' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data[0].createdAt, '2026-09-15T03:00:00.000Z');
  assert.equal(body.data[0].activity.category, 'Data request');
  assert.ok(body.data[0].activity.details.some((field: { value: string }) => field.value === '4002'));
  assert.equal(body.data[0].metadata.apiToken, '[redacted]');
  assert.doesNotMatch(JSON.stringify(body), /secret-value/);
} finally { db.select = select; db.insert = insert; }
console.log('PASS detailed audit activity: recorded facts, redaction, outcomes and admin-only HTTP DTO');
