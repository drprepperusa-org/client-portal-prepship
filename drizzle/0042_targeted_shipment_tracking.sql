ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shipstation_label_id" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "tracking_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "tracking_error" text;
