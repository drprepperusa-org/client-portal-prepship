import 'dotenv/config';
import { createHmac } from 'node:crypto';

type AccountTarget = {
  account: string;
  userId: string;
  clientIds: number[];
  storeIds: number[];
  clients: Array<{ id: number; name: string }>;
};

const stableApiBase = (
  process.env.CLIENT_PORTAL_VERIFY_STABLE_API_BASE ||
  process.env.API_BASE ||
  'https://prepshipv4-api-l5xc.onrender.com'
).replace(/\/+$/, '');
const portalApiBase = (
  process.env.CLIENT_PORTAL_VERIFY_PORTAL_API_BASE ||
  process.env.CLIENT_PORTAL_VERIFY_API_BASE ||
  stableApiBase
).replace(/\/+$/, '');

const jwtSecret = process.env.SUPABASE_JWT_SECRET;
if (!jwtSecret) {
  throw new Error('SUPABASE_JWT_SECRET is required to mint verifier tokens');
}

const statuses = ['awaiting_shipment', 'shipped', 'cancelled'] as const;

const accounts: AccountTarget[] = [
  {
    account: 'djc.portal.test@drprepper.local',
    userId: '97f43b30-7d4a-405b-8048-344a32b2da19',
    clientIds: [2, 10],
    storeIds: [356678, 376661],
    clients: [
      { id: 2, name: 'eBay - DJC' },
      { id: 10, name: 'Walmart - DJC' },
    ],
  },
  {
    account: 'hkp@gmail.com',
    userId: '58ecd4f0-b586-4e2b-8cb9-dee3c809fc4b',
    clientIds: [3],
    storeIds: [376759],
    clients: [{ id: 3, name: 'Heritage Kids Press' }],
  },
];

function b64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const full = {
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 1800,
    ...payload,
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(full));
  const sig = createHmac('sha256', jwtSecret!)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

function adminToken() {
  return sign({
    sub: '00000000-0000-0000-0000-000000000001',
    email: 'admin@drprepper.com',
    app_metadata: {
      role: 'admin',
      permissions: ['scope:global'],
    },
  });
}

function accountToken(account: AccountTarget) {
  return sign({
    sub: account.userId,
    email: account.account,
    app_metadata: {
      role: 'client_user',
      clientIds: account.clientIds,
      storeIds: account.storeIds,
      permissions: ['settings:read', 'credentials:read', 'financials:read'],
    },
  });
}

async function orderTotal(
  baseUrl: string,
  token: string,
  clientId: number,
  status: string,
  path = '/orders',
) {
  const url = new URL(path, baseUrl);
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', '5');
  url.searchParams.set('includeTotal', 'true');
  url.searchParams.set('clientId', String(clientId));
  url.searchParams.set('status', status);

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
  }
  const json = JSON.parse(text) as {
    data?: unknown[];
    pagination?: { total?: number | string };
  };
  return Number(json.pagination?.total ?? json.data?.length ?? 0);
}

async function main() {
  const admin = adminToken();
  const rows: Array<{
    account: string;
    client: string;
    status: string;
    stableTotal: number;
    portalTotal: number;
    match: boolean;
  }> = [];

  for (const account of accounts) {
    const portal = accountToken(account);
    for (const client of account.clients) {
      for (const status of statuses) {
        const [stableTotal, portalTotal] = await Promise.all([
          orderTotal(stableApiBase, admin, client.id, status),
          orderTotal(portalApiBase, portal, client.id, status, '/api/client-portal/orders'),
        ]);
        rows.push({
          account: account.account,
          client: client.name,
          status,
          stableTotal,
          portalTotal,
          match: stableTotal === portalTotal,
        });
      }
    }
  }

  console.log(`Client portal live parity: stable=${stableApiBase} portal=${portalApiBase}`);
  console.table(rows);

  const failures = rows.filter((row) => !row.match);
  if (failures.length > 0) {
    console.error(
      `FAIL: ${failures.length} portal total(s) do not match PrepShip stable/admin totals. ` +
        'Client portal API is not returning the same scoped live totals as PrepShip stable.',
    );
    process.exit(1);
  }
  console.log('PASS: every scoped portal account matches PrepShip stable/admin totals.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
