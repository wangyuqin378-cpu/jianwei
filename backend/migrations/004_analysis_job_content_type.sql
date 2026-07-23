ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS content_type text;
UPDATE analysis_jobs SET content_type = 'image/jpeg' WHERE content_type IS NULL;
ALTER TABLE analysis_jobs ALTER COLUMN content_type SET NOT NULL;

ALTER TABLE analysis_jobs DROP CONSTRAINT IF EXISTS analysis_jobs_content_type_check;
ALTER TABLE analysis_jobs
  ADD CONSTRAINT analysis_jobs_content_type_check CHECK (content_type = 'image/jpeg');
