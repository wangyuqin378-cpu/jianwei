ALTER TABLE pending_object_deletions
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX pending_object_deletions_ready_idx
  ON pending_object_deletions (next_attempt_at, created_at, object_key);
