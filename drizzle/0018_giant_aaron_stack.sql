-- PS-366: per-client below-trigger customer shipping override on
-- billing_config. Idempotent so it is safe whether applied via drizzle-kit
-- migrate or directly against a database that already has it (the admin app
-- shares this database and may apply the same columns).
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "shipping_rate_override_trigger_below" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "shipping_rate_override_amount" numeric(10, 2) DEFAULT '0' NOT NULL;
