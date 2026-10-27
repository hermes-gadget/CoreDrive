import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { pool } from "./db/pool.js";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: "coredrive_http_requests",
  help: "HTTP requests by method, route and status.",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: "coredrive_http_request_duration_seconds",
  help: "HTTP request duration by method, route and status.",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const ingestItems = new Counter({
  name: "coredrive_ingest_items",
  help: "Ingest items by result.",
  labelNames: ["result"],
  registers: [registry],
});

export const loginTotal = new Counter({
  name: "coredrive_login",
  help: "Login attempts by result.",
  labelNames: ["result"],
  registers: [registry],
});

const activeSessions = new Gauge({
  name: "coredrive_active_sessions",
  help: "Sessions seen in the last five minutes.",
  registers: [registry],
});

const observationsPerMinute = new Gauge({
  name: "coredrive_observations_per_minute",
  help: "Observations received in the last minute.",
  registers: [registry],
});

const outboxPending = new Gauge({
  name: "coredrive_outbox_pending",
  help: "Undelivered outbox rows.",
  registers: [registry],
});

const outboxOldestSeconds = new Gauge({
  name: "coredrive_outbox_oldest_seconds",
  help: "Age of the oldest undelivered outbox row.",
  registers: [registry],
});

const mqttConnected = new Gauge({
  name: "coredrive_mqtt_connected",
  help: "MQTT connection state reported by each service.",
  labelNames: ["service"],
  registers: [registry],
});

const mqttPublishedTotal = new Gauge({
  name: "coredrive_mqtt_published_total",
  help: "Messages published to MQTT since the service row was created.",
  labelNames: ["service"],
  registers: [registry],
});

const ingestConsumedTotal = new Gauge({
  name: "coredrive_ingest_consumed_total",
  help: "Messages consumed from MQTT since the service row was created.",
  labelNames: ["service"],
  registers: [registry],
});

const serviceLastSeenSeconds = new Gauge({
  name: "coredrive_service_last_seen_seconds",
  help: "Seconds since the service last wrote its heartbeat.",
  labelNames: ["service"],
  registers: [registry],
});

const dbAvailable = new Gauge({
  name: "coredrive_db_available",
  help: "Database reachable from the API.",
  registers: [registry],
});

const dbSizeBytes = new Gauge({
  name: "coredrive_db_size_bytes",
  help: "Database size in bytes.",
  registers: [registry],
});

export async function collectDbMetrics(): Promise<void> {
  if (!pool) {
    dbAvailable.set(0);
    return;
  }

  try {
    const { rows } = await pool.query<{
      active_sessions: number;
      observations_per_minute: number;
      outbox_pending: number;
      outbox_oldest_seconds: number;
      db_size_bytes: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM sessions
           WHERE ended_at IS NULL AND last_seen_at > now() - interval '5 minutes') AS active_sessions,
         (SELECT count(*)::int FROM observations
           WHERE time > now() - interval '1 minute') AS observations_per_minute,
         (SELECT count(*)::int FROM ingest_outbox
           WHERE delivered_at IS NULL) AS outbox_pending,
         COALESCE((
           SELECT EXTRACT(EPOCH FROM now() - min(created_at))
             FROM ingest_outbox
            WHERE delivered_at IS NULL
         ), 0)::float AS outbox_oldest_seconds,
         pg_database_size(current_database())::bigint AS db_size_bytes`,
    );
    const row = rows[0]!;
    activeSessions.set(row.active_sessions);
    observationsPerMinute.set(row.observations_per_minute);
    outboxPending.set(row.outbox_pending);
    outboxOldestSeconds.set(row.outbox_oldest_seconds);
    dbSizeBytes.set(Number(row.db_size_bytes));

    const services = await pool.query<{
      service: string;
      mqtt_connected: boolean;
      published_total: string;
      consumed_total: string;
      age_seconds: number;
    }>(
      `SELECT service, mqtt_connected, published_total, consumed_total,
              EXTRACT(EPOCH FROM now() - updated_at)::float AS age_seconds
         FROM service_status`,
    );
    for (const service of services.rows) {
      mqttConnected.set({ service: service.service }, service.mqtt_connected ? 1 : 0);
      mqttPublishedTotal.set({ service: service.service }, Number(service.published_total));
      ingestConsumedTotal.set({ service: service.service }, Number(service.consumed_total));
      serviceLastSeenSeconds.set({ service: service.service }, service.age_seconds);
    }

    dbAvailable.set(1);
  } catch {
    dbAvailable.set(0);
  }
}

export async function metricsText(): Promise<string> {
  await collectDbMetrics();
  return registry.metrics();
}
