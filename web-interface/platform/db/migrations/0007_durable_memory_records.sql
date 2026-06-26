CREATE TABLE IF NOT EXISTS durable_memory_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_candidate_id uuid REFERENCES memory_candidates(id) ON DELETE SET NULL,
  category_key text NOT NULL,
  memory_text text NOT NULL,
  status text NOT NULL,
  approved_by_subject_kind text,
  approved_by_user_id text,
  approved_by_org_id text,
  approved_by_device_id text,
  source_tool text NOT NULL,
  metadata jsonb,
  approved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS durable_memory_records_category_idx
  ON durable_memory_records (category_key);

CREATE INDEX IF NOT EXISTS durable_memory_records_status_idx
  ON durable_memory_records (status);

CREATE INDEX IF NOT EXISTS durable_memory_records_source_candidate_idx
  ON durable_memory_records (source_candidate_id);
