/* CP-048 behavioral integration suite.
 *
 * Runs the real Client Portal access routes against a throwaway Postgres and
 * replaces Supabase Admin calls with in-memory spies. No real user, email, or
 * production database mutation is possible; setupTestEnv() refuses production.
 */
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { setupTestEnv } from './guard';

setupTestEnv();

// Supabase initializes its optional realtime client at import time. Node 20
// has no native WebSocket, while these tests only exercise auth-admin methods.
if (!('WebSocket' in globalThis)) {
  Object.defineProperty(globalThis, 'WebSocket', {
    value: class TestWebSocket {},
    configurable: true,
  });
}

const { db, sql: pgClient } = await import('../../src/db/client');
const schema = await import('../../src/db/schema/index');
const accessRoute = await import('../../src/routes/client-portal/access');
const dashboardRoute = await import('../../src/routes/client-portal/dashboard');
const { supabaseAdmin } = await import('../../src/lib/supabase');

let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) console.log(`  ✓ ${message}`);
  else {
    console.error(`  ✗ ${message}`);
    failures += 1;
  }
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message} (got ${String(actual)}, want ${String(expected)})`);
}

type TestActor = {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  clientIds: number[];
  storeIds: number[];
};

function appFor(actor: TestActor, route: Hono): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId' as never, actor.userId as never);
    c.set('email' as never, actor.email as never);
    c.set('role' as never, actor.role as never);
    c.set('permissions' as never, actor.permissions as never);
    c.set('clientIds' as never, actor.clientIds as never);
    c.set('storeIds' as never, actor.storeIds as never);
    await next();
  });
  app.route('/', route);
  return app;
}

function jsonRequest(method: 'POST' | 'PATCH', body: Record<string, unknown>): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

type FakeAuthUser = {
  id: string;
  email: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  banned_until: null;
  created_at: string;
  last_sign_in_at: null;
};

function fakeAuthUser(
  id: string,
  email: string,
  appMetadata: Record<string, unknown>,
): FakeAuthUser {
  return {
    id,
    email,
    app_metadata: appMetadata,
    user_metadata: {},
    banned_until: null,
    created_at: '2026-07-14T00:00:00.000Z',
    last_sign_in_at: null,
  };
}

type MockableAuthAdmin = {
  listUsers: (...args: unknown[]) => Promise<unknown>;
  getUserById: (...args: unknown[]) => Promise<unknown>;
  inviteUserByEmail: (...args: unknown[]) => Promise<unknown>;
  updateUserById: (...args: unknown[]) => Promise<unknown>;
};

async function reset(): Promise<void> {
  await db.execute(sql`truncate table client_portal_audit_logs, clients restart identity cascade`);
}

async function installAuditFailureTrigger(): Promise<void> {
  await db.execute(sql`
    create or replace function cp048_reject_requested_audit()
    returns trigger
    language plpgsql
    as $cp048$
    begin
      if new.event = 'portal.access_list.invite.requested' then
        raise exception 'simulated CP-048 audit persistence failure';
      end if;
      return new;
    end;
    $cp048$
  `);
  await db.execute(sql`drop trigger if exists cp048_reject_requested_audit on client_portal_audit_logs`);
  await db.execute(sql`
    create trigger cp048_reject_requested_audit
    before insert on client_portal_audit_logs
    for each row execute function cp048_reject_requested_audit()
  `);
}

async function removeAuditFailureTrigger(): Promise<void> {
  await db.execute(sql`drop trigger if exists cp048_reject_requested_audit on client_portal_audit_logs`);
  await db.execute(sql`drop function if exists cp048_reject_requested_audit()`);
}

async function main(): Promise<void> {
  await reset();
  const [ownClient, otherClient] = await db
    .insert(schema.clients)
    .values([{ name: 'CP-048 Own Client' }, { name: 'CP-048 Other Client' }])
    .returning();

  const scopedActor: TestActor = {
    userId: 'cp048-scoped-manager',
    email: 'scoped-manager@example.test',
    role: 'client_user',
    permissions: ['users:manage'],
    clientIds: [ownClient!.id],
    storeIds: [],
  };
  const globalActor: TestActor = {
    userId: 'cp048-global-admin',
    email: 'global-admin@example.test',
    role: 'admin',
    permissions: ['scope:global'],
    clientIds: [],
    storeIds: [],
  };

  const scopedAccess = appFor(scopedActor, accessRoute.default);
  const globalAccess = appFor(globalActor, accessRoute.default);
  const scopedDashboard = appFor(scopedActor, dashboardRoute.default);
  const globalDashboard = appFor(globalActor, dashboardRoute.default);

  console.log('\nCP-048 Group 1 - backend-owned capabilities');
  const scopedMe = await scopedDashboard.request('/me');
  const scopedCapabilities = await scopedMe.json() as Record<string, unknown>;
  equal(scopedMe.status, 200, 'scoped manager can read /me');
  equal(scopedCapabilities.canManageUsers, true, 'scoped users:manage grants canManageUsers');
  equal(scopedCapabilities.canManageAdmins, false, 'scoped manager cannot manage global admins');
  equal(scopedCapabilities.canViewAudit, false, 'scoped manager cannot view global audit');

  const globalMe = await globalDashboard.request('/me');
  const globalCapabilities = await globalMe.json() as Record<string, unknown>;
  equal(globalMe.status, 200, 'global admin can read /me');
  equal(globalCapabilities.canManageUsers, true, 'global admin can manage users');
  equal(globalCapabilities.canManageAdmins, true, 'global admin can manage admins');
  equal(globalCapabilities.canViewAudit, true, 'global admin can view audit');

  console.log('\nCP-048 Group 2 - scoped manager mutation boundary');
  const inviteAdmin = await scopedAccess.request(
    '/access-list/invite',
    jsonRequest('POST', {
      email: 'blocked-admin@example.test',
      role: 'admin',
      clientIds: [],
    }),
  );
  equal(inviteAdmin.status, 403, 'scoped manager cannot invite a global admin');

  const crossClientInvite = await scopedAccess.request(
    '/access-list/invite',
    jsonRequest('POST', {
      email: 'cross-client@example.test',
      role: 'client_user',
      clientIds: [otherClient!.id],
    }),
  );
  equal(crossClientInvite.status, 403, 'scoped manager cannot assign another client');

  const authAdmin = supabaseAdmin.auth.admin as unknown as MockableAuthAdmin;
  const originalMethods = {
    listUsers: authAdmin.listUsers,
    getUserById: authAdmin.getUserById,
    inviteUserByEmail: authAdmin.inviteUserByEmail,
    updateUserById: authAdmin.updateUserById,
  };
  let targetUser = fakeAuthUser(
    'cp048-target-client-user',
    'target@example.test',
    { role: 'client_user', clientIds: [ownClient!.id] },
  );
  let inviteCalls = 0;
  let updateCalls = 0;

  authAdmin.listUsers = async () => ({ data: { users: [] }, error: null });
  authAdmin.getUserById = async () => ({ data: { user: targetUser }, error: null });
  authAdmin.inviteUserByEmail = async (email) => {
    inviteCalls += 1;
    return {
      data: { user: fakeAuthUser('cp048-invited-admin', String(email), {}) },
      error: null,
    };
  };
  authAdmin.updateUserById = async () => {
    updateCalls += 1;
    return { data: { user: targetUser }, error: null };
  };

  try {
    const promoteAdmin = await scopedAccess.request(
      '/access-list/cp048-target-client-user',
      jsonRequest('PATCH', { role: 'admin' }),
    );
    equal(promoteAdmin.status, 403, 'scoped manager cannot promote a client user to admin');
    equal(updateCalls, 0, 'blocked promotion performs no Supabase mutation');

    targetUser = fakeAuthUser(
      'cp048-global-target',
      'global-target@example.test',
      { role: 'admin', permissions: ['scope:global'] },
    );
    const editGlobal = await scopedAccess.request(
      '/access-list/cp048-global-target',
      jsonRequest('PATCH', { displayName: 'Blocked rename' }),
    );
    equal(editGlobal.status, 403, 'scoped manager cannot mutate a global target');
    equal(updateCalls, 0, 'blocked global-target edit performs no Supabase mutation');

    targetUser = fakeAuthUser(
      'cp048-target-client-user',
      'target@example.test',
      { role: 'client_user', clientIds: [ownClient!.id] },
    );
    const inScopeEdit = await scopedAccess.request(
      '/access-list/cp048-target-client-user',
      jsonRequest('PATCH', { displayName: 'Allowed rename' }),
    );
    equal(inScopeEdit.status, 200, 'scoped manager may edit an in-scope client_user');
    equal(updateCalls, 1, 'allowed in-scope edit reaches the mocked Supabase mutation once');

    console.log('\nCP-048 Group 3 - public audit-source spoofing');
    const spoofedAuditRequest = await scopedAccess.request('/clients', {
      headers: { 'X-Portal-Audit-Source': 'background' },
    });
    equal(spoofedAuditRequest.status, 200, 'spoofed audit-source header does not affect the request');
    const [spoofedAudit] = await db
      .select()
      .from(schema.clientPortalAuditLogs)
      .where(eq(schema.clientPortalAuditLogs.event, 'portal.clients.list'))
      .orderBy(schema.clientPortalAuditLogs.id);
    equal(spoofedAudit?.actorUserId, scopedActor.userId, 'spoofed header still persists actor user id');
    equal(spoofedAudit?.actorEmail, scopedActor.email, 'spoofed header still persists actor email');
    check(
      !JSON.stringify(spoofedAudit?.metadata ?? {}).includes('background'),
      'public background value is not trusted or persisted as audit source',
    );

    console.log('\nCP-048 Group 4 - global-admin happy path and fail-closed audit');
    const globalInvite = await globalAccess.request(
      '/access-list/invite',
      jsonRequest('POST', {
        email: 'new-global-admin@example.test',
        role: 'admin',
        clientIds: [],
      }),
    );
    equal(globalInvite.status, 200, 'global admin may invite another global admin');
    equal(inviteCalls, 1, 'global admin happy path invokes mocked invite once');
    equal(updateCalls, 2, 'global admin happy path stamps mocked metadata once');

    const globalAuditRows = await db
      .select()
      .from(schema.clientPortalAuditLogs)
      .where(eq(schema.clientPortalAuditLogs.actorUserId, globalActor.userId));
    check(
      globalAuditRows.some((row) => row.event === 'portal.access_list.invite.requested'),
      'global invite persists actor-attributed pre-mutation audit evidence',
    );
    check(
      globalAuditRows.some((row) => row.event === 'portal.access_list.invite'),
      'global invite persists completion audit evidence',
    );

    await installAuditFailureTrigger();
    const inviteCallsBeforeFailure = inviteCalls;
    const failedAuditInvite = await globalAccess.request(
      '/access-list/invite',
      jsonRequest('POST', {
        email: 'must-not-be-invited@example.test',
        role: 'admin',
        clientIds: [],
      }),
    );
    equal(failedAuditInvite.status, 503, 'critical audit outage fails the access mutation closed');
    equal(inviteCalls, inviteCallsBeforeFailure, 'audit failure prevents the mocked invite side effect');
  } finally {
    await removeAuditFailureTrigger();
    authAdmin.listUsers = originalMethods.listUsers;
    authAdmin.getUserById = originalMethods.getUserById;
    authAdmin.inviteUserByEmail = originalMethods.inviteUserByEmail;
    authAdmin.updateUserById = originalMethods.updateUserById;
  }
}

let exitCode = 1;
try {
  await main();
  exitCode = failures === 0 ? 0 : 1;
  console.log(
    failures === 0
      ? '\n✓ CP-048 access security integration suite passed.\n'
      : `\n✗ ${failures} CP-048 assertion(s) failed.\n`,
  );
} catch (error) {
  console.error(
    '\n✗ CP-048 integration suite errored:',
    error instanceof Error ? error.stack : error,
  );
} finally {
  try {
    await removeAuditFailureTrigger();
    await reset();
  } catch {
    /* best-effort cleanup in the throwaway database */
  }
  await pgClient.end({ timeout: 5 });
}

process.exit(exitCode);
