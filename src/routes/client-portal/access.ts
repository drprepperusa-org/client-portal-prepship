// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono, type Context } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { settings } from '../../db/schema/settings';
import { supabaseAdmin } from '../../lib/supabase';
import { isAdminEmail } from '../../lib/admin-emails';
import { env } from '../../lib/env';
import { isAllowedCorsOrigin } from '../../lib/http/cors';
import { recordCriticalPortalAudit, recordPortalAudit } from '../../lib/client-portal/audit';
import { canManageAccessTarget, isAccessAssignmentWithinBoundary, type PortalAccessBoundary } from '../../lib/client-portal/access-policy';
import { clientPortalCapabilities } from '../../lib/client-portal/capabilities';
import { isClientPortalScope, resolveClientPortalScope, type ClientPortalScope } from '../../lib/client-portal/scope';
import { clientFilterPredicate } from '../../lib/client-portal/predicates';
import {
  accessAppMeta,
  countActiveAdmins,
  DEACTIVATE_BAN_DURATION,
  listPortalAccessRoster,
  normalizeMetadataIds,
  portalAccessAssignment,
  stringArray,
  userIsAdminLike,
} from '../../lib/client-portal/read-models/access';
import { requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

const inviteAccessUserBody = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().max(120).optional().default(''),
  role: z.enum(['admin', 'client_user']),
  clientIds: z.unknown().optional(),
});

const patchAccessUserBody = z.object({
  role: z.enum(['admin', 'client_user']).optional(),
  clientIds: z.unknown().optional(),
  displayName: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().optional(),
});

function firstConfiguredPortalOrigin(): string | null {
  const first = (env.WEB_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .find(Boolean);
  return first ?? null;
}

function requestPortalOrigin(c: Context): string | null {
  const origin = c.req.header('origin')?.trim().replace(/\/+$/, '');
  if (origin && isAllowedCorsOrigin(origin)) return origin;

  const referer = c.req.header('referer');
  if (!referer) return null;
  try {
    const refererOrigin = new URL(referer).origin.replace(/\/+$/, '');
    return isAllowedCorsOrigin(refererOrigin) ? refererOrigin : null;
  } catch {
    return null;
  }
}

function portalActivationRedirect(c: Context): string | null {
  const base =
    requestPortalOrigin(c) ??
    firstConfiguredPortalOrigin() ??
    (env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null);
  return base ? `${base}/activate` : null;
}

function authErrorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function authErrorMessage(error: unknown): string {
  return (error as { message?: unknown } | null)?.message?.toString() ?? '';
}

function isEmailRateLimitError(error: unknown): boolean {
  const message = authErrorMessage(error).toLowerCase();
  return authErrorStatus(error) === 429 || message.includes('email rate limit');
}

async function authUserExistsByEmail(email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.warn('[client-portal/access-list] duplicate email lookup failed:', error.message);
    return false;
  }
  return (data.users ?? []).some((user) => (user.email ?? '').toLowerCase() === normalized);
}

async function activeClientIdsFor(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.active, true), inArray(clients.id, ids)));
  return rows.map((row) => row.id);
}

async function accessBoundaryFor(scope: ClientPortalScope): Promise<PortalAccessBoundary> {
  if (scope.isGlobal) return { clientIds: [], storeIds: [] };
  const rows = scope.clientIds.length
    ? await db.select({ storeIds: clients.storeIds }).from(clients).where(inArray(clients.id, scope.clientIds))
    : [];
  return {
    clientIds: scope.clientIds,
    storeIds: Array.from(
      new Set([
        ...scope.storeIds,
        ...rows.flatMap((row) => (row.storeIds ?? []).map(Number)),
      ]),
    ),
  };
}

function accessTarget(user: { email?: string | null; app_metadata?: unknown }) {
  const assignment = portalAccessAssignment(user);
  const metadata = accessAppMeta(user);
  return {
    ...assignment,
    isGlobal: userIsAdminLike(user),
    isClientUser: metadata.role === 'client_user',
  };
}

async function requireAccessMutationAudit(
  c: Context,
  event: string,
  scope: ClientPortalScope,
  metadata: Record<string, unknown>,
): Promise<Response | null> {
  try {
    await recordCriticalPortalAudit(event, scope, metadata);
    return null;
  } catch {
    return c.json({ error: 'Access change could not be audited. No changes were made.' }, 503);
  }
}

