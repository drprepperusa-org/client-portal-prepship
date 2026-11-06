import { env } from '../env';

/** Transport only. PrepShip rechecks current grants, client scope and all prices. */
export async function proxyRateSheetCommand(operation: 'access' | 'services' | 'package' | 'add-box', authorization: string, body?: unknown, requestId?: string) {
  if (!env.PREPSHIP_API_URL) throw new Error('Rate sheet service unavailable');
  const response = await fetch(`${env.PREPSHIP_API_URL.replace(/\/+$/, '')}/billing/rate-sheet/${operation}`, {
    method: operation === 'access' ? 'GET' : 'POST',
    headers: { authorization, accept: 'application/json', 'content-type': 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) },
    ...(operation === 'access' ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object') throw new Error('Invalid rate sheet response');
  if (!response.ok) {
    const status = [400, 401, 403, 404, 409].includes(response.status) ? response.status : 503;
    return { status, data: { error: 'error' in result && typeof result.error === 'string' ? result.error : 'Rate sheet service unavailable' } };
  }
  // Explicit DTO allowlist: never forward internal pricing or configuration fields.
  if (operation === 'access' && 'canEditRateSheet' in result && typeof result.canEditRateSheet === 'boolean') {
    return { status: 200, data: { canEditRateSheet: result.canEditRateSheet } };
  }
  if (operation !== 'access' && 'ok' in result && result.ok === true) return { status: 200, data: { ok: true } };
  throw new Error('Invalid rate sheet response');
}
