import { sql } from 'drizzle-orm';
import { db } from '../../db/client';

// CP-061 — the canonical replacement tables (PS-502, prepship-v4 migrations
// 0096-0101) are NOT applied to the shared production database yet. The portal
// surface ships ahead of them and must fail SOFT, not 500: while the tables
// are absent every replacement read returns empty and every order badge is
// false. This cached probe is the single gate; both read models consult it.
//
// 60s TTL: cheap enough to notice the schema landing without a redeploy,
// without probing information_schema on every request.
const TTL_MS = 60_000;

let cache: { ready: boolean; at: number } | null = null;

/** Test hook — integration suites drop/create the tables and must re-probe. */
export function resetReplacementsSchemaReadinessCache(): void {
  cache = null;
}

export async function replacementsSchemaReady(): Promise<boolean> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ready;
  try {
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('replacements', 'replacement_items')
    `);
    const ready = Number(rows[0]?.n ?? 0) === 2;
    cache = { ready, at: Date.now() };
    return ready;
  } catch {
    // A failed probe must never take the portal down — treat as not ready.
    cache = { ready: false, at: Date.now() };
    return false;
  }
}
