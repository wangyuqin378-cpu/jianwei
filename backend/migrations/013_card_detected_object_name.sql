ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS detected_object_name text;

UPDATE cards
SET detected_object_name = title
WHERE detected_object_name IS NULL OR btrim(detected_object_name) = '';

ALTER TABLE cards
  ALTER COLUMN detected_object_name SET NOT NULL;

ALTER TABLE cards
  DROP CONSTRAINT IF EXISTS cards_detected_object_name_length;

ALTER TABLE cards
  ADD CONSTRAINT cards_detected_object_name_length
  CHECK (char_length(btrim(detected_object_name)) BETWEEN 1 AND 60);
