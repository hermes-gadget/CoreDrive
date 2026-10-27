-- Deletion watermark. Envelopes accepted before this instant must not be
-- replayed into the account after a data deletion.
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_deleted_at timestamptz;
