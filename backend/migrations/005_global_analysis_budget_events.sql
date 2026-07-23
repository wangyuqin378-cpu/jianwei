CREATE TABLE IF NOT EXISTS analysis_budget_events (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analysis_budget_events_created_at_idx
  ON analysis_budget_events (created_at);
