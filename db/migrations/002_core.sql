CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username   text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  notes      text
);

CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  client       text,
  app_version  text,
  device_model text,
  radio_freq   text,
  iata         text,
  obs_count    integer NOT NULL DEFAULT 0,
  distance_m   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sessions_user_time_idx ON sessions (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS observations (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id     uuid REFERENCES sessions(id) ON DELETE SET NULL,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time           timestamptz NOT NULL,
  lat            double precision NOT NULL,
  lon            double precision NOT NULL,
  grid_id        text NOT NULL,
  accuracy_m     real,
  snr            real,
  rssi           integer,
  route_type     smallint NOT NULL,
  packet_type    smallint NOT NULL,
  hops           smallint NOT NULL,
  hash_size      smallint NOT NULL,
  path_ids       text[] NOT NULL DEFAULT '{}',
  heard_id       text,
  sender_key     text,
  packet_hash    text NOT NULL,
  payload_len    smallint,
  channel_hash   text,
  low_resolution boolean NOT NULL DEFAULT false,
  ambiguous      boolean NOT NULL DEFAULT false,
  raw_frame      text,
  source         text,
  dedupe_key     text NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, time)
);

SELECT create_hypertable('observations', 'time', chunk_time_interval => interval '1 day', if_not_exists => TRUE);
CREATE UNIQUE INDEX IF NOT EXISTS observations_dedupe_idx ON observations (dedupe_key, time);
CREATE INDEX IF NOT EXISTS observations_user_time_idx ON observations (user_id, time DESC);
CREATE INDEX IF NOT EXISTS observations_heard_time_idx ON observations (heard_id, time DESC);
CREATE INDEX IF NOT EXISTS observations_grid_idx ON observations (grid_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text NOT NULL,
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  sid        uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip         inet
);

CREATE TABLE IF NOT EXISTS ingest_outbox (
  id           uuid PRIMARY KEY,
  username     text NOT NULL,
  topic        text NOT NULL,
  payload      jsonb NOT NULL,
  dedupe_key   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  delivered_at timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);
CREATE UNIQUE INDEX IF NOT EXISTS ingest_outbox_dedupe_idx ON ingest_outbox (dedupe_key);
CREATE INDEX IF NOT EXISTS ingest_outbox_pending_idx ON ingest_outbox (published_at NULLS FIRST, created_at);

CREATE TABLE IF NOT EXISTS repeaters (
  id          text PRIMARY KEY,
  public_key  text,
  name        text,
  node_type   text,
  first_heard timestamptz,
  last_heard  timestamptz,
  lat         double precision,
  lon         double precision,
  ambiguous   boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS audit_log (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  username text,
  action   text NOT NULL,
  detail   jsonb,
  ip       inet
);
