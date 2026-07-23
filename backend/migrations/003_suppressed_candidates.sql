CREATE TABLE IF NOT EXISTS suppressed_candidates (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  candidate_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, candidate_token)
);
