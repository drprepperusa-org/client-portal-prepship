import type { Hono } from 'hono';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { isAccessAssignmentWithinBoundary } from '../../../lib/client-portal/access-policy';
import { clientPortalCapabilities } from '../../../lib/client-portal/capabilities';
import {
  inviteErrorDiagnostic,
  isExistingInviteAccountError,
} from '../../../lib/client-portal/invite-errors';
import { accessAppMeta, normalizeMetadataIds } from '../../../lib/client-portal/read-models/access';
import { isClientPortalScope, resolveClientPortalScope } from '../../../lib/client-portal/scope';
import { scopeOrResponse } from '../../../lib/client-portal/query-params';
import { supabaseAdmin } from '../../../lib/supabase';
import {
  accessBoundaryFor,
  activeClientIdsFor,
  authUserExistsByEmail,
  inviteAccessUserBody,
  portalActivationRedirect,
  requireAccessMutationAudit,
  requireUserManagement,
} from './shared';

export function registerAccessInvitationRoutes(app: Hono): void {
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
      console.warn(
        '[client-portal/access-list] invite email failed:',
        JSON.stringify(inviteErrorDiagnostic(inviteErr)),
      );
      if (isExistingInviteAccountError(inviteErr)) {
        return c.json(
          { error: 'A login already exists for this email. Edit the existing access record instead.' },
          409,
        );
      }

      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'invite',
        email,
        options: { redirectTo, data: userMetadata },
      });
      invitedUser = linkData?.user ?? null;
      activationLink = linkData?.properties?.action_link ?? null;
      emailSent = false;
      if (linkErr || !invitedUser || !activationLink) {
        console.warn(
          '[client-portal/access-list] invite link fallback failed:',
          JSON.stringify(inviteErrorDiagnostic(linkErr)),
        );
        return c.json(
          { error: 'Invitation email could not be sent, and a manual activation link could not be generated.' },
          500,
        );
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
}
