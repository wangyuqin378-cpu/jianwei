ALTER TABLE analysis_budget_events
  ADD COLUMN operation_key text;

CREATE UNIQUE INDEX analysis_budget_events_operation_key_idx
  ON analysis_budget_events (operation_key)
  WHERE operation_key IS NOT NULL;