app.get('/clients', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const rows = await db
    .select({ id: clients.id, name: clients.name, email: clients.email, active: clients.active, storeIds: clients.storeIds })
    .from(clients)
    .where(and(eq(clients.active, true), clientFilterPredicate(scope, requestedClientId(c), requestedStoreId(c))))
    .orderBy(clients.name)
    .limit(200);
  await recordPortalAudit('portal.clients.list', scope, { rows: rows.length });
  return c.json({ data: rows });
});

app.get('/access-list', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const capabilities = clientPortalCapabilities(scope);
  if (!capabilities.canManageUsers) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const roster = await listPortalAccessRoster();
  if ('error' in roster) return c.json({ error: roster.error }, 500);
  const boundary = await accessBoundaryFor(scope);
  const visibleUsers = scope.isGlobal
    ? roster.users
    : roster.users.filter((user) =>
        canManageAccessTarget(
          { isGlobal: false, canManageUsers: capabilities.canManageUsers },
          {
            isGlobal: user.isGlobal,
            isClientUser: user.role === 'client_user',
            clientIds: user.clientIds,
            storeIds: user.storeIds,
          },
          boundary,
        ),
      );
  await recordPortalAudit('portal.access_list.view', scope, { users: visibleUsers.length });
  return c.json({ data: visibleUsers });
});

/* ---- Access roster admin mutations (deactivate/activate, edit, delete) ----
   All gated behind the same global/'users:manage' check as the GET above and
   guarded against lock-out: nobody can deactivate/delete their own login, a
   protected operator (hardcoded admin email), or the last remaining admin. */

function requireUserManagement(c: Context, scope: ClientPortalScope) {
  if (!clientPortalCapabilities(scope).canManageUsers) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return null;
}

// POST = invite a new Supabase Auth login and stamp its portal access metadata.
app.post('/access-list/invite', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const denied = requireUserManagement(c, scope);
  if (denied) return denied;

  const parsed = inviteAccessUserBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid invite details' }, 400);

  const email = parsed.data.email.toLowerCase();
  const displayName = parsed.data.displayName;
  const role = parsed.data.role;
  const clientIds = normalizeMetadataIds(parsed.data.clientIds);
  const capabilities = clientPortalCapabilities(scope);

  if (role === 'admin' && !capabilities.canManageAdmins) {
    return c.json({ error: 'Global admin access required' }, 403);
  }
  if (!scope.isGlobal) {
    const boundary = await accessBoundaryFor(scope);
    if (!isAccessAssignmentWithinBoundary({ clientIds, storeIds: [] }, boundary)) {
      return c.json({ error: 'Selected client stores exceed your access scope' }, 403);
    }
  }

  if (role === 'client_user' && clientIds.length > 0) {
    const validClientIds = await activeClientIdsFor(clientIds);
    if (validClientIds.length !== clientIds.length) {
      return c.json({ error: 'One or more selected client stores are not active or do not exist.' }, 400);
    }
  }

  if (await authUserExistsByEmail(email)) {
    return c.json({ error: 'A login already exists for this email. Edit the existing access record instead.' }, 409);
  }

  const redirectTo = portalActivationRedirect(c);
  if (!redirectTo) {
    return c.json({ error: 'Portal activation URL is not configured. Set WEB_ORIGIN before inviting users.' }, 500);
  }

  const userMetadata = displayName ? { name: displayName, display_name: displayName } : {};
  const portalAppMetadata =
    role === 'admin'
      ? { role: 'admin', portalInvitePending: true }
      : { role: 'client_user', clientIds, portalInvitePending: true };

  const auditDenied = await requireAccessMutationAudit(c, 'portal.access_list.invite.requested', scope, {
    email,
    role,
    clientIds: role === 'client_user' ? clientIds : undefined,
  });
  if (auditDenied) return auditDenied;

  const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: userMetadata,
  });
  let invitedUser = inviteData.user;
  let emailSent = true;
  let activationLink: string | null = null;

  if (inviteErr || !invitedUser) {
    console.warn('[client-portal/access-list] invite failed:', inviteErr?.message);
    if (isEmailRateLimitError(inviteErr)) {
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo, data: userMetadata },
      });
      invitedUser = linkData?.user ?? null;
      activationLink = linkData?.properties?.action_link ?? null;
      emailSent = false;
      if (linkErr || !invitedUser || !activationLink) {
        console.warn('[client-portal/access-list] invite link fallback failed:', linkErr?.message);
        return c.json({ error: 'Supabase email rate limit was hit, and a manual activation link could not be generated.' }, 500);
      }
    } else {
      const message = inviteErr?.message?.toLowerCase().includes('already')
      ? 'A login already exists for this email. Edit the existing access record instead.'
      : 'Failed to send invitation email';
      return c.json({ error: message }, inviteErr?.message?.toLowerCase().includes('already') ? 409 : 500);
    }
  }

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(invitedUser.id, {
    app_metadata: { ...accessAppMeta(invitedUser), ...portalAppMetadata },
    user_metadata: userMetadata,
  });
  if (updateErr) {
    console.warn('[client-portal/access-list] invited user metadata update failed:', updateErr.message);
    return c.json({ error: 'Invitation was created, but portal access assignment failed. Delete the login and invite again.' }, 500);
  }

  await recordPortalAudit('portal.access_list.invite', scope, {
    targetId: invitedUser.id,
    email,
    role,
    clientIds: role === 'client_user' ? clientIds : undefined,
    emailSent,
    manualActivationLink: activationLink ? true : undefined,
  });

  return c.json({
    ok: true,
    emailSent,
    activationLink,
    user: {
      id: invitedUser.id,
      email,
      role,
      clientIds: role === 'client_user' ? clientIds : [],
    },
  });
});

