import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
// CP-054 — Connections must be a tenant-safe backend projection: backend-owned
// status, masked display identifiers, safe reason codes, honest DB failures,
// and no global worker diagnostics in customer JSON or bundle contracts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = false;
function check(condition: boolean, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else {
    console.error(`FAIL: ${message}`);
    failed = true;
  }
}

// The read-model accepts an injected executor for deterministic failure tests;
// these values keep module initialization offline and never open a connection.
process.env.DATABASE_URL ||= 'postgres://user:pass@localhost:5432/cp054';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_JWT_SECRET ||= 'test';

const dto = await import('../src/lib/client-portal/dto');
const integrations = await import('../src/lib/client-portal/read-models/integrations');

const rawIdentifier = 'private-shop.myshopify.com';
const rawError = 'auth';
const reconnect = dto.toPortalIntegrationDto({
  id: 9,
  type: 'store',
  accountIdentifier: rawIdentifier,
  source: 'admin',
  active: true,
  lastSyncError: rawError,
  lastSyncedAt: '2026-07-14T01:00:00.000Z',
});
const serialized = JSON.stringify(reconnect);
check(reconnect.connectionStatus === 'reconnect', 'backend maps auth failure to reconnect status');
check(
  reconnect.reconnectReasonCode === 'authentication_required',
  'backend maps raw auth detail to a safe reconnect reason code',
);
check(
  reconnect.displayAccountIdentifier != null && reconnect.displayAccountIdentifier !== rawIdentifier,
  'backend returns a masked display identifier',
);
check(
  dto.toPortalIntegrationDto({ accountIdentifier: '1234' }).displayAccountIdentifier === '••••',
  'short account numbers are fully masked instead of echoed with an ellipsis',
);
check(!serialized.includes(rawIdentifier), 'customer DTO contains no raw identifier value');
check(
  !('accountIdentifier' in reconnect) &&
    !('lastSyncError' in reconnect) &&
    !('source' in reconnect) &&
    !('active' in reconnect),
  'customer DTO omits raw policy and identifier fields',
);

check(
  dto.toPortalIntegrationDto({ type: 'store', source: 'portal', active: false, lastSyncError: 'auth' })
    .connectionStatus === 'pending',
  'pending approval takes precedence for unsynced portal submissions',
);
check(
  dto.toPortalIntegrationDto({ type: 'store', source: 'admin', active: true }).connectionStatus === 'active',
  'backend emits active status',
);
check(
  dto.toPortalIntegrationDto({ type: 'store', source: 'admin', active: false }).connectionStatus === 'inactive',
  'backend emits inactive status',
);
check(
  dto.toPortalIntegrationDto({ type: 'store', source: 'admin', active: true, lastSyncError: 'network' })
    .connectionStatus === 'degraded',
  'unknown/transient raw errors become degraded without exposing detail',
);
check(
  !JSON.stringify(
    dto.toPortalIntegrationDto({
      type: 'store',
      source: 'admin',
      active: true,
      lastSyncError: 'network: tenant-secret-detail',
    }),
  ).includes('tenant-secret-detail'),
  'detailed sync error text never crosses the customer DTO',
);
check(
  dto.toPortalIntegrationDto({ type: 'store', source: 'admin', active: true, lastSyncError: 'missing_scopes' })
    .reconnectReasonCode === 'permissions_required',
  'missing scopes map to the safe permissions reason',
);

const scope = {
  clientIds: [41],
  storeIds: [],
  isGlobal: false,
  isRestricted: true,
  userId: 'cp054-test',
  permissions: [],
  canViewFinancials: false,
  canViewCredentials: false,
  auditSource: 'foreground',
} as never;

let compatibilityCalls = 0;
const fallbackRows = await integrations.listPortalStoreIntegrations(scope, async () => {
  compatibilityCalls += 1;
  if (compatibilityCalls === 1) {
    throw Object.assign(new Error('column "last_sync_error" does not exist'), { code: '42703' });
  }
  return [
    {
      id: 1,
      clientId: 41,
      provider: 'shopify',
      label: 'Scoped store',
      accountIdentifier: rawIdentifier,
      source: 'admin',
      active: true,
      createdAt: null,
      updatedAt: null,
    },
  ];
});
check(compatibilityCalls === 2 && fallbackRows.length === 1, 'known missing freshness column uses the legacy query once');

await assert.rejects(
  integrations.listPortalStoreIntegrations(scope, async () => {
    throw Object.assign(new Error('database connection terminated'), { code: '57P01' });
  }),
  /database connection terminated/,
  'operational DB failure propagates instead of becoming an empty connections list',
);
console.log('ok: operational DB failure propagates instead of becoming an empty connections list');

await assert.rejects(
  integrations.listPortalStoreIntegrations(scope, async () => {
    throw Object.assign(new Error('column "credentials" does not exist'), { code: '42703' });
  }),
  /credentials/,
  'unrelated missing-column failures do not trigger compatibility fallback',
);
console.log('ok: unrelated missing-column failures do not trigger compatibility fallback');

