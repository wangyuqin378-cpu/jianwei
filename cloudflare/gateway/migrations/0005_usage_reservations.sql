ALTER TABLE idempotency_results ADD COLUMN usage_class TEXT CHECK (usage_class IN ('product', 'evaluation'));
ALTER TABLE idempotency_results ADD COLUMN usage_day TEXT;
ALTER TABLE idempotency_results ADD COLUMN usage_month TEXT;
ALTER TABLE idempotency_results ADD COLUMN usage_reserved INTEGER NOT NULL DEFAULT 0 CHECK (usage_reserved IN (0, 1));
