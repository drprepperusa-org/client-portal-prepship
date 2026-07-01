-- Snapshot re-baseline (2026-07-02): everything in this migration already
-- exists in production — the runtime-DDL pattern evolved the live schema ahead
-- of the drizzle journal (order_items, fulfillment_outbox, orders.source_*,
-- shipments.confirmation_*, and their indexes). Every statement below is fully
-- idempotent (IF NOT EXISTS / guarded DO blocks), so running db:migrate against
-- prod is a no-op while fresh environments still get the complete schema.
CREATE TABLE IF NOT EXISTS "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"line_index" integer DEFAULT 0 NOT NULL,
	"sku" text NOT NULL,
	"name" text,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"unit_price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"image_url" text,
	"client_id" integer,
	"store_id" integer,
	"order_status" text NOT NULL,
	"order_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "carrier_account_clients" (
	"carrier_account_id" integer NOT NULL,
	"client_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_account_clients_carrier_account_id_client_id_pk" PRIMARY KEY("carrier_account_id","client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fulfillment_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"shipment_id" integer,
	"event_type" text NOT NULL,
	"provider" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_provider" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_account_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_order_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_order_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "raw_source_payload" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_to_user_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_to_email" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "selling_fee" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "selling_fee_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "selling_fee_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "selling_fee_source" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "carrier_provider" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "carrier_account_id" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "label_provider_key" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "confirmation_provider" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "confirmation_status" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "confirmation_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "confirmation_last_error" text;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "marketplace_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rate_cache" ADD COLUMN IF NOT EXISTS "diagnostics" jsonb;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_id_orders_id_fk') THEN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_client_id_clients_id_fk') THEN
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carrier_account_clients_carrier_account_id_carrier_accounts_id_fk') THEN
  ALTER TABLE "carrier_account_clients" ADD CONSTRAINT "carrier_account_clients_carrier_account_id_carrier_accounts_id_fk" FOREIGN KEY ("carrier_account_id") REFERENCES "public"."carrier_accounts"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_outbox_order_id_orders_id_fk') THEN
  ALTER TABLE "fulfillment_outbox" ADD CONSTRAINT "fulfillment_outbox_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fulfillment_outbox_shipment_id_shipments_id_fk') THEN
  ALTER TABLE "fulfillment_outbox" ADD CONSTRAINT "fulfillment_outbox_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_items_order_line_idx" ON "order_items" USING btree ("order_id","line_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_sku_idx" ON "order_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_lower_sku_idx" ON "order_items" USING btree (lower("sku"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_date_idx" ON "order_items" USING btree ("order_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_client_date_idx" ON "order_items" USING btree ("client_id","order_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_store_date_idx" ON "order_items" USING btree ("store_id","order_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_active_date_idx" ON "order_items" USING btree ("order_date") WHERE "order_items"."order_status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_active_client_date_idx" ON "order_items" USING btree ("client_id","order_date") WHERE "order_items"."order_status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_items_active_sku_date_idx" ON "order_items" USING btree ("sku","order_date") WHERE "order_items"."order_status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "carrier_account_clients_client_idx" ON "carrier_account_clients" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fulfillment_outbox_dedupe_idx" ON "fulfillment_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fulfillment_outbox_due_idx" ON "fulfillment_outbox" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_cache_expires_idx" ON "analytics_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_test_client_id_idx" ON "clients" USING btree ("id") WHERE "clients"."is_test" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_active_client_id_idx" ON "clients" USING btree ("id") WHERE coalesce("clients"."active", true) = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_assigned_user_idx" ON "orders" USING btree ("assigned_to_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_status_date_id_idx" ON "orders" USING btree ("order_status","order_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_client_status_date_idx" ON "orders" USING btree ("client_id","order_status","order_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_client_status_date_id_idx" ON "orders" USING btree ("client_id","order_status","order_date" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "orders"."client_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_store_status_date_idx" ON "orders" USING btree ("store_id","order_status","order_date" DESC NULLS LAST) WHERE "orders"."store_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_store_status_date_id_idx" ON "orders" USING btree ("store_id","order_status","order_date" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "orders"."store_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_walmart_shipstation_order_number_idx" ON "orders" USING btree ("order_number","id") WHERE "orders"."store_id" = 376661;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_walmart_direct_order_number_latest_idx" ON "orders" USING btree ("order_number","order_date" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "orders"."store_id" = 9000001;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_source_idx" ON "orders" USING btree ("source_provider","source_account_id","source_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_dashboard_sales_date_idx" ON "orders" USING btree ("order_date" DESC NULLS LAST) WHERE "orders"."order_status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_dashboard_sales_client_date_idx" ON "orders" USING btree ("client_id","order_date" DESC NULLS LAST) WHERE "orders"."order_status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_order_latest_idx" ON "shipments" USING btree ("order_id","id" DESC NULLS LAST) WHERE "shipments"."order_id" is not null and coalesce("shipments"."voided", false) = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_order_number_latest_idx" ON "shipments" USING btree ("order_number","id" DESC NULLS LAST) WHERE "shipments"."order_number" is not null and "shipments"."order_id" is null and coalesce("shipments"."voided", false) = false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_confirmation_status_idx" ON "shipments" USING btree ("confirmation_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shipments_carrier_provider_idx" ON "shipments" USING btree ("carrier_provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_active_updated_idx" ON "inventory" USING btree ("active","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_client_active_updated_idx" ON "inventory" USING btree ("client_id","active","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_ledger_inv_type_idx" ON "inventory_ledger" USING btree ("inventory_id","type");