ALTER TABLE analysis_jobs
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT analysis_jobs_retry_count_bounded
    CHECK (retry_count >= 0 AND retry_count <= 1);
