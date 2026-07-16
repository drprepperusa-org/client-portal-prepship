-- CP-057 security hardening for durable return-label purchase coordination.
--
-- The Client Portal never reads this table through Supabase PostgREST. The
-- Render backend owns the workflow and connects through the privileged database
-- connection, so the intended public-API posture is RLS enabled with no policy.
-- This is idempotent and does not change or delete any purchase-intent rows.

ALTER TABLE public.return_label_purchase_intents ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.return_label_purchase_intents
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE public.return_label_purchase_intents_id_seq
  FROM PUBLIC, anon, authenticated;
