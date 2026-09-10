/**
 * CP-070 — PrepShip's customer-safe billing finalization verdict, carried verbatim.
 *
 * PrepShip owns coverage (billing-finalization-policy.ts) and resolves the client scope from the
 * forwarded bearer. This file only moves the answer: it sends the applied inclusive days and an
 * optional narrowing clientId — never an exclusive bound or an inferred client list — and checks
 * the response strictly. It computes nothing. Unlike the invoice-totals proxy there is no "no ids,
 * empty success" shortcut: an empty scope is PrepShip's call, and its answer is `unavailable`.
 *
 * Every uncertainty fails closed. Missing configuration, a network error, a timeout, a non-2xx or a
 * malformed body reaches the caller as "unable to confirm" — never as a verdict, never as `closed`.
 * Authorization failures keep their status but lose their detail, so the portal cannot be used to
 * probe which client ids exist.
 */
import type { BillingFinalizationCoverage } from './contracts/billing';
import { env } from '../env';

const TIMEOUT_MS = 10_000;
const BILLING_DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: ReadonlySet<string> = new Set(['open', 'mixed', 'closed', 'unavailable']);
const DTO_KEYS = 'dateFrom,dateTo,status,today';

export type BillingFinalizationCoverageResult =
  | { ok: true; coverage: BillingFinalizationCoverage }
  | { ok: false; status: 401 | 403 | 404 | 502 | 503; code: string; error: string };

const UNCONFIRMED = 'Unable to confirm billing finalization.';

/** Accept exactly the frozen v1 DTO for the requested days; anything else is not a verdict. */
export function parseBillingFinalizationCoverage(
  body: unknown,
  requested: { dateFrom: string; dateTo: string },
): BillingFinalizationCoverage | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  // Extra fields are refused, not stripped: a producer that starts sending more than the frozen
  // contract is a contract change, and nothing it adds should reach a customer by accident.
  if (Object.keys(record).sort().join(',') !== DTO_KEYS) return null;
  const { status, dateFrom, dateTo, today } = record;
  if (typeof status !== 'string' || !STATUSES.has(status)) return null;
  if (typeof dateFrom !== 'string' || typeof dateTo !== 'string' || typeof today !== 'string') return null;
  if (!BILLING_DAY.test(dateFrom) || !BILLING_DAY.test(dateTo) || !BILLING_DAY.test(today)) return null;
  // A verdict for other days than the ones asked about must never be shown against these totals.
  if (dateFrom !== requested.dateFrom || dateTo !== requested.dateTo) return null;
  return { status: status as BillingFinalizationCoverage['status'], dateFrom, dateTo, today };
}

export async function fetchBillingFinalizationCoverage(
  authorization: string,
  query: { dateFrom: string; dateTo: string; clientId?: number | null },
  requestId?: string,
  signal?: AbortSignal,
): Promise<BillingFinalizationCoverageResult> {
  if (!env.PREPSHIP_API_URL) {
    return { ok: false, status: 503, code: 'prep_ship_billing_unavailable', error: UNCONFIRMED };
  }
  const params = new URLSearchParams({ dateFrom: query.dateFrom, dateTo: query.dateTo });
  if (query.clientId != null) params.set('clientId', String(query.clientId));

  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    upstream = await fetch(`${baseUrl}/billing/finalization-coverage?${params.toString()}`, {
      method: 'GET',
      headers: {
        authorization,
        accept: 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    console.error(
      '[client-portal] billing finalization coverage unavailable:',
      error instanceof Error ? error.name : 'unknown error',
    );
    return { ok: false, status: 502, code: 'prep_ship_billing_unavailable', error: UNCONFIRMED };
  }

  if (upstream.status === 401) {
    return { ok: false, status: 401, code: 'unauthorized', error: 'Unauthorized' };
  }
  if (upstream.status === 403 || upstream.status === 404) {
    return { ok: false, status: upstream.status, code: 'forbidden', error: 'Not found' };
  }
  if (!upstream.ok) {
    return { ok: false, status: 502, code: 'prep_ship_billing_unavailable', error: UNCONFIRMED };
  }
  const coverage = parseBillingFinalizationCoverage(await upstream.json().catch(() => null), query);
  return coverage
    ? { ok: true, coverage }
    : { ok: false, status: 502, code: 'prep_ship_billing_contract_mismatch', error: UNCONFIRMED };
}
