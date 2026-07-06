const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export type BillingDayRange = {
  /** Operator-picked first day, plain YYYY-MM-DD. */
  fromDay: string;
  /** Operator-picked last day, plain YYYY-MM-DD. */
  toDay: string;
  /** Inclusive lower bound: UTC midnight of fromDay. */
  fromUtc: string;
  /** Exclusive upper bound: UTC midnight of the day after toDay. */
  toUtcExclusive: string;
};

export function billingDayOf(raw: string | null | undefined): string | null {
  const match = DAY_RE.exec(String(raw ?? '').trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function addUtcDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function billingDayBefore(raw: string | null | undefined): string | null {
  const day = billingDayOf(raw);
  return day ? addUtcDays(day, -1) : null;
}

/**
 * Canonical client-portal billing range semantics: selected calendar days are
 * compared as UTC-midnight day buckets with an exclusive upper bound.
 */
export function billingDayRange(rawFrom: string, rawTo: string): BillingDayRange | null {
  const fromDay = billingDayOf(rawFrom);
  const toDay = billingDayOf(rawTo);
  if (!fromDay || !toDay) return null;
  return {
    fromDay,
    toDay,
    fromUtc: `${fromDay}T00:00:00.000Z`,
    toUtcExclusive: `${addUtcDays(toDay, 1)}T00:00:00.000Z`,
  };
}
