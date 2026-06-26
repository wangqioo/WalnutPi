ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS operation text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS ok boolean;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS status integer;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS decision_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS fresh_decision_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS tool_name text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS tool_group text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS tool_operation text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS route text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS turn_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS trace_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS request_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS subject_kind text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS device_profile text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS params_hash text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS command_binding_id text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS subject_hash text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS params jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS error text;

CREATE INDEX IF NOT EXISTS audit_events_kind_created_at_idx
  ON audit_events (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_session_created_at_idx
  ON audit_events (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_decision_id_idx
  ON audit_events (decision_id);

CREATE INDEX IF NOT EXISTS audit_events_action_created_at_idx
  ON audit_events (action_id, created_at DESC);
