ALTER TABLE devices ADD COLUMN IF NOT EXISTS installation_hash text;

-- Legacy builds used the installation identifier as the bearer token. Its stored hash is
-- therefore a stable migration key, but all clients receive a new random token on register.
UPDATE devices SET installation_hash = token_hash WHERE installation_hash IS NULL;

ALTER TABLE devices ALTER COLUMN installation_hash SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_installation_hash_key ON devices(installation_hash);
