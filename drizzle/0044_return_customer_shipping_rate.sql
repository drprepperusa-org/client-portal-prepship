-- Freeze the customer-visible/billable return rate at label time. The raw
-- carrier/house cost remains on shipments; this snapshot is the shared display
-- truth for PrepShip + Client Portal and the return_postage billing line.
ALTER TABLE "returns"
  ADD COLUMN IF NOT EXISTS "return_customer_shipping_rate" numeric(12, 2);

-- Backfill every existing linked return using the same event-clock formula the
-- backend used before the snapshot existed. Requested/failed rows without a
-- label stay NULL; offline mock labels freeze at 0.00.
WITH return_rate_inputs AS (
  SELECT
    r.id,
    (
      COALESCE(NULLIF(s.cost, 0), s.label_cost, 0) + COALESCE(s.other_cost, 0)
    )::numeric AS house_cost,
    COALESCE(b.return_postage_markup_pct, 0)::numeric AS markup_pct,
    COALESCE(b.return_postage_markup_flat, 0)::numeric AS markup_flat,
    COALESCE(b.return_shipping_rate_override_trigger_below, 0)::numeric AS trigger_below,
    COALESCE(b.return_shipping_rate_override_amount, 0)::numeric AS override_amount
  FROM returns r
  JOIN shipments s ON s.id = r.return_shipment_id
  LEFT JOIN billing_config b ON b.client_id = r.client_id
), frozen_rates AS (
  SELECT
    id,
    CASE
      WHEN house_cost <= 0 THEN 0::numeric
      WHEN trigger_below > 0 AND override_amount > 0 AND house_cost < trigger_below
        THEN override_amount
      ELSE house_cost * (1 + markup_pct / 100) + markup_flat
    END AS customer_rate
  FROM return_rate_inputs
)
UPDATE returns r
SET return_customer_shipping_rate = ROUND(f.customer_rate, 2)
FROM frozen_rates f
WHERE r.id = f.id
  AND r.return_customer_shipping_rate IS NULL;
