import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';

/**
 * Thin Client Portal projection of PrepShip's persisted billing calendar key.
 * PrepShip owns weekend policy and writes billing_effective_date; this reader
 * only preserves legacy rows whose additive field is NULL.
 */
export function billingLineEffectiveDaySql(
  billingEffectiveDate: SQLWrapper,
  shipDate: SQLWrapper,
): SQL<Date | null> {
  return sql<Date | null>`coalesce(${billingEffectiveDate}, ${shipDate})`;
}

export const BILLING_POLICY_WEEKEND_ROLLFORWARD =
  'weekday_weekend_rollforward_v2' as const;
