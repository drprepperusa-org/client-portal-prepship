// Pins the portal store-connect trust boundary (spec 2026-07-08):
//  - portal submissions stay source='portal', active=false
//  - non-admin clientId is forced from scope (resolveSubmittedClientId)
//  - shopify canonical domain is derived server-side at submit
//  - validate/reconnect are rate-limited and never echo credentials
// CRLF-tolerant: substring checks only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSourceTree } from './lib/source-tree.mjs';

const route = readSourceTree([
  'src/routes/client-portal/integrations.ts',
  'src/routes/client-portal/integrations',
]).replace(/\r\n/g, '\n');
assert(route.includes("account.source = 'portal'"), 'portal submit must force source=portal');
assert(/'portal',\n\s+false/.test(route), 'portal submit must insert active=false');
assert(route.includes('resolveSubmittedClientId'), 'portal submit must force clientId from scope');
assert(route.includes('checkValidationRateLimit'), 'validate/reconnect must be rate-limited');
assert(route.includes('verified.myshopifyDomain'), 'shopify identifier must come from live verification');
assert(route.includes('shopifyConnectError'), 'shopify scope failures must return an actionable reconnect message');
assert(!route.includes("row.lastSyncError !== 'auth'"), 'shopify reconnect must not be blocked when scope repair is needed');
assert(!route.includes('accessToken:'), 'route must never build a response containing a token');
assert(!route.includes('clientSecret:'), 'route must never build a response containing a client secret');
assert(route.includes('submittedFields'), 'audit rows record credential field NAMES only (submittedFields key survives the sanitizer)');
assert(!route.includes('admin required'), 'submit endpoint must be open to client users');
assert(route.includes('verified.myshopifyDomain !== row.accountIdentifier'), 'reconnect must pin the canonical domain');
assert(route.includes("app.delete('/integrations/:id'"), 'client portal must expose a scoped store disconnect endpoint');
assert(route.includes('delete from store_accounts'), 'store disconnect must delete the shared store_accounts row so PrepShip and portal stay in sync');
assert(!route.includes('set active = false'), 'store disconnect must not only soft-disable the shared connection');
assert(route.includes('delete from clients') && route.includes('syntheticStoreIdForCredentialAccount'), 'store disconnect must best-effort remove the synthetic store client row');
assert(route.includes('portal.integrations.disconnect'), 'store disconnect must write an audit event');
assert(route.includes("app.post('/integrations/:id/approve'"), 'client portal must expose an admin store approval endpoint');
assert(route.includes("if (!isAdmin) return c.json({ error: 'admin access required' }, 403)"), 'store approval must be portal-admin gated');
assert(route.includes("set source = 'admin'") && route.includes('active = true'), 'store approval must promote source=admin and activate the store');
assert(route.includes('sync_anchor_at = coalesce(sync_anchor_at, now())'), 'store approval must stamp the sync anchor exactly once');
assert(
  route.includes('syntheticStoreClientName') &&
    route.includes('const syntheticStoreId = syntheticStoreIdForCredentialAccount(row.provider, row.id);') &&
    route.includes('insert into clients (name, store_ids, active, is_test)') &&
    route.includes('where not exists'),
  'store approval must auto-create the synthetic client/store mapping',
);
assert(route.includes('portal.integrations.approve'), 'store approval must write an audit event');

const helpers = readFileSync('src/lib/client-portal/integration-submission.ts', 'utf8').replace(/\r\n/g, '\n');
assert(helpers.includes('clientIds.includes(args.bodyClientId)'), 'cross-client injection check must exist');
assert(helpers.includes('VALIDATION_MAX_ATTEMPTS = 5'), 'validation limiter is 5 attempts/window');

const modal = readSourceTree([
  'portal-client/src/components/store/StoreConnectModal.tsx',
  'portal-client/src/components/store/connect',
]).replace(/\r\n/g, '\n');
assert(
  modal.includes('read_customers') && modal.includes('read_draft_orders') && modal.includes('write_orders'),
  'Shopify connect modal must list the operational Admin API scopes PrepShip requires',
);
assert(
  modal.includes("stage === 'list' ? 'h-[88vh] max-h-[640px] max-w-4xl' : 'max-w-lg'"),
  'store picker modal list stage must keep a stable viewport-capped height',
);
assert(
  modal.includes('className="min-h-0 flex-1 overflow-y-auto p-5"'),
  'store picker cards pane must scroll inside the stable modal frame',
);

