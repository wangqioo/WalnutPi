CREATE TABLE IF NOT EXISTS action_approval_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id text NOT NULL,
  action_id text NOT NULL,
  status text NOT NULL,
  params_hash text NOT NULL,
  command_binding_id text NOT NULL,
  subject_hash text NOT NULL,
  approval_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  committed_at timestamptz,
  commit_decision_id text,
  subject jsonb NOT NULL,
  decision jsonb NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_approval_records_decision_id_idx
  ON action_approval_records (decision_id, created_at DESC);

CREATE INDEX IF NOT EXISTS action_approval_records_action_status_idx
  ON action_approval_records (action_id, status, created_at DESC);
