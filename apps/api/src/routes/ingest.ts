import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ingestRequestSchema, gridId } from "@coredrive/protocol";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { authenticate } from "../auth/authenticate.js";
import { dedupeKey, normaliseObservation, type NormalisedObservation } from "../domain/observations.js";

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/ingest",
    {
      preHandler: authenticate,
      bodyLimit: 131072,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth || !pool) {
        return reply
          .code(503)
          .send({ error: { code: "unavailable", message: "Service unavailable" } });
      }

      const parsed = ingestRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: "invalid_payload",
            message: "Invalid ingest body",
            details: parsed.error.issues.slice(0, 10),
          },
        });
      }

      const { session, data } = parsed.data;
      const sessionId = session?.id ?? randomUUID();
      const errors: Array<{ index: number; message: string }> = [];
      const prepared: Array<{ obs: NormalisedObservation; key: string }> = [];

      for (const [index, obs] of data.entries()) {
        const result = normaliseObservation(obs);
        if (!result.ok) {
          errors.push({ index, message: result.error });
          continue;
        }
        prepared.push({
          obs: result.value,
          key: dedupeKey(auth.username, obs, obs.lat, obs.lon),
        });
      }

      if (prepared.length === 0) {
        return reply.code(400).send({
          error: { code: "invalid_payload", message: "No valid observations", details: errors },
        });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO users (username, last_seen)
           VALUES ($1, now())
           ON CONFLICT (username) DO UPDATE SET last_seen = now()`,
          [auth.username],
        );

        const sessionOwner = await client.query<{ user_id: string }>(
          "SELECT user_id FROM sessions WHERE id = $1",
          [sessionId],
        );
        if (sessionOwner.rows[0] && sessionOwner.rows[0].user_id !== auth.userId) {
          await client.query("ROLLBACK");
          return reply
            .code(403)
            .send({ error: { code: "forbidden", message: "Session belongs to another user" } });
        }

        await client.query(
          `INSERT INTO sessions (id, user_id, started_at, last_seen_at, client, app_version, device_model, radio_freq)
           VALUES ($1, $2, now(), now(), $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE
             SET last_seen_at = now(),
                 client = COALESCE(EXCLUDED.client, sessions.client),
                 app_version = COALESCE(EXCLUDED.app_version, sessions.app_version),
                 device_model = COALESCE(EXCLUDED.device_model, sessions.device_model),
                 radio_freq = COALESCE(EXCLUDED.radio_freq, sessions.radio_freq)`,
          [
            sessionId,
            auth.userId,
            session?.client ?? "pwa",
            session?.appVersion ?? null,
            session?.device ?? null,
            session?.radioFreq ?? null,
          ],
        );

        let accepted = 0;
        let duplicates = 0;

        for (const item of prepared) {
          const id = randomUUID();
          const envelope = {
            v: 1,
            kind: "observation",
            id,
            username: auth.username,
            sessionId,
            source: item.obs.obs.type === "OBS" ? "pwa" : "api",
            receivedAt: new Date().toISOString(),
            dedupeKey: item.key,
            obs: item.obs.obs,
          };

          const inserted = await client.query(
            `INSERT INTO ingest_outbox (id, username, topic, payload, dedupe_key)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (dedupe_key) DO NOTHING
             RETURNING id`,
            [
              id,
              auth.username,
              `${config.MQTT_TOPIC_PREFIX}/${auth.username}/packets`,
              envelope,
              item.key,
            ],
          );

          if (inserted.rowCount === 0) {
            duplicates += 1;
          } else {
            accepted += 1;
          }
        }

        await client.query(
          `UPDATE sessions
              SET obs_count = obs_count + $2,
                  last_seen_at = now()
            WHERE id = $1`,
          [sessionId, accepted],
        );

        await client.query("COMMIT");

        return reply.code(202).send({
          accepted,
          rejected: errors.length,
          duplicates,
          sessionId,
          errors: errors.slice(0, 10),
        });
      } catch (error) {
        await client.query("ROLLBACK");
        request.log.error(error);
        return reply
          .code(500)
          .send({ error: { code: "internal", message: "Failed to accept observations" } });
      } finally {
        client.release();
      }
    },
  );
}
