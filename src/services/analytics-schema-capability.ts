import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { HTTPException } from 'hono/http-exception';

const required = ['selling_fee', 'selling_fee_breakdown', 'selling_fee_synced_at', 'selling_fee_source'];
export class AnalyticsSchemaUnavailable extends HTTPException {
  constructor() { super(503, { message: 'Analytics is temporarily unavailable: required database capabilities are not ready.' }); }
}
let ready = false;
let pending: Promise<void> | undefined;
let retryAfter = 0;

/** Read-only startup/request capability check. No runtime DDL or shared-data repair. */
export function ensureAnalyticsSchemaCapability(): Promise<void> {
  if (ready) return Promise.resolve();
  if (pending) return pending;
  const unavailable = () => new AnalyticsSchemaUnavailable();
  if (Date.now() < retryAfter) return Promise.reject(unavailable());
  pending = (async () => {
    try {
      const rows = await db.execute<{ column_name: string }>(sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'orders'
          and column_name in ('selling_fee', 'selling_fee_breakdown', 'selling_fee_synced_at', 'selling_fee_source')
      `);
      const present = new Set(rows.map(row => row.column_name));
      if (!required.every(name => present.has(name))) throw unavailable();
      ready = true;
    } catch {
      retryAfter = Date.now() + 30_000;
      throw unavailable();
    } finally { pending = undefined; }
  })();
  return pending;
}
