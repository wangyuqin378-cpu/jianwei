CREATE TABLE pending_object_deletions (
  object_key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_quality_score_check CHECK (quality_score >= 0 AND quality_score <= 1),
  ADD CONSTRAINT analysis_jobs_status_check CHECK (
    status IN ('awaiting_upload', 'uploaded', 'processing', 'completed', 'needs_content', 'rejected', 'failed')
  ),
  ADD CONSTRAINT analysis_jobs_local_labels_array_check CHECK (jsonb_typeof(local_labels) = 'array'),
  ADD CONSTRAINT analysis_jobs_sensitive_flags_array_check CHECK (jsonb_typeof(sensitive_flags) = 'array');

ALTER TABLE cards
  ADD CONSTRAINT cards_confidence_check CHECK (confidence >= 0 AND confidence <= 1),
  ADD CONSTRAINT cards_body_length_check CHECK (char_length(body) BETWEEN 28 AND 80),
  ADD CONSTRAINT cards_sources_array_check CHECK (
    jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) > 0
  ),
  ADD CONSTRAINT cards_status_check CHECK (status IN ('scheduled', 'shown', 'archived'));

CREATE UNIQUE INDEX cards_device_candidate_key ON cards(device_id, candidate_token);

ALTER TABLE feedback
  ADD CONSTRAINT feedback_action_check CHECK (
    action IN ('LIKE', 'DISLIKE', 'WRONG_OBJECT', 'TOO_PRIVATE', 'SAVE')
  );

ALTER TABLE tracked_items
  ADD CONSTRAINT tracked_items_reminder_days_check CHECK (reminder_days BETWEEN 7 AND 730),
  ADD CONSTRAINT tracked_items_device_card_key UNIQUE (device_id, card_id);
