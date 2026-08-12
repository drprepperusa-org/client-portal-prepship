import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env';
import * as schema from './schema/index';

const sql = postgres(env.DATABASE_URL, {
  prepare: false,
  max: env.DB_POOL_MAX,
  idle_timeout: env.DB_IDLE_TIMEOUT_SECONDS,
  connect_timeout: env.DB_CONNECT_TIMEOUT_SECONDS,
  // Per-query timeout sent to Postgres via SET statement_timeout. Kills any
  // query that runs longer than 15s at the DB level, so the connection is
  // returned to the pool cleanly. Without this, slow queries can stack up,
  // exhaust the pool, and starve fast queries (like the /clients lookup
  // that was timing out on Render despite being a trivial SELECT).
  // 12s is well under Supabase's pooler hard-kill (typically 20-60s) but
  // long enough for legitimate analytical queries like /daily-stats.
  // idle_in_transaction_session_timeout covers the gap statement_timeout leaves:
  // a connection that has opened a transaction and stalled is not executing, so
  // statement_timeout never fires and the connection stays checked out. During
  // the 2026-08-12 outage every pooled connection sat in 'ClientRead' (Postgres
  // waiting on the app) — one for 64 minutes — with nothing to reclaim it.
  connection: {
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  },
});

export const db = drizzle(sql, { schema, casing: 'snake_case' });
export { sql };
