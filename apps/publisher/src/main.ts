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

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
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
    client.publish(topic, payload, { qos: 1 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

let running = true;

async function tick(): Promise<void> {
  const { rows } = await pool.query<{
    id: string;
    topic: string;
    payload: unknown;
  }>(
    `SELECT id, topic, payload
       FROM ingest_outbox
      WHERE delivered_at IS NULL
        AND attempts < 10
        AND (published_at IS NULL OR published_at < now() - interval '15 minutes')
      ORDER BY created_at
      LIMIT 50`,
  );

  for (const row of rows) {
    try {
      await publish(row.topic, JSON.stringify(row.payload));
      await pool.query(
        `UPDATE ingest_outbox
            SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [row.id],
      );
    } catch (error) {
      await pool.query(
        `UPDATE ingest_outbox
            SET attempts = attempts + 1, last_error = $2
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

void loop();
