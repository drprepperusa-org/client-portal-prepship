import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { isAdminEmail } from '../../admin-emails';
import { supabaseAdmin } from '../../supabase';

/**
 * Access-roster read-model + admin-user helpers (extracted from
 * routes/client-portal.ts). The PATCH/DELETE mutation handlers stay at the
 * route boundary; they import these helpers for their lock-out guardrails.
 */

// ~100 years — Supabase has no "disable" flag, so a long ban is how we stop a
// login from authenticating. Cleared with ban_duration: 'none' to reactivate.
export const DEACTIVATE_BAN_DURATION = '876600h';

export type AdminUserLike = { email?: string | null; app_metadata?: unknown; banned_until?: string | null };

export function normalizeMetadataIds(value: unknown): number[] {
  const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  return Array.from(
    new Set(
      raw
        .map((item) => Number(item))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function accessAppMeta(user: { app_metadata?: unknown }): Record<string, unknown> {
  return user.app_metadata && typeof user.app_metadata === 'object' && !Array.isArray(user.app_metadata)
    ? (user.app_metadata as Record<string, unknown>)
    : {};
}

export function portalAccessAssignment(
  user: { app_metadata?: unknown },
): { clientIds: number[]; storeIds: number[] } {
  const metadata = accessAppMeta(user);
  return {
    clientIds: normalizeMetadataIds(
      metadata.clientIds ?? metadata.client_ids ?? metadata.assignedClientIds ?? metadata.assigned_client_ids,
    ),
    storeIds: normalizeMetadataIds(
      metadata.storeIds ?? metadata.store_ids ?? metadata.assignedStoreIds ?? metadata.assigned_store_ids,
    ),
  };
}

export function userIsBanned(user: { banned_until?: string | null }): boolean {
  const until = user.banned_until ?? null;
  return Boolean(until && new Date(until).getTime() > Date.now());
}

export function userIsAdminLike(user: AdminUserLike): boolean {
  const meta = accessAppMeta(user);
  const role = typeof meta.role === 'string' ? meta.role : null;
  return isAdminEmail(user.email) || role === 'admin' || stringArray(meta.permissions).includes('scope:global');
}

/** Number of admins who can still sign in — used to prevent locking everyone out. */
export async function countActiveAdmins(): Promise<number> {
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  return (data?.users ?? []).filter((u) => userIsAdminLike(u) && !userIsBanned(u)).length;
}

/** The authoritative Supabase Auth roster mapped to real client rows. */
export async function listPortalAccessRoster(): Promise<{ users: PortalAccessRosterUser[] } | { error: string }> {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    console.warn('[client-portal/access-list] listUsers failed:', error.message);
    return { error: 'Failed to load access list' };
  }

  const clientRows = await db
    .select({ id: clients.id, name: clients.name, email: clients.email, active: clients.active, storeIds: clients.storeIds })
    .from(clients)
    .orderBy(clients.name)
    .limit(500);
  const clientsById = new Map(clientRows.map((client) => [client.id, client]));

  const users = (data.users ?? [])
    .map((user) => {
      const metadata =
        user.app_metadata && typeof user.app_metadata === 'object' && !Array.isArray(user.app_metadata)
          ? (user.app_metadata as Record<string, unknown>)
          : {};
      const { clientIds, storeIds } = portalAccessAssignment(user);
      const role = typeof metadata.role === 'string' ? metadata.role : null;
      const permissions = stringArray(metadata.permissions);
      const matchedClients = clientIds
        .map((id) => clientsById.get(id))
        .filter((client): client is (typeof clientRows)[number] => Boolean(client));
      const matchedStoreClients = storeIds.length
        ? clientRows.filter((client) => (client.storeIds ?? []).some((storeId) => storeIds.includes(Number(storeId))))
        : [];
      const mergedClients = [...matchedClients];
      for (const client of matchedStoreClients) {
        if (!mergedClients.some((existing) => existing.id === client.id)) mergedClients.push(client);
      }

      const userMeta =
        user.user_metadata && typeof user.user_metadata === 'object' && !Array.isArray(user.user_metadata)
          ? (user.user_metadata as Record<string, unknown>)
          : {};
      const displayName =
        typeof userMeta.name === 'string'
          ? userMeta.name
          : typeof userMeta.display_name === 'string'
            ? userMeta.display_name
            : null;

      // Global/admin logins (hardcoded operator email, role 'admin', or the
      // scope:global permission) can see EVERY client store — not just whatever
      // happens to be pinned in their metadata. So for them, "stores handled" is
      // the full client roster; scoped client_users keep their assigned subset.
      const globalAccess = isAdminEmail(user.email) || role === 'admin' || permissions.includes('scope:global');
      const effectiveClients = globalAccess ? clientRows : mergedClients;

      return {
        id: user.id,
        email: user.email ?? '',
        name: displayName,
        role,
        permissions,
        isAdmin: globalAccess,
        isGlobal: globalAccess,
        // Protected operator accounts (hardcoded admin emails) can't be
        // deactivated/deleted; surface that so the UI can disable those actions.
        isProtected: isAdminEmail(user.email),
        active: !userIsBanned(user),
        clientIds: globalAccess ? clientRows.map((client) => client.id) : clientIds,
        storeIds,
        clients: effectiveClients.map((client) => ({
          id: client.id,
          name: client.name,
          email: client.email,
          active: client.active,
          storeIds: client.storeIds,
        })),
        createdAt: user.created_at ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
      };
    })
    .filter((user) => user.email)
    .sort((a, b) => {
      if (a.isAdmin && !b.isAdmin) return -1;
      if (!a.isAdmin && b.isAdmin) return 1;
      return a.email.localeCompare(b.email);
    });

  return { users };
}

export type PortalAccessRosterUser = {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGlobal: boolean;
  isProtected: boolean;
  active: boolean;
  clientIds: number[];
  storeIds: number[];
  clients: Array<{
    id: number;
    name: string | null;
    email: string | null;
    active: boolean | null;
    storeIds: number[] | null;
  }>;
  createdAt: string | null;
  lastSignInAt: string | null;
};
