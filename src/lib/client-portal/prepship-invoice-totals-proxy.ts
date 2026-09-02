/**
 * CP-067 — canonical invoice totals for the Billing LIST, from PrepShip's owner.
 *
 * WHY THIS EXISTS
 * ---------------
 * CP-066 moved the customer INVOICE onto PrepShip's billingInvoiceHeaderTotals. The Billing
 * LIST was left totalling its rows with this repo's own aggregation, which implements neither
 * of PrepShip's money rules:
 *   - PS-491 duplicate-order-copy suppression
 *   - cancelled-no-charge zeroing
 *
 * Measured on HUGRAB's August 2026 period, that difference was $30.50 and one order — the list
 * would have shown a customer money the invoice they opened from it does not charge. A list and
 * an invoice that disagree about the same period is worse than either being wrong alone,
 * because it makes both untrustworthy.
 *
 * This fetches the SAME totals the invoice reads, per client, for one period.
 */
import { env } from '../env';
import {
  parseCanonicalBillingTotals,
  type CanonicalBillingTotals,
} from './prepship-billing-details-proxy';

export type CanonicalInvoiceTotalsResult =
  | { ok: true; byClient: Map<number, CanonicalBillingTotals> }
  | { ok: false; status: number; error: string; code: string };

/**
 * Totals for several clients over ONE period.
 *
 * Days, not instants. PrepShip re-runs its own billingDayRange() on whatever it receives and
 * reads the date part as the LAST INCLUDED day, so handing it an exclusive bound silently
 * widens the window by a day — the bug that put 9/1 rows inside an August invoice. Callers
 * pass `periodStart`/`periodEnd` (or fromDay/toDay), which are already plain YYYY-MM-DD.
 *
 * Fails CLOSED on every uncertainty, like the details proxy. A Billing list that renders its
 * own aggregation because upstream was unavailable is the exact divergence this replaces, and
 * it would be invisible — the numbers would just quietly be the old, wrong ones.
 */
export async function fetchCanonicalInvoiceTotals(
  authorization: string,
  query: { clientIds: number[]; dateFrom: string; dateTo: string },
  requestId?: string,
): Promise<CanonicalInvoiceTotalsResult> {
  if (!env.PREPSHIP_API_URL) {
    return {
      ok: false,
      status: 503,
      code: 'prep_ship_billing_unavailable',
      error: 'Billing totals are not configured. Set PREPSHIP_API_URL on the Client Portal API.',
    };
  }
  const ids = [...new Set(query.clientIds.filter((id) => Number.isInteger(id) && id > 0))];
  // No ids is a legitimate empty answer, not an upstream call.
  if (!ids.length) return { ok: true, byClient: new Map() };

  const params = new URLSearchParams({
    clientIds: ids.join(','),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  });

  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    upstream = await fetch(`${baseUrl}/billing/invoice-totals?${params.toString()}`, {
      method: 'GET',
      headers: {
        authorization,
        accept: 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error(
      '[client-portal] canonical invoice totals unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      ok: false,
      status: 502,
      code: 'prep_ship_billing_unavailable',
      error: 'PrepShip billing totals are temporarily unavailable. Please try again.',
    };
  }

  const body = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;

  if (!upstream.ok) {
    // Scope denials forward their STATUS but never their DETAIL: the portal must not leak
    // which client ids exist by varying its message.
    const status = upstream.status === 401 || upstream.status === 403 ? upstream.status : 502;
    return {
      ok: false,
      status,
      code: status === 502 ? 'prep_ship_billing_unavailable' : 'forbidden',
      error: status === 502
        ? 'PrepShip billing totals are temporarily unavailable. Please try again.'
        : 'Not found',
    };
  }

  const rows = Array.isArray(body?.data) ? body!.data as unknown[] : null;
  if (!rows) {
    return {
      ok: false,
      status: 502,
      code: 'prep_ship_billing_contract_mismatch',
      error: 'PrepShip billing totals returned an unexpected shape.',
    };
  }

  const byClient = new Map<number, CanonicalBillingTotals>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as { clientId?: unknown; totals?: unknown };
    const clientId = Number(entry.clientId);
    if (!Number.isInteger(clientId) || clientId <= 0) continue;
    const totals = parseCanonicalBillingTotals(entry.totals);
    // A row whose totals will not parse is a contract breach, not a zero. Returning 0 here
    // would put a confident, wrong number on a customer's Billing page.
    if (!totals) {
      return {
        ok: false,
        status: 502,
        code: 'prep_ship_billing_contract_mismatch',
        error: 'PrepShip billing totals contained an unreadable amount.',
      };
    }
    byClient.set(clientId, totals);
  }
  return { ok: true, byClient };
}
