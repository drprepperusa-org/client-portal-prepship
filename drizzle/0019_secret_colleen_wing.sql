-- Billed-shipping lookups by shipment (Shipments page parity with Billing).
-- Idempotent per the shared-database convention.
CREATE INDEX IF NOT EXISTS "billing_li_shipment_idx" ON "billing_line_items" USING btree ("shipment_id");
