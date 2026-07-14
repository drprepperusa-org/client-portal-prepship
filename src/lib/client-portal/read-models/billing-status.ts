import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../../db/client';

export type BillingLastGenerated = { at: string } | null;

type BillingStatusRow = { at: string | null };
type BillingStatusExecutor = (query: SQL) => Promise<BillingStatusRow[]>;

const executeBillingStatusQuery: BillingStatusExecutor = (query) =>
  db.execute<BillingStatusRow>(query);

/** A successful empty table is `null`; query failures intentionally propagate. */
export async function getBillingLastGenerated(
  execute: BillingStatusExecutor = executeBillingStatusQuery,
): Promise<BillingLastGenerated> {
  const rows = await execute(sql`
    select to_char(max(created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at
    from billing_line_items
  `);
  const at = rows[0]?.at ?? null;
  return at ? { at } : null;
}
