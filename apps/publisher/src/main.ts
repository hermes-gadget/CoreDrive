import pg from "pg";
import mqtt from "mqtt";
import { z } from "zod";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    MQTT_URL: z.string().min(1),
    MQTT_USERNAME: z.string().min(1),
    MQTT_PASSWORD: z.string().min(1),
    LOG_LEVEL: z.string().default("info"),
  })
  .parse(process.env);

const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
pool.on("error", (error) => console.error("publisher: idle database client error", error));
pool.on("connect", (client) => {
  client.on("error", (error) => console.error("publisher: database client error", error));
});

const client = mqtt.connect(env.MQTT_URL, {
  username: env.MQTT_USERNAME,
  password: env.MQTT_PASSWORD,
  clientId: `coredrive-publisher-${process.pid}`,
  reconnectPeriod: 2000,
  connectTimeout: 10000,
  clean: true,
});

client.on("connect", () => console.log("publisher: mqtt connected"));
client.on("error", (error) => console.error("publisher: mqtt error", error.message));

function publish(topic: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("publish timeout"));
    }, 10000);

    client.publish(topic, payload, { qos: 1 }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });
}

async function sweep(): Promise<void> {
  const observations = await pool.query(
    "DELETE FROM observations WHERE time < now() - interval '180 days'",
  );
  const outbox = await pool.query(
    `DELETE FROM ingest_outbox
      WHERE (delivered_at IS NOT NULL AND delivered_at < now() - interval '7 days')
         OR (delivered_at IS NULL AND created_at < now() - interval '180 days')`,
  );
  const sessions = await pool.query(
    "DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days'",
  );
  console.log(
    "publisher: retention sweep removed observations=%d ingest_outbox=%d auth_sessions=%d",
    observations.rowCount ?? 0,
    outbox.rowCount ?? 0,
    sessions.rowCount ?? 0,
  );
}

let running = true;
let lastSweep = Date.now();

async function tick(): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    topic: string;
    payload: unknown;
  }>(
    `SELECT id, topic, payload
       FROM ingest_outbox
      WHERE delivered_at IS NULL
        AND (published_at IS NULL OR published_at < now() - interval '15 minutes')
      ORDER BY created_at
      LIMIT 50`,
  );

  for (const row of rows) {
    try {
      const payload = row.payload as { obs?: { rawFrame?: unknown } };
      if (payload?.obs) delete payload.obs.rawFrame;
      await publish(row.topic, JSON.stringify(payload));
      await pool.query(
        `UPDATE ingest_outbox
            SET published_at = now(), attempts = 0, last_error = NULL
          WHERE id = $1`,
        [row.id],
      );
    } catch (error) {
      await pool.query(
        `UPDATE ingest_outbox
            SET published_at = NULL, attempts = attempts + 1, last_error = $2
          WHERE id = $1`,
        [row.id, error instanceof Error ? error.message : String(error)],
      );
    }
  }
}

async function loop(): Promise<void> {
  while (running) {
    try {
      await tick();
    } catch (error) {
      console.error("publisher: tick failed", error);
    }
    if (Date.now() - lastSweep >= RETENTION_INTERVAL_MS) {
      try {
        await sweep();
      } catch (error) {
        console.error("publisher: retention sweep failed", error);
      } finally {
        lastSweep = Date.now();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function shutdown(): Promise<void> {
  running = false;
  client.end(true);
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

async function main(): Promise<void> {
  try {
    await sweep();
  } catch (error) {
    console.error("publisher: retention sweep failed", error);
  }
  lastSweep = Date.now();
  await loop();
}

void main();
