ALTER TABLE "billing_config" ADD COLUMN "return_processing_fee" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN "return_postage_markup_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN "return_postage_markup_flat" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN "return_shipping_rate_override_trigger_below" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN "return_shipping_rate_override_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- CP-031: return line-type totals on the billing summary read-model. The
-- materialized billing_summary_metrics table (raw-SQL migration 0029, not a
-- drizzle schema file) needs its own per-line-type columns so the summary
-- byType breakdown can surface return_postage / return_processing without a
-- live re-aggregation. Additive, IF NOT EXISTS — grand_total already SUMs all
-- line types so return money was already reconciled into it.
ALTER TABLE "billing_summary_metrics" ADD COLUMN IF NOT EXISTS "return_postage_total" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_summary_metrics" ADD COLUMN IF NOT EXISTS "return_processing_total" numeric(14, 2) DEFAULT 0 NOT NULL;