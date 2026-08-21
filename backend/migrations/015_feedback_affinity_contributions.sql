ALTER TABLE feedback
  ADD COLUMN affinity_delta_applied double precision NOT NULL DEFAULT 0;

UPDATE feedback
SET affinity_delta_applied = CASE action
  WHEN 'LIKE' THEN 4
  WHEN 'SAVE' THEN 5
  WHEN 'DISLIKE' THEN -4
  ELSE 0
END;