const connections = readFileSync('portal-client/src/pages/Connections.tsx', 'utf8').replace(/\r\n/g, '\n');
const connectionDto = readFileSync('src/lib/client-portal/dto.ts', 'utf8').replace(/\r\n/g, '\n');
assert(
  connectionDto.includes("normalized === 'missing_scopes'") &&
    connectionDto.includes("connectionStatus: 'reconnect'") &&
    connections.includes("c.connectionStatus === 'reconnect'") &&
    !connections.includes('needsStoreReconnect'),
  'backend must own reconnect policy and Connections must render the safe status',
);
assert(
  connections.includes('portalApi.disconnectIntegration') &&
    connections.includes("toast.success('Deleted'") &&
    connections.includes('setDisconnectTarget') &&
    connections.includes('title="Delete connection"') &&
    !connections.includes('Disconnect gated'),
  'Connections delete button must open a confirmation modal before calling the API',
);
assert(
  connections.includes('handleApprove') &&
    connections.includes('portalApi.approveIntegration') &&
    connections.includes('Connection approved') &&
    connections.includes('{isAdmin ? (') &&
    connections.includes('onClick={() => void handleApprove(p)}') &&
    connections.includes('loading={approvingId === p.id}'),
  'Connections pending store card must show an admin-only Approve button that calls the portal approval API',
);

const api = readFileSync('portal-client/src/lib/api/domains/connections.ts', 'utf8').replace(/\r\n/g, '\n');
assert(
  api.includes('disconnectIntegration: (token: string, id: number)') &&
    /apiDelete<\{ data: \{ id: number; deleted: boolean; cascadedClientId: number \| null \} \}>\([\s\S]*?`\/api\/client-portal\/integrations\/\$\{id\}`/.test(api),
  'portal API client must expose DELETE /client-portal/integrations/:id',
);
assert(
  api.includes('approveIntegration: (token: string, id: number)') &&
    /apiPost<\{ data: PortalIntegration \}>\([\s\S]*?`\/api\/client-portal\/integrations\/\$\{id\}\/approve`/.test(api),
  'portal API client must expose POST /client-portal/integrations/:id/approve',
);

const adminApi = readFileSync('web/src/lib/api.ts', 'utf8').replace(/\r\n/g, '\n');
assert(
  adminApi.includes("storeAccounts(token: string, options: { source?: string; pending?: boolean } = {})") &&
    adminApi.includes("apiGet<{ data: StoreAccount[]; pending?: boolean }>(token, '/store-accounts'") &&
    adminApi.includes("updateStoreAccount(token: string, id: number, body: Record<string, unknown>)") &&
    adminApi.includes("apiSend<{ data: StoreAccount | null }>(token, 'PATCH', '/store-accounts'"),
  'admin API client must list pending store accounts and PATCH approvals',
);

const adminQueries = readFileSync('web/src/lib/portalQueries.ts', 'utf8').replace(/\r\n/g, '\n');
assert(
  adminQueries.includes('usePendingStoreAccountsQuery') &&
    adminQueries.includes("portalApi.storeAccounts(token!, { source: 'portal', pending: true })") &&
    adminQueries.includes('useApproveStoreAccountMutation') &&
    adminQueries.includes("portalApi.updateStoreAccount(token, id, { source: 'admin' })"),
  'admin query layer must fetch source=portal pending stores and approve by promoting source=admin',
);

const adminSettings = readFileSync('web/src/pages/Settings.tsx', 'utf8').replace(/\r\n/g, '\n');
assert(
  adminSettings.includes('PendingStoreApprovals') &&
    adminSettings.includes('Admin notification:') &&
    adminSettings.includes('portal-settings-tab-badge') &&
    adminSettings.includes('approvePendingStore') &&
    adminSettings.includes('Shopify sync will start on the next tick'),
  'admin Settings page must surface pending store approvals with a visible count and Approve action',
);

const main = readFileSync('src/main.ts', 'utf8').replace(/\r\n/g, '\n');
assert(
  main.includes("import storeAccountsRoute from './routes/store-accounts'") &&
    main.includes("'/store-accounts'") &&
    main.includes("app.route('/store-accounts', storeAccountsRoute)"),
  'Hono API must mount /store-accounts for production admin approval calls',
);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:portal-store-connect'] === 'node scripts/portal-store-connect-guard.mjs',
  'package.json must expose guard:portal-store-connect',
);
console.log('PASS portal store connect guard');
