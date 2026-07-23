CREATE TABLE evaluation_leases (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  dataset_id text NOT NULL,
  run_id text NOT NULL UNIQUE,
  labels_sha256 text NOT NULL CHECK (labels_sha256 ~ '^[a-f0-9]{64}$'),
  max_jobs integer NOT NULL CHECK (max_jobs BETWEEN 300 AND 500),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  bound_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evaluation_lease_samples (
  lease_id uuid NOT NULL REFERENCES evaluation_leases(id) ON DELETE CASCADE,
  sample_id text NOT NULL,
  candidate_token uuid NOT NULL,
  consumed_job_id uuid UNIQUE REFERENCES analysis_jobs(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  PRIMARY KEY (lease_id, sample_id),
  UNIQUE (lease_id, candidate_token)
);

CREATE INDEX evaluation_lease_expiry_idx
  ON evaluation_leases(expires_at)
  WHERE revoked_at IS NULL;
