// Pins the portal store-connect trust boundary (spec 2026-07-08):
//  - portal submissions stay source='portal', active=false
//  - non-admin clientId is forced from scope (resolveSubmittedClientId)
//  - shopify canonical domain is derived server-side at submit
//  - validate/reconnect are rate-limited and never echo credentials
// CRLF-tolerant: substring checks only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/routes/client-portal/integrations.ts', 'utf8').replace(/\r\n/g, '\n');
assert(route.includes("account.source = 'portal'"), 'portal submit must force source=portal');
assert(route.includes("'portal',\n        false"), 'portal submit must insert active=false');
assert(route.includes('resolveSubmittedClientId'), 'portal submit must force clientId from scope');
assert(route.includes('checkValidationRateLimit'), 'validate/reconnect must be rate-limited');
assert(route.includes('verified.myshopifyDomain'), 'shopify identifier must come from live verification');
assert(!route.includes('accessToken:'), 'route must never build a response containing a token');
assert(!route.includes('clientSecret:'), 'route must never build a response containing a client secret');
assert(route.includes('submittedFields'), 'audit rows record credential field NAMES only (submittedFields key survives the sanitizer)');
assert(!route.includes('admin required'), 'submit endpoint must be open to client users');
assert(route.includes('verified.myshopifyDomain !== row.accountIdentifier'), 'reconnect must pin the canonical domain');
assert(route.includes("app.delete('/integrations/:id'"), 'client portal must expose a scoped store disconnect endpoint');
assert(route.includes('set active = false'), 'store disconnect must be a soft disconnect via active=false');
assert(route.includes('portal.integrations.disconnect'), 'store disconnect must write an audit event');

const helpers = readFileSync('src/lib/client-portal/integration-submission.ts', 'utf8').replace(/\r\n/g, '\n');
assert(helpers.includes('clientIds.includes(args.bodyClientId)'), 'cross-client injection check must exist');
assert(helpers.includes('VALIDATION_MAX_ATTEMPTS = 5'), 'validation limiter is 5 attempts/window');

const modal = readFileSync('portal-client/src/components/store/StoreConnectModal.tsx', 'utf8').replace(/\r\n/g, '\n');
assert(
  modal.includes("stage === 'list' ? 'h-[88vh] max-h-[640px] max-w-4xl' : 'max-w-lg'"),
  'store picker modal list stage must keep a stable viewport-capped height',
);
assert(
  modal.includes('className="min-h-0 flex-1 overflow-y-auto p-5"'),
  'store picker cards pane must scroll inside the stable modal frame',
);

const connections = readFileSync('portal-client/src/pages/Connections.tsx', 'utf8').replace(/\r\n/g, '\n');
assert(
  connections.includes('portalApi.disconnectIntegration') &&
    connections.includes("toast.success('Deactivated'") &&
    connections.includes('setDisconnectTarget') &&
    connections.includes('title="Deactivate connection"') &&
    !connections.includes('Disconnect gated'),
  'Connections disconnect button must open a confirmation modal before calling the API',
);

const api = readFileSync('portal-client/src/lib/api.ts', 'utf8').replace(/\r\n/g, '\n');
assert(
  api.includes('disconnectIntegration: (token: string, id: number)') &&
    api.includes('apiDelete<{ data: { id: number; disconnected: boolean } }>(token, `/api/client-portal/integrations/${id}`)'),
  'portal API client must expose DELETE /client-portal/integrations/:id',
);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert(
  pkg.scripts?.['guard:portal-store-connect'] === 'node scripts/portal-store-connect-guard.mjs',
  'package.json must expose guard:portal-store-connect',
);
console.log('PASS portal store connect guard');
