-- One lifetime budget per isolated D1. No date/run-id reset, no device FK:
-- deleting device data cannot erase incurred/unknown cost and refill money.
CREATE TABLE evaluation_budget (
  id TEXT PRIMARY KEY CHECK (id = 'isolated-evaluation'),
  limit_micro_cny INTEGER NOT NULL CHECK (limit_micro_cny > 0),
  price_policy TEXT NOT NULL,
  auxiliary_reserve_micro_cny INTEGER NOT NULL CHECK (auxiliary_reserve_micro_cny > 0),
  blocked_reason TEXT
);

CREATE TABLE evaluation_cost_reservations (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES evaluation_budget(id),
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL CHECK (endpoint IN ('chat', 'responses')),
  reserved_micro_cny INTEGER NOT NULL CHECK (reserved_micro_cny > 0),
  auxiliary_reserve_micro_cny INTEGER NOT NULL CHECK (auxiliary_reserve_micro_cny > 0),
  settled_micro_cny INTEGER CHECK (settled_micro_cny >= 0 AND settled_micro_cny <= reserved_micro_cny),
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX evaluation_cost_budget ON evaluation_cost_reservations(budget_id);
