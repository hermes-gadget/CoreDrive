import pg from "pg";
import mqtt from "mqtt";
import { z } from "zod";
import { envelopeSchema, gridId } from "@coredrive/protocol";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    MQTT_URL: z.string().min(1),
    MQTT_USERNAME: z.string().min(1),
    MQTT_PASSWORD: z.string().min(1),
    MQTT_TOPIC_PREFIX: z.string().default("wardrive"),
  })
  .parse(process.env);

const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
pool.on("error", (error) => console.error("ingest: idle database client error", error));

const client = mqtt.connect(env.MQTT_URL, {
  username: env.MQTT_USERNAME,
  password: env.MQTT_PASSWORD,
  clientId: "coredrive-ingest",
  reconnectPeriod: 2000,
  connectTimeout: 10000,
  clean: false,
});

const inFlight = new Set<Promise<void>>();
let stopping = false;

client.on("connect", () => {
  console.log("ingest: mqtt connected");
  client.subscribe(`${env.MQTT_TOPIC_PREFIX}/#`, { qos: 1 }, (error) => {
    if (error) console.error("ingest: subscribe failed", error.message);
  });
});
client.on("error", (error) => console.error("ingest: mqtt error", error.message));

async function store(db: pg.PoolClient, raw: Buffer): Promise<void> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString("utf8"));
  } catch {
    return;
  }

  const parsed = envelopeSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.error("ingest: invalid envelope", parsed.error.issues[0]?.message);
    return;
  }

  const envelope = parsed.data;
  const { obs } = envelope;

  await db.query("BEGIN");
  try {
    const userResult = await db.query<{ id: string; status: string; data_deleted_at: Date | null }>(
      `INSERT INTO users (username, last_seen)
       VALUES ($1, now())
       ON CONFLICT (username) DO UPDATE SET last_seen = now()
       RETURNING id, status, data_deleted_at`,
      [envelope.username],
    );
    const user = userResult.rows[0];
    if (!user || user.status !== "active") {
      await db.query("ROLLBACK");
      return;
    }

    if (user.data_deleted_at && Date.parse(envelope.receivedAt) <= new Date(user.data_deleted_at).getTime()) {
      await db.query("ROLLBACK");
      return;
    }

    if (envelope.sessionId) {
      await db.query(
        `INSERT INTO sessions (id, user_id, started_at, last_seen_at)
         VALUES ($1, $2, to_timestamp($3), now())
         ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
        [envelope.sessionId, user.id, obs.time],
      );
    }

    const inserted = await db.query(
      `INSERT INTO observations (
          id, session_id, user_id, time, lat, lon, grid_id, accuracy_m, snr, rssi,
          route_type, packet_type, hops, hash_size, path_ids, heard_id, sender_key,
          packet_hash, payload_len, channel_hash, low_resolution, ambiguous, raw_frame,
          source, dedupe_key
       ) VALUES (
          $1, $2, $3, to_timestamp($4), $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, false, NULL,
          $22, $23
       )
       ON CONFLICT (dedupe_key, time) DO NOTHING
       RETURNING id`,
      [
        envelope.id,
        envelope.sessionId,
        user.id,
        obs.time,
        obs.lat,
        obs.lon,
        gridId(obs.lat, obs.lon),
        obs.accuracyM ?? null,
        obs.snr ?? null,
        obs.rssi ?? null,
        obs.routeType,
        obs.packetType,
        obs.hops,
        obs.hashSize,
        obs.path,
        obs.heardId ?? null,
        obs.senderKey ?? null,
        obs.packetHash,
        obs.payloadLen ?? null,
        obs.channelHash ?? null,
        obs.hashSize < 2,
        envelope.source,
        envelope.dedupeKey,
      ],
    );

    if (inserted.rowCount && envelope.sessionId) {
      await db.query(
        `UPDATE sessions
            SET obs_count = obs_count + 1, last_seen_at = now()
          WHERE id = $1`,
        [envelope.sessionId],
      );
    }

    await db.query(
      `UPDATE ingest_outbox
          SET delivered_at = now(), last_error = NULL
        WHERE id = $1`,
      [envelope.id],
    );

    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function storeMessage(raw: Buffer): Promise<void> {
  const db = await pool.connect();
  db.on("error", (error) => console.error("ingest: checked-out database client error", error));
  try {
    await store(db, raw);
  } finally {
    db.release();
  }
}

function track(task: Promise<void>): void {
  inFlight.add(task);
  void task.then(
    () => inFlight.delete(task),
    () => inFlight.delete(task),
  );
}

// mqtt.js 5.x has no manualAcks/publicationAck in its public typings, so the
// documented handleMessage hook provides the manual acknowledgement instead:
// the QoS 1 PUBACK is only sent once the callback runs, i.e. after storage.
client.handleMessage = (packet, callback) => {
  const topic = packet.topic;
  const expected = `${env.MQTT_TOPIC_PREFIX}/`;
  if (!topic.startsWith(expected) || !topic.endsWith("/packets")) {
    callback();
    return;
  }
  if (stopping) return;

  const payload =
    typeof packet.payload === "string" ? Buffer.from(packet.payload) : packet.payload;

  track(
    storeMessage(payload).then(
      () => callback(),
      (error) => {
        // No ack on failure: the broker redelivers and dedupe makes retries safe.
        console.error("ingest: store failed; message left unacknowledged", error);
      },
    ),
  );
};

async function shutdown(): Promise<void> {
  stopping = true;
  client.end(true);
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
