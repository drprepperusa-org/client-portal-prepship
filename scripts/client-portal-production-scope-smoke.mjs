import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const API_BASE = process.env.CLIENT_PORTAL_SMOKE_API_BASE ?? 'https://prepshipv4-api-l5xc.onrender.com';

function loadEnv() {
  const env = {};
  const text = readFileSync('.env', 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

function fail(message) {
  console.error(`client portal production scope smoke failed: ${message}`);
  process.exitCode = 1;
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

function numberList(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(Number).filter((item) => Number.isInteger(item) && item > 0))];
}

function rowVisible(row, expected) {
  const clientId = Number(row?.clientId ?? row?.client_id ?? row?.sourceClientId ?? row?.source_client_id);
  const storeId = Number(row?.storeId ?? row?.store_id ?? row?.sourceStoreId ?? row?.source_store_id);
  const assignedClientIds = numberList(row?.assignedClientIds ?? row?.assigned_client_ids ?? row?.clientIds ?? row?.client_ids);
  const storeIds = numberList(row?.storeIds ?? row?.store_ids);

  return (Number.isInteger(clientId) && expected.clientIds.includes(clientId)) ||
    (Number.isInteger(storeId) && expected.storeIds.includes(storeId)) ||
    assignedClientIds.some((id) => expected.clientIds.includes(id)) ||
    storeIds.some((id) => expected.storeIds.includes(id));
}

async function apiGet(token, path, params = {}) {
  const response = await fetch(`${API_BASE}${path}${queryString(params)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function scopedRows(token, expected, path, params = {}) {
  const clientIds = expected.clientIds.length > 0 ? expected.clientIds : [undefined];
  const pages = [];
  for (const clientId of clientIds) {
    pages.push(await apiGet(token, path, { ...params, clientId }));
  }
  const rows = pages.flatMap((page) => Array.isArray(page.body?.data) ? page.body.data : []);
  return { statuses: pages.map((page) => page.status), rows };
}

const env = { ...loadEnv(), ...process.env };
const users = [
  {
    label: 'HKP',
    email: 'hkp@gmail.com',
    password: env.HKP_PORTAL_PASSWORD,
    clientIds: [3],
    storeIds: [376759],
  },
  {
    label: 'DJC',
    email: 'djc.portal.test@drprepper.local',
    password: env.DJC_PORTAL_PASSWORD,
    clientIds: [2, 10],
    storeIds: [356678, 376661],
  },
];

if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
  fail('missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

for (const user of users) {
  if (!user.password) fail(`missing ${user.label}_PORTAL_PASSWORD`);
}

if (process.exitCode) process.exit(process.exitCode);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const checks = [
  ['orders', '/orders', { page: 1, pageSize: 50, includeTotal: true }],
  ['shipments', '/shipments', { page: 1, pageSize: 50, voided: false }],
  ['inventory', '/inventory', { page: 1, pageSize: 50, active: true }],
  ['billing-summary', '/billing/summary', { dateFrom: '2026-04-26T00:00:00.000Z', dateTo: '2026-05-26T23:59:59.999Z' }],
  ['carrier-accounts', '/carrier-accounts', {}],
];

for (const user of users) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session) {
    fail(`${user.label} login failed`);
    continue;
  }

  const payload = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString('utf8'));
  const claimClientIds = numberList(payload?.app_metadata?.clientIds ?? payload?.app_metadata?.client_ids);
  const claimStoreIds = numberList(payload?.app_metadata?.storeIds ?? payload?.app_metadata?.store_ids);
  const badClaims =
    JSON.stringify(claimClientIds) !== JSON.stringify(user.clientIds) ||
    JSON.stringify(claimStoreIds) !== JSON.stringify(user.storeIds);
  if (badClaims) {
    fail(`${user.label} claims mismatch: clientIds=${JSON.stringify(claimClientIds)} storeIds=${JSON.stringify(claimStoreIds)}`);
    continue;
  }

  console.log(`${user.label}: claims ok clientIds=${JSON.stringify(claimClientIds)} storeIds=${JSON.stringify(claimStoreIds)}`);

  for (const [name, path, params] of checks) {
    const { statuses, rows } = await scopedRows(data.session.access_token, user, path, params);
    const badStatuses = statuses.filter((status) => status < 200 || status >= 300);
    const violations = rows.filter((row) => !rowVisible(row, user));
    if (badStatuses.length > 0) fail(`${user.label} ${name} bad statuses ${statuses.join(',')}`);
    if (violations.length > 0) {
      const first = violations[0];
      fail(`${user.label} ${name} returned out-of-scope row client=${first?.clientId ?? first?.client_id ?? 'n/a'} store=${first?.storeId ?? first?.store_id ?? 'n/a'}`);
    }
    console.log(`${user.label}: ${name} rows=${rows.length} statuses=${statuses.join(',')} violations=${violations.length}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log('PASS client portal production scope smoke');
