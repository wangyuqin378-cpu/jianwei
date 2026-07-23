ALTER TABLE analysis_budget_events
  ADD COLUMN reserved_cost_micro_cny bigint NOT NULL DEFAULT 1000000
  CHECK (reserved_cost_micro_cny > 0);

ALTER TABLE analysis_budget_events
  ALTER COLUMN reserved_cost_micro_cny DROP DEFAULT;
