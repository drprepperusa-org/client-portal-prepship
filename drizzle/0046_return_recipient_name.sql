-- Persist the editable recipient/attention name used at the fixed return
-- warehouse address. Additive and intentionally unbackfilled: existing labels
-- must continue to reflect the name that was actually used when purchased.

ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS return_recipient_name text;
