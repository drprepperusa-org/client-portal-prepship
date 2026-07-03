// Client-portal sub-router — extracted from the former single-file
// src/routes/client-portal.ts. Mounted at '/' by that file (now a thin
// aggregator), so these relative paths keep their /api/client-portal/* surface.
import { Hono, type Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients } from '../../db/schema/clients';
import { settings } from '../../db/schema/settings';
import { supabaseAdmin } from '../../lib/supabase';
import { isAdminEmail } from '../../lib/admin-emails';
import { recordPortalAudit } from '../../lib/client-portal/audit';
import { isClientPortalScope, type ClientPortalScope } from '../../lib/client-portal/scope';
import { clientFilterPredicate } from '../../lib/client-portal/predicates';
import {
  accessAppMeta,
  countActiveAdmins,
  DEACTIVATE_BAN_DURATION,
  listPortalAccessRoster,
  normalizeMetadataIds,
  stringArray,
  userIsAdminLike,
} from '../../lib/client-portal/read-models/access';
import { requestedClientId, requestedStoreId, scopeOrResponse } from '../../lib/client-portal/query-params';

const app = new Hono();

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
  if (!scope.isGlobal && !scope.permissions.includes('users:manage')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  const roster = await listPortalAccessRoster();
  if ('error' in roster) return c.json({ error: roster.error }, 500);
  await recordPortalAudit('portal.access_list.view', scope, { users: roster.users.length });
  return c.json({ data: roster.users });
});

/* ---- Access roster admin mutations (deactivate/activate, edit, delete) ----
   All gated behind the same global/'users:manage' check as the GET above and
   guarded against lock-out: nobody can deactivate/delete their own login, a
   protected operator (hardcoded admin email), or the last remaining admin. */

function requireUserManageAdmin(c: Context, scope: ClientPortalScope) {
  if (!scope.isGlobal && !scope.permissions.includes('users:manage')) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return null;
}

// PATCH = edit role / assigned client stores / display name, and/or toggle active.
app.patch('/access-list/:id', async (c) => {
  const scope = scopeOrResponse(c);
  if (!isClientPortalScope(scope)) return scope;
  const denied = requireUserManageAdmin(c, scope);
  if (denied) return denied;

  const id = c.req.param('id');
  const body = (await c.req.json().catch(() => ({}))) as {
    role?: string | null;
    clientIds?: unknown;
    displayName?: string | null;
    active?: boolean;
  };

  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);
  const user = target.user;

  const isSelf = user.id === scope.userId;
  const deactivating = body.active === false;
  const demotingAdmin = typeof body.role === 'string' && body.role !== 'admin' && userIsAdminLike(user);

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
  const denied = requireUserManageAdmin(c, scope);
  if (denied) return denied;

  const id = c.req.param('id');
  const { data: target, error: getErr } = await supabaseAdmin.auth.admin.getUserById(id);
  if (getErr || !target?.user) return c.json({ error: 'User not found' }, 404);
  const user = target.user;

  if (user.id === scope.userId) return c.json({ error: "You can't delete your own login." }, 400);
  if (isAdminEmail(user.email)) {
    return c.json({ error: 'This is a protected operator account and cannot be deleted.' }, 400);
  }
  if (userIsAdminLike(user) && (await countActiveAdmins()) <= 1) {
    return c.json({ error: 'At least one active admin must remain.' }, 400);
  }

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
