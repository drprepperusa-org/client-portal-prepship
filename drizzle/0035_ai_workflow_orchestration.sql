-- AI workflow orchestration foundation.
-- Non-destructive additions only. This creates isolated workflow metadata,
-- run state, and audit tables; it does not modify orders or shipments.

CREATE TABLE IF NOT EXISTS workflows (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  created_by text,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflows_status_idx ON workflows (status);
CREATE INDEX IF NOT EXISTS workflows_created_at_idx ON workflows (created_at);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id serial PRIMARY KEY,
  workflow_id integer NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version integer NOT NULL,
  spec jsonb NOT NULL,
  validation_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_versions_workflow_idx ON workflow_versions (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_versions_workflow_version_idx ON workflow_versions (workflow_id, version);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id serial PRIMARY KEY,
  workflow_id integer NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version_id integer NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  requested_by text,
  requested_by_email text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_runs_status_idx ON workflow_runs (status);
CREATE INDEX IF NOT EXISTS workflow_runs_created_at_idx ON workflow_runs (created_at);

CREATE TABLE IF NOT EXISTS workflow_step_runs (
  id serial PRIMARY KEY,
  workflow_run_id integer NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  action text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt integer NOT NULL DEFAULT 0,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_step_runs_run_idx ON workflow_step_runs (workflow_run_id);
CREATE INDEX IF NOT EXISTS workflow_step_runs_step_idx ON workflow_step_runs (workflow_run_id, step_id);
CREATE INDEX IF NOT EXISTS workflow_step_runs_status_idx ON workflow_step_runs (status);

CREATE TABLE IF NOT EXISTS workflow_action_audit_logs (
  id serial PRIMARY KEY,
  workflow_id integer REFERENCES workflows(id) ON DELETE SET NULL,
  workflow_run_id integer REFERENCES workflow_runs(id) ON DELETE SET NULL,
  workflow_step_run_id integer REFERENCES workflow_step_runs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_id text,
  actor_email text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_action_audit_workflow_idx ON workflow_action_audit_logs (workflow_id);
CREATE INDEX IF NOT EXISTS workflow_action_audit_run_idx ON workflow_action_audit_logs (workflow_run_id);
CREATE INDEX IF NOT EXISTS workflow_action_audit_created_at_idx ON workflow_action_audit_logs (created_at);

CREATE TABLE IF NOT EXISTS workflow_api_connections (
  id serial PRIMARY KEY,
  name text NOT NULL,
  service text NOT NULL,
  credentials_ref text,
  status text NOT NULL DEFAULT 'active',
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_api_connections_service_idx ON workflow_api_connections (service);
CREATE INDEX IF NOT EXISTS workflow_api_connections_status_idx ON workflow_api_connections (status);
