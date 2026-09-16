CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  installation_hash TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  scope TEXT NOT NULL,
  period TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, period)
);

CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
