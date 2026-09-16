-- A reserved photo is refundable only before any potentially billable dispatch.
ALTER TABLE idempotency_results ADD COLUMN model_call_started INTEGER NOT NULL DEFAULT 0 CHECK (model_call_started >= 0);
-- Pre-upgrade processing requests have no dispatch evidence. Do not refund
-- them on takeover as if they were known not to have reached the provider.
UPDATE idempotency_results SET model_call_started = 1 WHERE usage_reserved = 1;

-- Per-call journal, including failed/unfinished attempts. No image, prompt,
-- filename or model response text. NULL usage means unknown, never free.
-- usage_events remains a legacy successful-request summary: do not sum both.
CREATE TABLE model_usage_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  reservation_token TEXT NOT NULL,
  usage_class TEXT NOT NULL CHECK (usage_class IN ('product', 'evaluation')),
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL CHECK (endpoint IN ('chat', 'responses')),
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'response', 'transport_error')),
  http_status INTEGER,
  input_tokens INTEGER CHECK (input_tokens >= 0),
  output_tokens INTEGER CHECK (output_tokens >= 0),
  search_count INTEGER CHECK (search_count >= 0),
  search_count_source TEXT NOT NULL DEFAULT 'unknown' CHECK (search_count_source IN ('unknown', 'reported', 'observed', 'not_requested')),
  estimated_cost_microunits INTEGER CHECK (estimated_cost_microunits >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX model_usage_events_device_time ON model_usage_events(device_id, started_at);
CREATE INDEX model_usage_events_reservation ON model_usage_events(reservation_token);
