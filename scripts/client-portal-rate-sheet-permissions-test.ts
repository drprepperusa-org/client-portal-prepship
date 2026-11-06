import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { loadFixtureModule } from './lib/load-fixture-module';
process.env.DATABASE_URL = 'postgres://fixture:fixture@127.0.0.1:1/rate_permissions';
process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_ANON_KEY = 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
process.env.SUPABASE_JWT_SECRET = 'fixture';
process.env.PREPSHIP_API_URL = 'https://rates.fixture.test';
const { supabaseAdmin } = await import('../src/lib/supabase');
const shared = await import('../src/routes/client-portal/access/shared');
const audit: any[] = [];
let auditFails = false, lookupFails = false, writes = 0;
let actor: any = { id: 'admin', email: 'admin@fixture.test', app_metadata: { role: 'admin' } };
const target: any = { id: 'client', email: 'client@fixture.test', app_metadata: { role: 'client_user', clientIds: [1], permissions: ['financials:read', 'settings:read'] } };
supabaseAdmin.auth.admin.getUserById = (async (id: string) => ({ data: { user: id === 'admin' ? actor : target }, error: lookupFails ? new Error('offline') : null })) as any;
supabaseAdmin.auth.admin.updateUserById = (async (_id: string, patch: any) => { writes++; Object.assign(target, patch); return { data: { user: target }, error: null }; }) as any;
const { registerAccessUserMutationRoutes } = loadFixtureModule('src/routes/client-portal/access/users.ts', {
  '../../../lib/supabase': { supabaseAdmin },
  '../../../lib/client-portal/audit': { recordPortalAudit: async (...args: any[]) => { audit.push(args); } },
  './shared': { ...shared, requireAccessMutationAudit: async (c: any, _event: string, _scope: unknown, details: unknown) => {
    if (auditFails) return c.json({ error: 'Audit unavailable' }, 503);
    audit.push(details); return null;
  } },
});
function appFor(global = true) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries({ userId: 'admin', email: 'admin@fixture.test', role: global ? 'admin' : 'client_user', permissions: ['financials:read','users:manage'], clientIds: [1], storeIds: [] })) c.set(key as never, value as never);
    await next();
  });
  registerAccessUserMutationRoutes(app); return app;
}
const patch = (enabled: boolean, global = true) => appFor(global).request('/access-list/client', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ canEditRateSheet: enabled }) });
assert.equal((await patch(true, false)).status, 403); assert.equal(writes, 0);
assert.equal((await patch(true)).status, 200);
assert.deepEqual(target.app_metadata.permissions, ['financials:read','settings:read','rate-sheet:write']);
assert.deepEqual(target.app_metadata.clientIds, [1]);
assert.equal((await patch(false)).status, 200);
assert.deepEqual(target.app_metadata.permissions, ['financials:read','settings:read']);
actor.app_metadata.role = 'client_user'; actor.app_metadata.permissions = ['scope:global'];
assert.equal((await patch(true)).status, 403, 'Old admin JWT cannot grant financial editing.');
actor.app_metadata.role = 'admin'; actor.banned_until = '2099-01-01';
assert.equal((await patch(true)).status, 403);
delete actor.banned_until; lookupFails = true;
assert.equal((await patch(true)).status, 503); lookupFails = false; auditFails = true;
assert.equal((await patch(true)).status, 503); assert.equal(writes, 2);
assert.ok(audit.length >= 4);

const { proxyRateSheetCommand } = await import('../src/lib/client-portal/prepship-rate-sheet-proxy');
const original = globalThis.fetch;
let payload: any = { ok: true, unitCost: '99', credentials: 'must not leak' }, status = 200;
globalThis.fetch = (async (input: any, init: any) => {
  assert.equal(String(input), 'https://rates.fixture.test/billing/rate-sheet/package');
  assert.equal(new Headers(init.headers).get('authorization'), 'Bearer exact-user-token');
  assert.equal(new Headers(init.headers).get('x-request-id'), 'request-test');
  assert.deepEqual(JSON.parse(init.body), { clientId: 1, packageId: 2, price: '0.20' });
  return Response.json(payload, { status });
}) as typeof fetch;
try {
  const call = () => proxyRateSheetCommand('package', 'Bearer exact-user-token', { clientId: 1, packageId: 2, price: '0.20' }, 'request-test');
  assert.deepEqual(await call(), { status: 200, data: { ok: true } });
  const rateRoute = loadFixtureModule('src/routes/client-portal/rate-sheet.ts', {
    '../../lib/client-portal/prepship-rate-sheet-proxy': { proxyRateSheetCommand },
    '../../lib/client-portal/read-models/rate-sheet': { listPortalRateSheets: async () => [] },
    '../../lib/client-portal/audit': { recordPortalAudit: async () => {} },
  }).default;
  const ratesApp = appFor(false);
  ratesApp.route('/', rateRoute);
  const request = () => ratesApp.request('/rate-sheet/package', { method: 'POST',
    headers: { authorization: 'Bearer exact-user-token', 'x-request-id': 'request-test', 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: 1, packageId: 2, price: '0.20' }),
  });
  assert.equal((await request()).status, 200, 'Real portal POST route forwards to the canonical command.');
  assert.equal((await ratesApp.request('/rate-sheet/unknown', { method: 'POST' })).status, 404);
  assert.equal((await ratesApp.request('/rate-sheet/package', { method: 'POST' })).status, 401);
  status = 403; payload = { error: 'Permission revoked' };
  assert.deepEqual(await call(), { status: 403, data: payload });
  assert.equal((await request()).status, 403, 'Real route preserves upstream permission denial.');
  status = 200; payload = { credentials: 'bad response' };
  await assert.rejects(call(), /Invalid rate sheet response/);
} finally { globalThis.fetch = original; }
await (await import('../src/db/client')).sql.end();
console.log('PASS fresh-admin grant/revoke, preserved permissions/scope, audit denial and exact-user thin proxy');
