CREATE TABLE IF NOT EXISTS "return_label_purchase_intents" (
  "id" serial PRIMARY KEY,
  "return_id" integer NOT NULL REFERENCES "returns"("id") ON DELETE cascade,
  "state" text DEFAULT 'reserved' NOT NULL,
  "provider" text DEFAULT 'shipstation' NOT NULL,
  "provider_reference_key" text NOT NULL,
  "provider_label_id" text,
  "provider_shipment_id" text,
  "return_shipment_id" integer REFERENCES "shipments"("id") ON DELETE set null,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "selected_rate_json" jsonb,
  "provider_receipt_json" jsonb,
  "last_safe_error" text,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "purchased_at" timestamp with time zone,
  "reconciled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "return_label_purchase_intents_state_check"
    CHECK ("state" IN ('reserved', 'purchasing', 'purchased', 'unknown_outcome', 'failed', 'completed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "return_label_purchase_intents_return_idx"
  ON "return_label_purchase_intents" ("return_id");

CREATE UNIQUE INDEX IF NOT EXISTS "return_label_purchase_intents_provider_ref_idx"
  ON "return_label_purchase_intents" ("provider_reference_key");

CREATE INDEX IF NOT EXISTS "return_label_purchase_intents_state_idx"
  ON "return_label_purchase_intents" ("state", "updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "shipments_return_provider_key_idx"
  ON "shipments" ("label_provider_key")
  WHERE "is_return" = true AND "label_provider_key" IS NOT NULL;
