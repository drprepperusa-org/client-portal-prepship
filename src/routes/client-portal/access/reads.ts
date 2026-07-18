import type { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { settings } from '../../../db/schema/settings';
import { canManageAccessTarget } from '../../../lib/client-portal/access-policy';
import { recordPortalAudit } from '../../../lib/client-portal/audit';
import { clientPortalCapabilities } from '../../../lib/client-portal/capabilities';
import { clientFilterPredicate } from '../../../lib/client-portal/predicates';
import { requestedClientId, requestedStoreId, scopeOrResponse } from '../../../lib/client-portal/query-params';
import { listPortalAccessRoster } from '../../../lib/client-portal/read-models/access';
import { isClientPortalScope } from '../../../lib/client-portal/scope';
import { accessBoundaryFor } from './shared';

export function registerAccessReadRoutes(app: Hono): void {
  app.get('/clients', async (c) => {
    const scope = scopeOrResponse(c);
    if (!isClientPortalScope(scope)) return scope;
    const clientId = requestedClientId(c);
    const storeId = requestedStoreId(c);
    const rows = await db
      .select({ id: clients.id, name: clients.name, email: clients.email, active: clients.active, storeIds: clients.storeIds })
      .from(clients)
      .where(and(eq(clients.active, true), clientFilterPredicate(scope, clientId, storeId)))
      .orderBy(clients.name)
      .limit(200);
    await recordPortalAudit('portal.clients.list', scope, { clientId, storeId, rows: rows.length });
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
}

export function registerAccessSettingsRoute(app: Hono): void {
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
}
