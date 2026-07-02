-- Live carrier tracking snapshot on shipments (refreshed on demand from
-- ShipStation /v2/tracking). Idempotent so it is safe whether applied via
-- drizzle-kit migrate or directly against a database that already has it.
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "tracking_status" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "tracking_status_detail" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "tracking_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "delivered_at" timestamp with time zone;
