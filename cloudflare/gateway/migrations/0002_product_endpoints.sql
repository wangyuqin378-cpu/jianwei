CREATE TABLE IF NOT EXISTS idempotency_results (
  device_id TEXT NOT NULL,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (device_id, route, idempotency_key),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS knowledge_facts (
  topic_key TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL UNIQUE,
  object_name TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_json TEXT NOT NULL,
  scores_json TEXT NOT NULL,
  model_version TEXT NOT NULL,
  evidence_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK (photo_count >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  search_count INTEGER NOT NULL DEFAULT 0 CHECK (search_count >= 0),
  estimated_cost_microunits INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_microunits >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (device_id, kind, idempotency_key),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_results(expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_device_created ON usage_events(device_id, created_at);
