import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { authenticate } from "../auth/authenticate.js";
import { generateApiKey, hashApiKey, keyPrefix } from "../auth/apiKeys.js";

const keySchema = z.object({ label: z.string().max(64).optional() });

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/me", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM sessions WHERE user_id = $1) AS sessions,
         (SELECT count(*)::int FROM observations WHERE user_id = $1) AS observations,
         (SELECT max(time) FROM observations WHERE user_id = $1) AS last_observation`,
      [auth.userId],
    );

    return {
      user: { username: auth.username },
      counts: rows[0],
    };
  });

  app.get("/api/v1/me/sessions", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const { rows } = await pool.query(
      `SELECT id, started_at, last_seen_at, ended_at, client, app_version,
              device_model, radio_freq, obs_count
         FROM sessions
        WHERE user_id = $1
        ORDER BY started_at DESC
        LIMIT 100`,
      [auth.userId],
    );
    return { sessions: rows };
  });

  app.get("/api/v1/me/observations", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const parsed = z
      .object({ limit: z.coerce.number().int().min(1).max(500).default(100) })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_payload" } });
    }

    const { rows } = await pool.query(
      `SELECT id, session_id, time, lat, lon, accuracy_m, snr, rssi, hops, hash_size,
              path_ids, heard_id, packet_hash, low_resolution
         FROM observations
        WHERE user_id = $1
        ORDER BY time DESC
        LIMIT $2`,
      [auth.userId, parsed.data.limit],
    );
    return { observations: rows };
  });

  app.get("/api/v1/me/keys", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const { rows } = await pool.query(
      `SELECT id, key_prefix, label, created_at, last_used_at, revoked_at
         FROM api_keys
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY created_at DESC`,
      [auth.userId],
    );
    return { keys: rows };
  });

  app.post("/api/v1/me/keys", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const parsed = keySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_payload" } });
    }

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL",
      [auth.userId],
    );
    if (Number(rows[0]?.count ?? 0) >= 3) {
      return reply
        .code(429)
        .send({ error: { code: "rate_limited", message: "Maximum of 3 active keys" } });
    }

    const key = generateApiKey();
    await pool.query(
      `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, label)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), auth.userId, hashApiKey(key), keyPrefix(key), parsed.data.label ?? null],
    );

    return reply.code(201).send({ key, prefix: keyPrefix(key), label: parsed.data.label ?? null });
  });

  app.delete("/api/v1/me/keys/:id", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_payload" } });
    }

    const { rowCount } = await pool.query(
      `UPDATE api_keys SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [parsed.data.id, auth.userId],
    );
    if (rowCount === 0) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }
    return reply.code(204).send();
  });

  app.delete("/api/v1/me/data", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const observations = await client.query(
        "DELETE FROM observations WHERE user_id = $1",
        [auth.userId],
      );
      const sessions = await client.query("DELETE FROM sessions WHERE user_id = $1", [auth.userId]);
      await client.query(
        `INSERT INTO audit_log (username, action, detail, ip)
         VALUES ($1, 'delete_own_data', $2, $3)`,
        [
          auth.username,
          { observations: observations.rowCount, sessions: sessions.rowCount },
          request.ip,
        ],
      );
      await client.query("COMMIT");

      return {
        deleted: {
          observations: observations.rowCount ?? 0,
          sessions: sessions.rowCount ?? 0,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error(error);
      return reply.code(500).send({ error: { code: "internal" } });
    } finally {
      client.release();
    }
  });
}