// POST = invited user completed password setup; clear the invite-pending guard.
app.post('/access-list/activate', async (c) => {
  const scope = resolveClientPortalScope(c);

  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(scope.userId);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);

  const meta = { ...accessAppMeta(target.user) };
  if (meta.portalInvitePending !== true) return c.json({ ok: true });
  delete meta.portalInvitePending;

  const auditDenied = await requireAccessMutationAudit(c, 'portal.access_list.activate.requested', scope, {
    targetId: scope.userId,
  });
  if (auditDenied) return auditDenied;

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(scope.userId, {
    app_metadata: meta,
  });
  if (updateErr) {
    console.warn('[client-portal/access-list] activate-complete failed:', updateErr.message);
    return c.json({ error: 'Failed to finish account activation' }, 500);
  }

  await recordPortalAudit('portal.access_list.activate', scope, { targetId: scope.userId });
  return c.json({ ok: true });
});

// PATCH = edit role / assigned client stores / display name, and/or toggle active.
app.patch('/access-list/:id', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const denied = requireUserManagement(c, scope);
  if (denied) return denied;

  const id = c.req.param('id');
  const parsed = patchAccessUserBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'Invalid access update' }, 400);
  const body = parsed.data;

  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);
  const user = target.user;
  const capabilities = clientPortalCapabilities(scope);
  const boundary = await accessBoundaryFor(scope);
  const currentAccess = accessTarget(user);

  if (!canManageAccessTarget({ isGlobal: scope.isGlobal, canManageUsers: capabilities.canManageUsers }, currentAccess, boundary)) {
    return c.json({ error: 'Target user exceeds your access scope' }, 403);
  }
  if (body.role === 'admin' && !capabilities.canManageAdmins) {
    return c.json({ error: 'Global admin access required' }, 403);
  }

  const nextClientIds = body.clientIds === undefined ? currentAccess.clientIds : normalizeMetadataIds(body.clientIds);
  if (body.clientIds !== undefined) {
    const validClientIds = await activeClientIdsFor(nextClientIds);
    if (validClientIds.length !== nextClientIds.length) {
      return c.json({ error: 'One or more selected client stores are not active or do not exist.' }, 400);
    }
    if (!scope.isGlobal && !isAccessAssignmentWithinBoundary({ clientIds: nextClientIds, storeIds: currentAccess.storeIds }, boundary)) {
      return c.json({ error: 'Selected client stores exceed your access scope' }, 403);
    }
  }

  const isSelf = user.id === scope.userId;
  const deactivating = body.active === false;
  const demotingAdmin = body.role === 'client_user' && currentAccess.isGlobal;

  // Lock-out guardrails.
  if (deactivating && isSelf) return c.json({ error: "You can't deactivate your own login." }, 400);
  if (deactivating && isAdminEmail(user.email)) {
    return c.json({ error: 'This is a protected operator account and cannot be deactivated.' }, 400);
  }
  if ((deactivating || demotingAdmin) && userIsAdminLike(user)) {
    if ((await countActiveAdmins()) <= 1) {
      return c.json({ error: 'At least one active admin must remain.' }, 400);
    }
  }

  // Merge metadata so we never clobber unrelated keys.
  const meta = { ...accessAppMeta(user) };
  if (body.role !== undefined) {
    if (body.role === 'admin') {
      meta.role = 'admin';
    } else {
      meta.role = body.role || 'client_user';
      // Strip the global grant so a demoted user isn't still effectively admin.
      meta.permissions = stringArray(meta.permissions).filter((p) => p !== 'scope:global');
    }
  }
  if (body.clientIds !== undefined) meta.clientIds = normalizeMetadataIds(body.clientIds);

  const updates: Record<string, unknown> = { app_metadata: meta };
  if (body.displayName !== undefined) {
    const userMeta =
      user.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
        ? (user.user_metadata as Record<string, unknown>)
        : {};
    updates.user_metadata = { ...userMeta, name: body.displayName, display_name: body.displayName };
  }
  if (body.active !== undefined) updates.ban_duration = body.active ? 'none' : DEACTIVATE_BAN_DURATION;

  const auditDenied = await requireAccessMutationAudit(c, 'portal.access_list.update.requested', scope, {
    targetId: id,
    role: body.role,
    active: body.active,
    clientIds: body.clientIds !== undefined ? nextClientIds : undefined,
    renamed: body.displayName !== undefined ? true : undefined,
  });
  if (auditDenied) return auditDenied;

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(id, updates);
  if (updErr) {
    console.warn('[client-portal/access-list] update failed:', updErr.message);
    return c.json({ error: 'Failed to update user' }, 500);
  }
  await recordPortalAudit('portal.access_list.update', scope, {
    targetId: id,
    role: body.role ?? undefined,
    active: body.active ?? undefined,
    clientIds: body.clientIds !== undefined ? normalizeMetadataIds(body.clientIds) : undefined,
    renamed: body.displayName !== undefined ? true : undefined,
  });
  return c.json({ ok: true });
});

