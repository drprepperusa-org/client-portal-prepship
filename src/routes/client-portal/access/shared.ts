import type { Context } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/client';
import { clients } from '../../../db/schema/clients';
import { recordCriticalPortalAudit } from '../../../lib/client-portal/audit';
import type { PortalAccessBoundary } from '../../../lib/client-portal/access-policy';
import { clientPortalCapabilities } from '../../../lib/client-portal/capabilities';
import {
  accessAppMeta,
  portalAccessAssignment,
  userIsAdminLike,
} from '../../../lib/client-portal/read-models/access';
import type { ClientPortalScope } from '../../../lib/client-portal/scope';
import { env } from '../../../lib/env';
import { isAllowedCorsOrigin } from '../../../lib/http/cors';
import { supabaseAdmin } from '../../../lib/supabase';

export const inviteAccessUserBody = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().max(120).optional().default(''),
  role: z.enum(['admin', 'client_user']),
  clientIds: z.unknown().optional(),
});

export const patchAccessUserBody = z.object({
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

export function portalActivationRedirect(c: Context): string | null {
  const base =
    requestPortalOrigin(c) ??
    firstConfiguredPortalOrigin() ??
    (env.NODE_ENV !== 'production' ? 'http://localhost:5173' : null);
  return base ? `${base}/activate` : null;
}

export async function authUserExistsByEmail(email: string): Promise<boolean> {
  const normalized = email.toLowerCase();
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.warn('[client-portal/access-list] duplicate email lookup failed:', error.message);
    return false;
  }
  return (data.users ?? []).some((user) => (user.email ?? '').toLowerCase() === normalized);
}

export async function activeClientIdsFor(ids: number[]): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.active, true), inArray(clients.id, ids)));
  return rows.map((row) => row.id);
}

export async function accessBoundaryFor(scope: ClientPortalScope): Promise<PortalAccessBoundary> {
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

export function accessTarget(user: { email?: string | null; app_metadata?: unknown }) {
  const assignment = portalAccessAssignment(user);
  const metadata = accessAppMeta(user);
  return {
    ...assignment,
    isGlobal: userIsAdminLike(user),
    isClientUser: metadata.role === 'client_user',
  };
}

export function requireUserManagement(c: Context, scope: ClientPortalScope) {
  if (!clientPortalCapabilities(scope).canManageUsers) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  return null;
}

export async function requireAccessMutationAudit(
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
