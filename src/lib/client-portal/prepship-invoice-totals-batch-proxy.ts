import { env } from '../env';
import { TOTALS_FIELDS, parseCanonicalBillingTotals, type CanonicalBillingTotals } from './prepship-billing-details-proxy';
import type { BillingSummaryPeriod } from './billing-summary-canonical-keys';

type Failure = { ok: false; status: number; error: string; code: string };
type BatchResult = { ok: true; byPeriod: Map<string, Map<number, CanonicalBillingTotals>> } | Failure;
const mismatch = (): Failure => ({ ok: false, status: 502,
  code: 'prep_ship_billing_contract_mismatch', error: 'PrepShip billing totals returned an unexpected shape.' });
const unavailable = (status = 502): Failure => ({ ok: false, status,
  code: status === 401 || status === 403 ? 'forbidden' : 'prep_ship_billing_unavailable',
  error: status === 401 || status === 403 ? 'Not found' : 'PrepShip billing totals are temporarily unavailable. Please try again.' });
const keyOf = (p: Pick<BillingSummaryPeriod, 'dateFrom' | 'dateTo'>) => `${p.dateFrom}|${p.dateTo}`;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !s.startsWith('0000-')
  && Number.isFinite(Date.parse(`${s}T00:00:00.000Z`))
  && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s;

/** Transport only. PrepShip remains the owner of every monetary value and count.
 * Input periods are already clamped by keyBillingSummaryRows. Partitioning client
 * IDs is safe: PrepShip evaluates each client's history with its canonical duplicate policy.
 * Sequential HTTP chunks preserve its two-period DB concurrency bound; parallel
 * batch requests would multiply that bound. No retry, legacy fallback, or cache.
 */
export async function fetchCanonicalInvoiceTotalsBatch(
  authorization: string,
  periods: ReadonlyMap<string, BillingSummaryPeriod>,
  requestId?: string,
): Promise<BatchResult> {
  const byPeriod = new Map<string, Map<number, CanonicalBillingTotals>>();
  if (!periods.size) return { ok: true, byPeriod };
  if (!env.PREPSHIP_API_URL) return unavailable(503);
  const base = env.PREPSHIP_API_URL.replace(/\/+$/, '');
  const urlFor = (chunk: BillingSummaryPeriod[]) => `${base}/billing/invoice-totals/batch?${new URLSearchParams({ periods: JSON.stringify(chunk) })}`;
  const chunks: BillingSummaryPeriod[][] = [];
  let pending: BillingSummaryPeriod[] = [];
  // PrepShip admits 8 periods / 200 IDs each / 8192-character absolute URLs.
  // Leave URL headroom for proxy host rewriting. Never silently truncate input.
  for (const [key, period] of periods) {
    if (key !== keyOf(period) || !isDay(period.dateFrom) || !isDay(period.dateTo)
      || period.dateFrom > period.dateTo || !period.clientIds.length
      || new Set(period.clientIds).size !== period.clientIds.length) return mismatch();
    for (const id of period.clientIds) {
      if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return mismatch();
      const index = pending.findIndex(p => keyOf(p) === key);
      let candidate = pending.map(p => ({ ...p, clientIds: [...p.clientIds] }));
      if (index < 0) candidate.push({ dateFrom: period.dateFrom, dateTo: period.dateTo, clientIds: [id] });
      else candidate[index]!.clientIds.push(id);
      if (candidate.length > 8 || candidate.some(p => p.clientIds.length > 200) || urlFor(candidate).length > 7500) {
        if (pending.length) chunks.push(pending);
        candidate = [{ dateFrom: period.dateFrom, dateTo: period.dateTo, clientIds: [id] }];
        if (urlFor(candidate).length > 7500) return mismatch();
      }
      pending = candidate;
    }
  }
  if (pending.length) chunks.push(pending);

  for (const chunk of chunks) {
    let upstream: Response;
    try {
      upstream = await fetch(urlFor(chunk), { method: 'GET', headers: {
        authorization, accept: 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}),
      }, signal: AbortSignal.timeout(60_000) });
    } catch { return unavailable(); }
    if (!upstream.ok) return unavailable(upstream.status === 401 || upstream.status === 403 ? upstream.status : 502);
    const body = await upstream.json().catch(() => null) as { data?: unknown } | null;
    if (!Array.isArray(body?.data) || body.data.length !== chunk.length) return mismatch();
    const expected = new Map(chunk.map(p => [keyOf(p), new Set(p.clientIds)]));
    const seen = new Set<string>();
    for (const raw of body.data) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return mismatch();
      const entry = raw as { dateFrom?: unknown; dateTo?: unknown; data?: unknown };
      if (typeof entry.dateFrom !== 'string' || typeof entry.dateTo !== 'string' || !Array.isArray(entry.data)) return mismatch();
      const key = keyOf({ dateFrom: entry.dateFrom, dateTo: entry.dateTo });
      const ids = expected.get(key);
      if (!ids || seen.has(key) || entry.data.length !== ids.size) return mismatch();
      seen.add(key);
      const received = new Map<number, CanonicalBillingTotals>();
      for (const row of entry.data) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return mismatch();
        const { clientId, totals: rawTotals } = row as { clientId?: unknown; totals?: unknown };
        if (typeof clientId !== 'number' || !ids.has(clientId) || received.has(clientId)) return mismatch();
        // This new endpoint has no legacy missing-field contract. Require every
        // customer-safe field from the shared parser; never turn absence into $0.
        // Check primitive types before the legacy parser attempts numeric coercion.
        if (!rawTotals || typeof rawTotals !== 'object' || Array.isArray(rawTotals)) return mismatch();
        const source = rawTotals as Record<string, unknown>;
        if (!TOTALS_FIELDS.every(field => typeof source[field] === 'number'
          || (typeof source[field] === 'string' && (source[field] as string).trim() !== ''))) return mismatch();
        if (typeof source.customsDutiesTotal !== 'number' || !Number.isFinite(source.customsDutiesTotal)) return mismatch();
        const totals = parseCanonicalBillingTotals(rawTotals);
        if (!totals || !Number.isInteger(totals.orderCount) || totals.orderCount < 0) return mismatch();
        received.set(clientId, totals);
      }
      const merged = byPeriod.get(key) ?? new Map<number, CanonicalBillingTotals>();
      for (const [id, totals] of received) {
        if (merged.has(id)) return mismatch();
        merged.set(id, totals);
      }
      byPeriod.set(key, merged);
    }
  }
  return { ok: true, byPeriod };
}
