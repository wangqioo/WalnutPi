CREATE TABLE IF NOT EXISTS agent_turn_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id text NOT NULL,
  session_id text,
  status text NOT NULL,
  route jsonb,
  input jsonb NOT NULL,
  turn jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_turn_snapshots_turn_created_at_idx
  ON agent_turn_snapshots (turn_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_turn_snapshots_session_created_at_idx
  ON agent_turn_snapshots (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_turn_events (
  seq bigserial PRIMARY KEY,
  turn_id text NOT NULL,
  session_id text,
  kind text NOT NULL,
  status text NOT NULL,
  step_id text,
  data jsonb,
  error text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_turn_events_session_seq_idx
  ON agent_turn_events (session_id, seq);

CREATE INDEX IF NOT EXISTS agent_turn_events_turn_seq_idx
  ON agent_turn_events (turn_id, seq);

CREATE TABLE IF NOT EXISTS web_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  action text,
  ok boolean,
  context_used jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_session_events_session_occurred_at_idx
  ON web_session_events (session_id, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS web_session_events_event_id_idx
  ON web_session_events (event_id);
