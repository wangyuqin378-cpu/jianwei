ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS backend_release_sha256 text;

ALTER TABLE cards
  DROP CONSTRAINT IF EXISTS cards_backend_release_sha256_format;

ALTER TABLE cards
  ADD CONSTRAINT cards_backend_release_sha256_format
  CHECK (
    backend_release_sha256 IS NULL OR
    backend_release_sha256 ~ '^[0-9a-f]{64}$'
  );

CREATE INDEX IF NOT EXISTS cards_backend_release_created_idx
  ON cards(backend_release_sha256, created_at)
  WHERE backend_release_sha256 IS NOT NULL;
