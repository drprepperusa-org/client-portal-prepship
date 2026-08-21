import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canManageAccessTarget, isAccessAssignmentWithinBoundary } from '../src/lib/client-portal/access-policy';
import { clientPortalCapabilities } from '../src/lib/client-portal/capabilities';
import {
  inviteErrorDiagnostic,
  isExistingInviteAccountError,
} from '../src/lib/client-portal/invite-errors';

assert.equal(isExistingInviteAccountError({ code: 'user_already_exists' }), true);
assert.equal(isExistingInviteAccountError({ message: 'User already registered' }), true);
assert.equal(isExistingInviteAccountError({ status: 500, message: {} }), false);
assert.deepEqual(inviteErrorDiagnostic({ status: 500, code: 'unexpected_failure', message: {} }), {
  status: 500,
  code: 'unexpected_failure',
  message: '{}',
});

const globalCapabilities = clientPortalCapabilities({ isGlobal: true, permissions: [] });
assert.deepEqual(globalCapabilities, {
  canManageUsers: true,
  canManageAdmins: true,
  canViewAudit: true,
  canReceiveInventory: true,
  canInspectReturns: true,
  canRequestReplacements: true,
});

const scopedCapabilities = clientPortalCapabilities({ isGlobal: false, permissions: ['users:manage'] });
assert.deepEqual(scopedCapabilities, {
  canManageUsers: true,
  canManageAdmins: false,
  canViewAudit: false,
  canReceiveInventory: false,
  canInspectReturns: false,
  canRequestReplacements: false,
});
assert.deepEqual(clientPortalCapabilities({ isGlobal: false, permissions: [] }), {
  canManageUsers: false,
  canManageAdmins: false,
  canViewAudit: false,
  canReceiveInventory: false,
  canInspectReturns: false,
  canRequestReplacements: false,
});
assert.equal(
  clientPortalCapabilities({ isGlobal: false, permissions: ['settings:write'] }).canReceiveInventory,
  true,
);
assert.equal(
  clientPortalCapabilities({ isGlobal: false, permissions: ['settings:write'] }).canInspectReturns,
  true,
);

const boundary = { clientIds: [10, 11], storeIds: [100, 101] };
assert.equal(isAccessAssignmentWithinBoundary({ clientIds: [10], storeIds: [101] }, boundary), true);
assert.equal(isAccessAssignmentWithinBoundary({ clientIds: [12], storeIds: [] }, boundary), false);
assert.equal(isAccessAssignmentWithinBoundary({ clientIds: [], storeIds: [102] }, boundary), false);

assert.equal(
  canManageAccessTarget(
    { isGlobal: false, canManageUsers: true },
    { isGlobal: false, isClientUser: true, clientIds: [10], storeIds: [100] },
    boundary,
  ),
  true,
);
assert.equal(
  canManageAccessTarget(
    { isGlobal: false, canManageUsers: true },
    { isGlobal: true, isClientUser: false, clientIds: [], storeIds: [] },
    boundary,
  ),
  false,
);
assert.equal(
  canManageAccessTarget(
    { isGlobal: true, canManageUsers: true },
    { isGlobal: true, isClientUser: false, clientIds: [], storeIds: [] },
    boundary,
  ),
  true,
);
assert.equal(
  canManageAccessTarget(
    { isGlobal: false, canManageUsers: true },
    { isGlobal: false, isClientUser: true, clientIds: [12], storeIds: [] },
    boundary,
  ),
  false,
);
assert.equal(
  canManageAccessTarget(
    { isGlobal: false, canManageUsers: false },
    { isGlobal: false, isClientUser: true, clientIds: [10], storeIds: [] },
    boundary,
  ),
  false,
);
assert.equal(
  canManageAccessTarget(
    { isGlobal: false, canManageUsers: true },
    { isGlobal: false, isClientUser: false, clientIds: [10], storeIds: [] },
    boundary,
  ),
  false,
);

const read = (path: string) => readFileSync(path, 'utf8');
const accessRoute = readSourceTree([
  'src/routes/client-portal/access.ts',
  'src/routes/client-portal/access',
]);
const scope = read('src/lib/client-portal/scope.ts');
const audit = read('src/lib/client-portal/audit.ts');
const main = read('src/main.ts');
const cors = read('src/lib/http/cors.ts');
const api = readActiveClientPortalApiSource();
const app = read('portal-client/src/App.tsx');
const sidebar = read('portal-client/src/components/layout/Sidebar.tsx');
const integrationWorkflow = read('.github/workflows/integration-tests.yml');
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

function assertBefore(first: string, second: string): void {
  const firstIndex = accessRoute.indexOf(first);
  const secondIndex = accessRoute.indexOf(second, firstIndex + first.length);
  assert.ok(firstIndex >= 0, `missing ${first}`);
  assert.ok(secondIndex > firstIndex, `${first} must run before ${second}`);
}

assertBefore('portal.access_list.invite.requested', 'inviteUserByEmail');
assertBefore('inviteUserByEmail', 'generateLink');
assertBefore('portal.access_list.update.requested', 'updateUserById(id, updates)');
assertBefore('portal.access_list.delete.requested', 'deleteUser(id)');
assert.match(accessRoute, /canManageAccessTarget/);
assert.match(accessRoute, /isAccessAssignmentWithinBoundary/);
assert.match(accessRoute, /role === 'admin' && !capabilities\.canManageAdmins/);
assert.match(accessRoute, /isExistingInviteAccountError/);
assert.match(accessRoute, /Invitation email could not be sent, and a manual activation link could not be generated/);
assert.match(accessRoute, /meta\.portalInvitePending = false/);
assert.doesNotMatch(accessRoute, /delete meta\.portalInvitePending/);
assert.match(audit, /recordCriticalPortalAudit/);
assert.match(audit, /critical persist failed/);

for (const [name, source] of Object.entries({ scope, main, cors, api })) {
  assert.doesNotMatch(source, /X-Portal-Audit-Source|x-portal-audit-source|auditSource/, `${name} trusts public audit source`);
}

for (const capability of ['canManageUsers', 'canManageAdmins', 'canViewAudit']) {
  assert.match(api, new RegExp(capability));
}
assert.match(app, /RequireCapability/);
assert.match(app, /capability="canManageUsers"/);
assert.match(app, /capability="canViewAudit"/);
assert.match(sidebar, /me\.data\?\.canManageUsers/);
assert.match(sidebar, /me\.data\?\.canViewAudit/);
assert.equal(
  pkg.scripts?.['test:client-portal-access-security'],
  'tsx scripts/client-portal-access-security-guard.ts',
);
assert.equal(
  pkg.scripts?.['test:client-portal-access-security:integration'],
  'tsx scripts/integration/client-portal-access-security.integration.ts',
);
assert.match(integrationWorkflow, /npm run test:client-portal-access-security:integration/);

console.log('client portal access security guard passed');
