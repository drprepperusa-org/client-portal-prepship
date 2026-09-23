-- Private receipts for retrying the same inbound-create intent.
CREATE TABLE IF NOT EXISTS public.portal_inbound_create_requests (
  actor_user_id text NOT NULL,
  request_key uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  inbound_id integer REFERENCES public.inbound_shipments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, request_key)
);
CREATE INDEX IF NOT EXISTS portal_inbound_create_requests_inbound_idx
  ON public.portal_inbound_create_requests(inbound_id);
ALTER TABLE public.portal_inbound_create_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_inbound_create_requests FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.portal_inbound_create_requests FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.portal_inbound_create_requests FROM authenticated;
  END IF;
END $$;
