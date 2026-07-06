-- Client Portal audit log.
-- Additive only: persists portal access and click activity for admin review.

CREATE TABLE IF NOT EXISTS client_portal_audit_logs (
  id serial PRIMARY KEY,
  event text NOT NULL,
  actor_user_id text,
  actor_email text,
  client_ids integer[] NOT NULL DEFAULT '{}',
  store_ids integer[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_portal_audit_logs_created_at_idx
  ON client_portal_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS client_portal_audit_logs_actor_email_idx
  ON client_portal_audit_logs (actor_email);

CREATE INDEX IF NOT EXISTS client_portal_audit_logs_event_idx
  ON client_portal_audit_logs (event);
