/**
 * Decodes the Supabase JWT to learn the caller's client/store scope, mirroring
 * the backend's scope logic (src/lib/client-portal/scope.ts). The backend
 * filters by a SINGLE clientId/storeId query param, so for a restricted user
 * with multiple clientIds the frontend must fan out one request per client and
 * merge — see api.ts. Ported from web/src/lib/portalScope.ts.
 */

export interface PortalClientScope {
  clientIds: number[];
  storeIds: number[];
  isRestricted: boolean;
  isGlobal: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function numberList(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(values.map((i) => Number(i)).filter((i) => Number.isInteger(i) && i > 0)),
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((i): i is string => typeof i === 'string') : [];
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return typeof globalThis.atob === 'function' ? globalThis.atob(padded) : '';
}

function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null;
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function portalScopeFromToken(token: string | null): PortalClientScope {
  const payload = decodeJwtPayload(token);
  const meta = isRecord(payload?.app_metadata) ? (payload!.app_metadata as Record<string, unknown>) : {};
  const role = String(meta.role ?? payload?.role ?? '');
  const permissions = stringList(meta.permissions ?? payload?.permissions);
  const clientIds = numberList(meta.clientIds ?? meta.client_ids ?? payload?.clientIds ?? payload?.client_ids);
  const storeIds = numberList(meta.storeIds ?? meta.store_ids ?? payload?.storeIds ?? payload?.store_ids);
  const isGlobal = role === 'admin' || permissions.includes('scope:global');
  const requiresExplicitScope = role === 'client_user' || role === 'read_only_support';
  const hasExplicitScope = clientIds.length > 0 || storeIds.length > 0;
  return {
    clientIds,
    storeIds,
    isGlobal,
    isRestricted: !isGlobal && (requiresExplicitScope || hasExplicitScope),
  };
}