const readModel = read('src/lib/client-portal/read-models/integrations.ts');
check(
  readModel.includes('scope.clientIds.map') && readModel.includes('sql`and false`'),
  'store query remains client-scoped and fail-closed when restricted scope has no client IDs',
);
check(!readModel.includes('return [];'), 'read-model has no DB-error-to-empty-list path');

const integrationsRoute = read('src/routes/client-portal/integrations.ts');
check(
  integrationsRoute.includes("return c.json({ error: 'connections_unavailable' }, 503)"),
  'connections route returns explicit 503 on read failure',
);
check(
  integrationsRoute.includes('displayAccountIdentifier: maskAccountIdentifier(result.myshopifyDomain)'),
  'live validation masks the canonical Shopify domain before responding',
);

const syncRoute = read('src/routes/client-portal/sync.ts');
check(
  syncRoute.includes('listPortalStoreIntegrations(scope)') &&
    syncRoute.includes("? 'attention'") &&
    syncRoute.includes('connectionStatus, lastSyncAt, connections'),
  'sync endpoint owns the tenant-scoped aggregate status and connection freshness',
);
check(
  !syncRoute.includes('getPersistedWorkerStatus') &&
    !syncRoute.includes('getSyncStatus') &&
    !syncRoute.includes('getShipmentSyncStatus') &&
    !syncRoute.includes('queue:'),
  'sync endpoint contains no global worker/order/shipment/queue diagnostics',
);
check(
  syncRoute.includes("return c.json({ error: 'connection_freshness_unavailable' }, 503)"),
  'sync freshness DB failure is explicit',
);

const api = readActiveClientPortalApiSource();
const integrationContract = /export interface PortalIntegration \{[\s\S]*?\n\}/.exec(api)?.[0] ?? '';
const syncContract = /export interface SyncStatus \{[\s\S]*?\n\}/.exec(api)?.[0] ?? '';
check(
  integrationContract.includes('connectionStatus: PortalConnectionStatus') &&
    integrationContract.includes('displayAccountIdentifier: string | null') &&
    !/\baccountIdentifier\s*[?:]/.test(integrationContract) &&
    !integrationContract.includes('lastSyncError'),
  'frontend contract requires backend status and safe display identifier only',
);
check(
  syncContract.includes("connectionStatus: 'attention' | 'active' | 'pending' | 'inactive' | 'not_connected'") &&
    syncContract.includes('connections: Array') &&
    !syncContract.includes('orders?') &&
    !syncContract.includes('shipments?') &&
    !syncContract.includes('worker?'),
  'frontend sync contract has tenant connection freshness only',
);

const page = read('portal-client/src/pages/Connections.tsx');
const card = read('portal-client/src/components/store/ConnectionCard.tsx');
check(
  page.includes("row.connectionStatus === 'pending'") &&
    page.includes("c.connectionStatus === 'reconnect'") &&
    !page.includes('lastSyncError') &&
    !page.includes('needsStoreReconnect') &&
    !page.includes('storeStatus('),
  'Connections renders backend status without frontend policy',
);
check(
  card.includes('c.displayAccountIdentifier') &&
    card.includes('c.lastSyncedAt') &&
    !card.includes('c.accountIdentifier') &&
    !card.includes('c.active'),
  'ConnectionCard renders masked identifier and backend freshness/status fields',
);
const topbar = read('portal-client/src/components/layout/Topbar.tsx');
check(
  topbar.includes('connectionFreshnessMeta(sync.data?.connectionStatus)') &&
    !topbar.includes("lastSync ? 'bg-emerald-500'") &&
    !topbar.includes("You're all caught up."),
  'Topbar renders backend-owned aggregate connection status without timestamp health policy',
);
const hooks = read('portal-client/src/lib/hooks.ts');
check(
  hooks.includes('const waitForForegroundQueries = async () =>') &&
    hooks.includes('qc.isFetching() > 0') &&
    hooks.includes('await qc.prefetchQuery') &&
    !hooks.split('\n').some((line) => line.trimStart().startsWith('qc.prefetchQuery(')),
  'shell waits for foreground reads and serializes speculative prefetches',
);
const matrix = read('docs/source-of-truth-matrix.md');
check(
  matrix.includes('| Connection status | `connectionStatus` | `connectionStatus` |') &&
    matrix.includes('| Account identifier | `displayAccountIdentifier` | `displayAccountIdentifier` |') &&
    matrix.includes('global\nworker/order/shipment diagnostics are backend-only'),
  'SOT matrix documents the CP-054 owner, masking, freshness, and diagnostics boundary',
);

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
assert.equal(
  pkg.scripts?.['test:client-portal-connections-cp054'],
  'tsx scripts/client-portal-connections-cp054-guard.ts',
  'package.json exposes the CP-054 guard',
);
console.log('ok: package.json exposes the CP-054 guard');

if (failed) process.exit(1);
console.log('\nCP-054 Connections guard passed.');
