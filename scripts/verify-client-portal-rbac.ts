import 'dotenv/config';
import { createHmac } from 'node:crypto';

const apiBase = (
  process.env.CLIENT_PORTAL_VERIFY_PORTAL_API_BASE ||
  process.env.CLIENT_PORTAL_VERIFY_API_BASE ||
  'https://client-portal-prepship.onrender.com'
).replace(/\/+$/, '');

const jwtSecret = process.env.SUPABASE_JWT_SECRET;
if (!jwtSecret) throw new Error('SUPABASE_JWT_SECRET is required to mint verifier tokens');

function b64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const full = { aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 1800, ...payload };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(full));
  const sig = createHmac('sha256', jwtSecret!).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const tokens = {
  admin: sign({
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'admin@drprepper.com',
    app_metadata: { role: 'admin', permissions: ['scope:global'] },
  }),
  hkp: sign({
    sub: '58ecd4f0-b586-4e2b-8cb9-dee3c809fc4b',
    email: 'hkp@gmail.com',
    app_metadata: { role: 'client_user', clientIds: [3], storeIds: [376759], permissions: ['settings:read'] },
  }),
  djc: sign({
    sub: '97f43b30-7d4a-405b-8048-344a32b2da19',
    email: 'djc.portal.test@drprepper.local',
    app_metadata: { role: 'client_user', clientIds: [2, 10], storeIds: [356678, 376661], permissions: ['settings:read'] },
  }),
};

async function getJson(token: string, path: string) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 240)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

function total(payload: Record<string, unknown>) {
  const pagination = payload.pagination as { total?: number | string } | undefined;
  return Number(pagination?.total ?? (Array.isArray(payload.data) ? payload.data.length : 0));
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  const adminMe = await getJson(tokens.admin, '/api/client-portal/me');
  assert(adminMe.isAdmin === true && adminMe.isGlobal === true, 'admin@drprepper.com must be global admin');

  const hkpMe = await getJson(tokens.hkp, '/api/client-portal/me');
  assert(hkpMe.isAdmin === false && hkpMe.isRestricted === true, 'hkp@gmail.com must be restricted');
  assert(JSON.stringify(hkpMe.clientIds) === '[3]', 'hkp@gmail.com must only have Heritage clientId 3');

  const djcClients = await getJson(tokens.djc, '/api/client-portal/clients');
  const djcClientIds = (djcClients.data as Array<{ id: number }>).map((row) => row.id).sort((a, b) => a - b);
  assert(JSON.stringify(djcClientIds) === '[2,10]', 'DJC portal must only see eBay/Walmart DJC clients');

  const hkpDjcOrders = await getJson(tokens.hkp, '/api/client-portal/orders?page=1&pageSize=1&status=shipped&clientId=2');
  assert(total(hkpDjcOrders) === 0, 'HKP must not see DJC shipped orders');

  const hkpOwnOrders = await getJson(tokens.hkp, '/api/client-portal/orders?page=1&pageSize=1&status=shipped&clientId=3');
  assert(total(hkpOwnOrders) > 0, 'HKP should see its own Heritage shipped orders');

  const hkpReports = await getJson(
    tokens.hkp,
    '/api/client-portal/reports?dateFrom=2026-04-27T00:00:00.000Z&dateTo=2026-05-27T23:59:59.999Z',
  );
  assert(hkpReports.billingVisible === false, 'HKP must not receive billing visibility by default');

  console.log(`PASS: client portal RBAC verified against ${apiBase}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
