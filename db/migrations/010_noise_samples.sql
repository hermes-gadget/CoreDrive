-- P1: radio noise samples. One row per 30 s sample, kept out of the
-- observation hypertable so coverage queries stay cheap.
CREATE TABLE IF NOT EXISTS noise_samples (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id      uuid REFERENCES sessions(id) ON DELETE SET NULL,
  time            timestamptz NOT NULL,
  lat             double precision NOT NULL,
  lon             double precision NOT NULL,
  grid_id         text NOT NULL,
  accuracy_m      real,
  noise_floor_dbm real,
  last_rssi       integer,
  last_snr        real,
  tx_air_secs     bigint,
  rx_air_secs     bigint,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, time)
);

SELECT create_hypertable('noise_samples', 'time', chunk_time_interval => interval '1 day', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS noise_samples_user_time_idx ON noise_samples (user_id, time DESC);
CREATE INDEX IF NOT EXISTS noise_samples_grid_time_idx ON noise_samples (grid_id, time DESC);
