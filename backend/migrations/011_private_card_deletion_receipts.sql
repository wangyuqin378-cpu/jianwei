CREATE TABLE privacy_deletion_receipts (
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  card_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  topic_id text NOT NULL,
  preference_weight integer NOT NULL CHECK (preference_weight BETWEEN -20 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, card_id),
  UNIQUE (receipt_id)
);

CREATE INDEX privacy_deletion_receipts_device_created_idx
  ON privacy_deletion_receipts(device_id, created_at DESC);
