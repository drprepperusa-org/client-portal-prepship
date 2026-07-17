-- PS-423 / CP returns: add generation fencing and renewable leases to the
-- existing CP-057 provider side-effect coordinator. Additive only.

ALTER TABLE public.return_label_purchase_intents
  ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_token text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_by text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'return_label_purchase_intents_generation_check'
  ) THEN
    ALTER TABLE public.return_label_purchase_intents
      ADD CONSTRAINT return_label_purchase_intents_generation_check
      CHECK (generation >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS return_label_purchase_intents_state_lease_idx
  ON public.return_label_purchase_intents (state, lease_expires_at);
