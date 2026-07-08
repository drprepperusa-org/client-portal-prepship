-- Shopify direct client store connect (spec 2026-07-08).
-- Additive sync bookkeeping for store_accounts. Forward-only order sync:
--   sync_anchor_at  — stamped at promotion (portal->admin); orders created
--                     before this instant are never imported.
--   sync_cursor_at  — incremental updated_at watermark; only advances after a
--                     page is fully persisted.
--   last_synced_at  — last successful sync tick for this account.
--   last_sync_error — machine-readable last failure ('auth' pauses after 3).
--   sync_failure_count — consecutive auth failures (reset on success).

ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "sync_anchor_at" timestamp with time zone;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "sync_cursor_at" timestamp with time zone;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamp with time zone;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "last_sync_error" text;
ALTER TABLE "store_accounts" ADD COLUMN IF NOT EXISTS "sync_failure_count" integer DEFAULT 0 NOT NULL;
