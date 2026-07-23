CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  candidate_token text NOT NULL,
  captured_at_bucket date,
  local_labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  quality_score double precision NOT NULL,
  sensitive_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  object_key text,
  status text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_jobs_device_created_idx
  ON analysis_jobs(device_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS analysis_jobs_device_candidate_idx
  ON analysis_jobs(device_id, candidate_token);

CREATE TABLE IF NOT EXISTS cards (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  candidate_token text NOT NULL,
  topic_id text NOT NULL,
  fact_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  personal_context text NOT NULL,
  confidence double precision NOT NULL,
  sources jsonb NOT NULL,
  status text NOT NULL,
  scheduled_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cards_device_schedule_idx
  ON cards(device_id, scheduled_date, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, card_id, action)
);

CREATE TABLE IF NOT EXISTS tracked_items (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  started_on date NOT NULL,
  reminder_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
