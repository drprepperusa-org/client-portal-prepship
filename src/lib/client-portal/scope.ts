import type { Context } from 'hono';
import { getClientStoreScope, type ClientStoreScope } from '../client-store-scope';
import { hasAppPermission } from '../../middleware/auth';

export type ClientPortalScope = ClientStoreScope & {
  userId: string;
  email?: string;
  role?: string;
  permissions: string[];
  canViewFinancials: boolean;
  canViewCredentials: boolean;
};

function valueFromContext<T>(c: Context, key: string): T | undefined {
  return c.get(key as never) as T | undefined;
}

export function resolveClientPortalScope(c: Context): ClientPortalScope {
  const userId = valueFromContext<string>(c, 'userId') ?? '';
  const email = valueFromContext<string>(c, 'email');
  const role = valueFromContext<string>(c, 'role');
  const permissions = valueFromContext<string[]>(c, 'permissions') ?? [];
  const scope = getClientStoreScope({
    email,
    role,
    permissions,
    clientIds: valueFromContext<number[]>(c, 'clientIds'),
    storeIds: valueFromContext<number[]>(c, 'storeIds'),
  });

  return {
    ...scope,
    userId,
    email,
    role,
    permissions,
    canViewFinancials: hasAppPermission({ email, role, permissions }, 'financials:read'),
    canViewCredentials: hasAppPermission({ email, role, permissions }, 'credentials:read'),
  };
}

export function assertClientPortalScope(c: Context): ClientPortalScope | Response {
  const scope = resolveClientPortalScope(c);
  const needsExplicitScope = scope.role === 'client_user' || scope.role === 'read_only_support';
  const hasScope = scope.clientIds.length > 0 || scope.storeIds.length > 0 || scope.isGlobal;

  if (needsExplicitScope && !hasScope) {
    return c.json({ error: 'client portal scope required' }, 403);
  }

  return scope;
}

export function isClientPortalScope(value: ClientPortalScope | Response): value is ClientPortalScope {
  return !(value instanceof Response);
}

