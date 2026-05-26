import type { Paginated } from '../types/portal';

type JwtPayload = Record<string, unknown> & {
  app_metadata?: Record<string, unknown>;
  role?: string;
  permissions?: unknown;
};

export type PortalClientScope = {
  clientIds: number[];
  storeIds: number[];
  isRestricted: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberList(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  if (typeof globalThis.atob === 'function') return globalThis.atob(padded);
  return '';
}

function decodeJwtPayload(token: string | null): JwtPayload | null {
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
  const appMetadata = isRecord(payload?.app_metadata) ? payload.app_metadata : {};
  const role = String(appMetadata.role ?? payload?.role ?? '');
  const permissions = stringList(appMetadata.permissions ?? payload?.permissions);
  const clientIds = numberList(appMetadata.clientIds ?? appMetadata.client_ids ?? payload?.clientIds ?? payload?.client_ids);
  const storeIds = numberList(appMetadata.storeIds ?? appMetadata.store_ids ?? payload?.storeIds ?? payload?.store_ids);
  const isGlobal = role === 'admin' || permissions.includes('scope:global');
  const requiresExplicitScope = role === 'client_user' || role === 'read_only_support';
  const hasExplicitScope = clientIds.length > 0 || storeIds.length > 0;

  return {
    clientIds,
    storeIds,
    isRestricted: !isGlobal && (requiresExplicitScope || hasExplicitScope),
  };
}

function idFrom(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = row[key];
    const value = Number(raw);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function idListFrom(row: Record<string, unknown>, keys: string[]): number[] {
  for (const key of keys) {
    const ids = numberList(row[key]);
    if (ids.length > 0) return ids;
  }
  return [];
}

export function portalRowIsVisible(row: unknown, scope: PortalClientScope): boolean {
  if (!scope.isRestricted) return true;
  if (!isRecord(row)) return false;

  const clientId = idFrom(row, ['clientId', 'client_id', 'sourceClientId', 'source_client_id']);
  if (clientId != null && scope.clientIds.includes(clientId)) return true;

  const storeId = idFrom(row, ['storeId', 'store_id', 'sourceStoreId', 'source_store_id']);
  if (storeId != null && scope.storeIds.includes(storeId)) return true;

  const assignedClientIds = idListFrom(row, ['assignedClientIds', 'assigned_client_ids', 'clientIds', 'client_ids']);
  if (assignedClientIds.some((id) => scope.clientIds.includes(id))) return true;

  const storeIds = idListFrom(row, ['storeIds', 'store_ids']);
  if (storeIds.some((id) => scope.storeIds.includes(id))) return true;

  return false;
}

export function filterPortalRows<T>(rows: T[], token: string | null): T[] {
  const scope = portalScopeFromToken(token);
  return scope.isRestricted ? rows.filter((row) => portalRowIsVisible(row, scope)) : rows;
}

export function filterPortalPaginated<T>(response: Paginated<T>, token: string | null): Paginated<T> {
  const data = filterPortalRows(response.data ?? [], token);
  return {
    ...response,
    data,
    pagination: response.pagination
      ? {
          ...response.pagination,
          total: data.length,
          totalPages: data.length > 0 ? Math.ceil(data.length / response.pagination.pageSize) : 0,
        }
      : undefined,
  };
}

export function filterPortalDataResponse<T extends { data: unknown[] }>(response: T, token: string | null): T {
  return {
    ...response,
    data: filterPortalRows(response.data, token),
  };
}

export function restrictedEmptyDashboard<T extends Record<string, unknown>>(summary: T, token: string | null): T {
  const scope = portalScopeFromToken(token);
  if (!scope.isRestricted) return summary;
  return {
    ...summary,
    revenue: 0,
    units: 0,
    bySku: [],
    dailyRevenue: [],
  };
}
