/**
 * CP-067 — how the Billing LIST assigns PrepShip's canonical money to its rows.
 *
 * PURE, on purpose. The route that uses this touches a database and an upstream HTTP call, so
 * the one thing in it that actually decides money — which (client, period) each row's totals
 * come from — was untestable without both. Review broke it twice while every guard stayed
 * green: once by keying every row to `-1` (zeroing the list), once by collapsing every period
 * onto the request range (double-counting the footer). Neither is possible to detect from the
 * outside of a function that needs a database to run. This module needs nothing.
 *
 * THE TWO RULES THIS OWNS
 *
 * 1. CLAMP. The read model labels a grouped row with the WHOLE calendar half/month it sits in,
 *    but its money only covers the part inside the selected range. Asking PrepShip for the full
 *    label returns canonical — but WRONG-WINDOW — money. A rolling 30-day view starting Aug 4
 *    showed Aug 1-3 charges; a current half-month showed charges dated after the selected end.
 *    That shipped, and review caught it live. Every period is intersected with the range here.
 *
 * 2. FAIL CLOSED, INCLUDING ON ABSENCE. A row must find its totals in the canonical answer or
 *    the whole list is a contract breach. PrepShip returns a zero-filled row for every client it
 *    was asked about and allowed to answer for, so an absent id is a scope drop or a malformed
 *    response — never "no activity". Rendering it as $0.00 is a confident wrong number, which is
 *    worse than an error. The previous version of the route did exactly that.
 */

export type BillingSummaryRange = { fromDay: string; toDay: string };

/** The identity fields the read models emit on every row. Everything else passes through. */
export type BillingSummaryIdentityRow = {
  clientId?: unknown;
  periodStart?: unknown;
  periodEnd?: unknown;
};

export type KeyedBillingSummaryRow<R> = {
  row: R;
  clientId: number;
  /** `${dateFrom}|${dateTo}` after clamping — the exact window PrepShip is asked about. */
  key: string;
  dateFrom: string;
  dateTo: string;
};

export type BillingSummaryPeriod = { dateFrom: string; dateTo: string; clientIds: number[] };

export type BillingSummaryContractBreach =
  | 'client_id_not_integer'
  | 'period_bounds_incomplete'
  | 'period_outside_range'
  | 'duplicate_client_period'
  | 'canonical_totals_incomplete';

// YYYY-MM-DD compares lexically, so a plain string comparison IS a date comparison.
const maxDay = (a: string, b: string): string => (a > b ? a : b);
const minDay = (a: string, b: string): string => (a < b ? a : b);

/**
 * Key every row to the clamped (client, period) its money must come from, and group the
 * distinct periods so the caller makes one upstream call per period rather than per row.
 *
 * Producer-contract violations are returned, not repaired: the read models always emit these
 * fields, so a breach is a bug upstream of the caller, and the answer is an error — not a
 * best-effort row with a plausible number in it.
 */
export function keyBillingSummaryRows<R extends BillingSummaryIdentityRow>(
  rows: readonly R[],
  range: BillingSummaryRange,
):
  | { ok: true; keyed: KeyedBillingSummaryRow<R>[]; periods: Map<string, BillingSummaryPeriod> }
  | { ok: false; reason: BillingSummaryContractBreach } {
  const keyed: KeyedBillingSummaryRow<R>[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    // A financial join is not the place to coerce. The read models emit a numeric client id;
    // anything else is a contract breach, not a value to be Number()'d into shape.
    const clientId = row.clientId;
    if (typeof clientId !== 'number' || !Number.isInteger(clientId) || clientId <= 0) {
      return { ok: false, reason: 'client_id_not_integer' };
    }

    // Period bounds are both-or-neither. A grouped row missing one is malformed grain, and
    // silently substituting the request range would hide it behind a plausible number.
    const hasStart = typeof row.periodStart === 'string';
    const hasEnd = typeof row.periodEnd === 'string';
    if (hasStart !== hasEnd) return { ok: false, reason: 'period_bounds_incomplete' };

    const dateFrom = hasStart ? maxDay(row.periodStart as string, range.fromDay) : range.fromDay;
    const dateTo = hasEnd ? minDay(row.periodEnd as string, range.toDay) : range.toDay;
    if (dateFrom > dateTo) return { ok: false, reason: 'period_outside_range' };
    const key = `${dateFrom}|${dateTo}`;

    // Two rows for one (client, period) would each receive the full canonical total and the
    // footer would count it twice. The producer groups by client and period, so this cannot
    // happen today — which is exactly why it must be an error if it ever does.
    const identity = `${clientId}@${key}`;
    if (seen.has(identity)) return { ok: false, reason: 'duplicate_client_period' };
    seen.add(identity);

    keyed.push({ row, clientId, key, dateFrom, dateTo });
  }

  const periods = new Map<string, BillingSummaryPeriod>();
  for (const k of keyed) {
    const entry = periods.get(k.key);
    if (entry) entry.clientIds.push(k.clientId);
    else periods.set(k.key, { dateFrom: k.dateFrom, dateTo: k.dateTo, clientIds: [k.clientId] });
  }
  return { ok: true, keyed, periods };
}

/**
 * Pair every keyed row with ITS OWN period's canonical totals. Any row that cannot find them
 * fails the whole assignment — see rule 2 above. There is deliberately no `?? 0` anywhere here.
 */
export function assignCanonicalTotals<R, T>(
  keyed: readonly KeyedBillingSummaryRow<R>[],
  canonicalByPeriod: ReadonlyMap<string, ReadonlyMap<number, T>>,
): { ok: true; rows: Array<{ row: R; totals: T }> } | { ok: false; reason: 'canonical_totals_incomplete' } {
  const rows: Array<{ row: R; totals: T }> = [];
  for (const k of keyed) {
    const totals = canonicalByPeriod.get(k.key)?.get(k.clientId);
    if (totals === undefined) return { ok: false, reason: 'canonical_totals_incomplete' };
    rows.push({ row: k.row, totals });
  }
  return { ok: true, rows };
}
