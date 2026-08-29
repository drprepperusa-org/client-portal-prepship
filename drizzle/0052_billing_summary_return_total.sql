-- CP-059 AC-6 — give the billing summary a canonical `return_total`.
--
-- `return_postage_total` and `return_processing_total` are the two NAMED parts of return money.
-- They are not its definition. The producer emits a per-row `returnTotal` that can exceed their
-- sum: a legacy bare return line funds returnTotal while setting neither presence flag (producer
-- fixture shape 5 — returnTotal 5.50 with both parts 0.00). Every surface that rendered
-- `returnPostage + returnProcessing` therefore printed $0.00 for a real $5.50 charge.
--
-- Materialized here so print, grid and export read one owned value instead of each re-deriving
-- it. `grand_total` is untouched — it sums every line type and was never wrong.
--
-- Additive, nullable-with-zero-default: existing rows keep working and the next metrics refresh
-- populates the column. No existing column is altered, no data is rewritten, no row is deleted.

alter table billing_summary_metrics
  add column if not exists return_total numeric(14, 2) not null default 0;
