// Shared query-string / scope helpers for the client-portal route modules.
// Extracted verbatim from the former single-file client-portal.ts so every
// per-domain sub-router (src/routes/client-portal/*) parses pagination, dates,
// ids, and scope the exact same way. Bodies are unchanged — the max=200
// pageSize clamp, the >0 integer checks, and scopeOrResponse's return contract
// (ClientPortalScope | Response) are load-bearing; do not "simplify" them.
import { type Context } from 'hono';
import { assertClientPortalScope, isClientPortalScope } from './scope';

export function parsePage(value: string | undefined, fallback = 1) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePageSize(value: string | undefined, fallback = 25, max = 200) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function asTimestamp(value: Date) {
  return value.toISOString();
}

export function parsePositiveInt(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function requestedClientId(c: Context) {
  return parsePositiveInt(c.req.query('clientId'));
}

export function requestedStoreId(c: Context) {
  return parsePositiveInt(c.req.query('storeId'));
}

export function requestedSearch(c: Context) {
  const value = c.req.query('search')?.trim();
  return value ? value.slice(0, 120) : '';
}

export function scopeOrResponse(c: Context) {
  const scope = assertClientPortalScope(c);
  return isClientPortalScope(scope) ? scope : scope;
}
