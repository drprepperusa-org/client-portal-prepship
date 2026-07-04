CREATE TABLE "return_inspection_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspection_id" integer NOT NULL,
	"media_type" text NOT NULL,
	"storage_ref" text NOT NULL,
	"content_type" text,
	"size_bytes" integer,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_inspections" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"return_shipment_id" integer,
	"received_at" timestamp with time zone,
	"condition" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"comments" text,
	"inspector_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"order_id" integer,
	"order_item_id" integer,
	"sku" text NOT NULL,
	"name" text,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"client_id" integer,
	"return_shipment_id" integer,
	"return_to_location_id" integer,
	"status" text DEFAULT 'requested' NOT NULL,
	"initiated_by" text NOT NULL,
	"initiated_by_email" text,
	"reason" text,
	"admin_override" boolean DEFAULT false NOT NULL,
	"admin_override_by" text,
	"admin_override_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "return_inspection_media" ADD CONSTRAINT "return_inspection_media_inspection_id_return_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."return_inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_return_shipment_id_shipments_id_fk" FOREIGN KEY ("return_shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_return_shipment_id_shipments_id_fk" FOREIGN KEY ("return_shipment_id") REFERENCES "public"."shipments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "returns" ADD CONSTRAINT "returns_return_to_location_id_locations_id_fk" FOREIGN KEY ("return_to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_inspection_media_inspection_idx" ON "return_inspection_media" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "return_inspections_return_idx" ON "return_inspections" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_inspections_shipment_idx" ON "return_inspections" USING btree ("return_shipment_id");--> statement-breakpoint
CREATE INDEX "return_items_return_idx" ON "return_items" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_items_order_item_idx" ON "return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "return_items_sku_idx" ON "return_items" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "returns_order_idx" ON "returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "returns_client_idx" ON "returns" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "returns_shipment_idx" ON "returns" USING btree ("return_shipment_id");--> statement-breakpoint
CREATE INDEX "returns_status_idx" ON "returns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "returns_one_active_per_order_idx" ON "returns" USING btree ("order_id") WHERE "returns"."admin_override" = false and "returns"."status" not in ('cancelled', 'closed');