ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS object_box_x double precision,
  ADD COLUMN IF NOT EXISTS object_box_y double precision,
  ADD COLUMN IF NOT EXISTS object_box_width double precision,
  ADD COLUMN IF NOT EXISTS object_box_height double precision;

ALTER TABLE cards
  DROP CONSTRAINT IF EXISTS cards_object_box_normalized;

ALTER TABLE cards
  ADD CONSTRAINT cards_object_box_normalized
  CHECK (
    (
      object_box_x IS NULL
      AND object_box_y IS NULL
      AND object_box_width IS NULL
      AND object_box_height IS NULL
    )
    OR
    (
      object_box_x IS NOT NULL
      AND object_box_y IS NOT NULL
      AND object_box_width IS NOT NULL
      AND object_box_height IS NOT NULL
      AND object_box_x >= 0
      AND object_box_y >= 0
      AND object_box_width > 0
      AND object_box_height > 0
      AND object_box_x + object_box_width <= 1
      AND object_box_y + object_box_height <= 1
    )
  );
