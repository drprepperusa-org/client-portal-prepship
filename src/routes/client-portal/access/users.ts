import type { Hono } from 'hono';
import { isAdminEmail } from '../../../lib/admin-emails';
import { canManageAccessTarget, isAccessAssignmentWithinBoundary } from '../../../lib/client-portal/access-policy';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { clientPortalCapabilities } from '../../../lib/client-portal/capabilities';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import {
  accessAppMeta,
  countActiveAdmins,
  DEACTIVATE_BAN_DURATION,
  normalizeMetadataIds,
  stringArray,
  userIsAdminLike,
} from '../../../lib/client-portal/read-models/access';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { supabaseAdmin } from '../../../lib/supabase';
import {
  accessBoundaryFor,
  accessTarget,
  activeClientIdsFor,
  patchAccessUserBody,
  requireAccessMutationAudit,
  requireUserManagement,
} from './shared';

export function registerAccessUserMutationRoutes(app: Hono): void {
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

    if (deactivating && isSelf) return c.json({ error: "You can't deactivate your own login." }, 400);
    if (deactivating && isAdminEmail(user.email)) {
      return c.json({ error: 'This is a protected operator account and cannot be deactivated.' }, 400);
    }
    if ((deactivating || demotingAdmin) && userIsAdminLike(user)) {
      if ((await countActiveAdmins()) <= 1) {
        return c.json({ error: 'At least one active admin must remain.' }, 400);
      }
    }

    const meta = { ...accessAppMeta(user) };
    if (body.role !== undefined) {
      if (body.role === 'admin') {
        meta.role = 'admin';
      } else {
        meta.role = body.role || 'client_user';
        meta.permissions = stringArray(meta.permissions).filter((permission) => permission !== 'scope:global');
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
}
