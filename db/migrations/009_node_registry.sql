-- P1: node registry fields. Repeaters are keyed by the full Ed25519 public key,
-- so a contact sync can populate the map before a single advert is heard.
ALTER TABLE repeaters ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE repeaters ADD COLUMN IF NOT EXISTS out_path text;
ALTER TABLE repeaters ADD COLUMN IF NOT EXISTS out_path_len smallint;
ALTER TABLE repeaters ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS repeaters_position_idx
  ON repeaters (lat, lon)
  WHERE lat IS NOT NULL AND lon IS NOT NULL;
