-- Service heartbeats for Prometheus. Publisher and ingest flush their counters
-- every few seconds so the API can expose MQTT state without extra scrape jobs.
CREATE TABLE IF NOT EXISTS service_status (
  service         text PRIMARY KEY,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  mqtt_connected  boolean NOT NULL DEFAULT false,
  published_total bigint NOT NULL DEFAULT 0,
  consumed_total  bigint NOT NULL DEFAULT 0,
  detail          jsonb
);

INSERT INTO service_status (service)
VALUES ('publisher'), ('ingest')
ON CONFLICT (service) DO NOTHING;
