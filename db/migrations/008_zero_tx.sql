-- Zero-TX verification and radio configuration evidence.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tx_air_secs_before bigint;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS tx_air_secs_after bigint;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS zero_tx_verified boolean;
