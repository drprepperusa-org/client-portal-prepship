-- PS-512 / CP-059 — give the billing summary read model the categories it was already totalling.
--
-- `grand_total` on this table is sum(total_cost) over EVERY line type, so replacement and
-- adjustment money has always been inside it. What was missing were columns of their own, which
-- meant an itemized invoice could show components that did not add up to the total printed at
-- the bottom of the same page. Replacement charges in particular rendered as nothing.
--
-- Additive and nullable with a zero default: existing rows keep working, and the next metrics
-- refresh populates them. No existing column is altered, no data is rewritten, and no row is
-- deleted. `grand_total` is untouched — it was never wrong.

alter table billing_summary_metrics
  add column if not exists adjustment_total numeric(14, 2) not null default 0,
  add column if not exists replace_postage_total numeric(14, 2) not null default 0,
  add column if not exists replace_pick_pack_total numeric(14, 2) not null default 0;
