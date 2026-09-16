ALTER TABLE idempotency_results ADD COLUMN reservation_token TEXT;
ALTER TABLE idempotency_results ADD COLUMN request_hash TEXT;
