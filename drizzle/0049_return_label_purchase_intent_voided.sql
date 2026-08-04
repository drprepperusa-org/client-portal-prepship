-- CP-057: a voided return label must leave its purchase intent re-openable.
--
-- Voidedness itself is NOT owned here. `shipments.voided` stays canonical for
-- whether postage was voided, exactly as the CP-057 ownership split requires.
-- This state is the intent's DERIVED lifecycle marker, written from that event.
--
-- Why it is needed: without it a return whose label is voided can never get a
-- replacement. The intent is stranded at 'completed', UNIQUE (return_id) forbids
-- a second intent row, and the claim path only reopens 'reserved' or 'failed'.
-- The return would be permanently unable to buy postage again.
--
-- Additive and reversible: the constraint is widened, never narrowed, so every
-- existing row remains valid and a rollback only needs the previous CHECK back.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'return_label_purchase_intents_state_check'
  ) THEN
    ALTER TABLE public.return_label_purchase_intents
      DROP CONSTRAINT return_label_purchase_intents_state_check;
  END IF;
END $$;

ALTER TABLE public.return_label_purchase_intents
  ADD CONSTRAINT return_label_purchase_intents_state_check
  CHECK (
    state IN (
      'reserved',
      'purchasing',
      'purchased',
      'unknown_outcome',
      'failed',
      'completed',
      'voided'
    )
  );
