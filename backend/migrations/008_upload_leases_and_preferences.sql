ALTER TABLE analysis_jobs
  DROP CONSTRAINT analysis_jobs_status_check;

ALTER TABLE analysis_jobs
  ADD COLUMN upload_session_id uuid,
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN upload_claimed_at timestamptz,
  ADD COLUMN processing_claim_token uuid,
  ADD COLUMN processing_lease_expires_at timestamptz,
  ADD CONSTRAINT analysis_jobs_status_check CHECK (
    status IN ('awaiting_upload', 'uploading', 'uploaded', 'processing', 'completed', 'needs_content', 'rejected', 'failed')
  ),
  ADD CONSTRAINT analysis_jobs_processing_lease_pair_check CHECK (
    (processing_claim_token IS NULL) = (processing_lease_expires_at IS NULL)
  ),
  ADD CONSTRAINT analysis_jobs_processing_state_check CHECK (
    status <> 'processing' OR (processing_claim_token IS NOT NULL AND processing_lease_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT analysis_jobs_upload_claim_check CHECK (
    upload_claimed_at IS NULL OR (upload_session_id IS NOT NULL AND upload_expires_at IS NOT NULL)
  );

CREATE UNIQUE INDEX analysis_jobs_upload_session_key
  ON analysis_jobs(upload_session_id)
  WHERE upload_session_id IS NOT NULL;

CREATE TABLE topic_preferences (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  topic_id text NOT NULL,
  weight integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN -20 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, topic_id)
);

CREATE INDEX topic_preferences_device_updated_idx
  ON topic_preferences(device_id, updated_at DESC);