// DELETE = permanently remove the Supabase Auth login.
app.delete('/access-list/:id', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const denied = requireUserManagement(c, scope);
  if (denied) return denied;

  const id = c.req.param('id');
  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);
  const user = target.user;
  const capabilities = clientPortalCapabilities(scope);
  const boundary = await accessBoundaryFor(scope);
  const currentAccess = accessTarget(user);

  if (!canManageAccessTarget({ isGlobal: scope.isGlobal, canManageUsers: capabilities.canManageUsers }, currentAccess, boundary)) {
    return c.json({ error: 'Target user exceeds your access scope' }, 403);
  }

  if (user.id === scope.userId) return c.json({ error: "You can't delete your own login." }, 400);
  if (isAdminEmail(user.email)) {
    return c.json({ error: 'This is a protected operator account and cannot be deleted.' }, 400);
  }
  if (userIsAdminLike(user) && (await countActiveAdmins()) <= 1) {
    return c.json({ error: 'At least one active admin must remain.' }, 400);
  }

  const auditDenied = await requireAccessMutationAudit(c, 'portal.access_list.delete.requested', scope, {
    targetId: id,
    email: user.email ?? null,
  });
  if (auditDenied) return auditDenied;

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (delErr) {
    console.warn('[client-portal/access-list] delete failed:', delErr.message);
    return c.json({ error: 'Failed to delete user' }, 500);
  }
  await recordPortalAudit('portal.access_list.delete', scope, { targetId: id, email: user.email ?? null });
  return c.json({ ok: true });
});

app.get('/settings', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  if (!scope.isGlobal && !scope.permissions.includes('settings:write')) {
    await recordPortalAudit('portal.settings.scoped_empty', scope);
    return c.json({ data: [] });
  }
  const rows = await db.select().from(settings).limit(200);
  await recordPortalAudit('portal.settings.list', scope, { rows: rows.length });
  return c.json({ data: rows });
});

export default app;
