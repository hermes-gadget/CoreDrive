import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/authenticate.js";
import { pool } from "../db/pool.js";
import { gridId } from "@coredrive/protocol";

const bodySchema = z.object({
  sessionId: z.string().uuid().optional(),
  time: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100_000).optional(),
  noiseFloorDbm: z.number().min(-200).max(0).optional(),
  lastRssi: z.number().int().min(-160).max(0).optional(),
  lastSnr: z.number().min(-40).max(40).optional(),
  txAirSecs: z.number().int().min(0).optional(),
  rxAirSecs: z.number().int().min(0).optional(),
});

/**
 * Radio noise is a property of the receiver's position, not of a packet.
 * Store one sample per 30 s while a session is live; never transmit.
 */
export async function noiseRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/noise",
    {
      preHandler: authenticate,
      bodyLimit: 4096,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { code: "invalid_payload", details: parsed.error.issues.slice(0, 10) } });
      }

      const auth = request.auth!;
      const sample = parsed.data;

      try {
        // A noise sample can arrive before the first observation batch, so make
        // sure the session row exists. Never attach a sample to someone else's
        // session.
        if (sample.sessionId) {
          await pool.query(
            `INSERT INTO sessions (id, user_id, started_at, last_seen_at)
             VALUES ($1, $2, to_timestamp($3), now())
             ON CONFLICT (id) DO NOTHING`,
            [sample.sessionId, auth.userId, sample.time],
          );
          const owner = await pool.query<{ user_id: string }>(
            "SELECT user_id FROM sessions WHERE id = $1",
            [sample.sessionId],
          );
          if (owner.rows[0]?.user_id !== auth.userId) {
            return reply.code(403).send({ error: { code: "forbidden" } });
          }
        }

        await pool.query(
          `INSERT INTO noise_samples (
              user_id, session_id, time, lat, lon, grid_id, accuracy_m,
              noise_floor_dbm, last_rssi, last_snr, tx_air_secs, rx_air_secs
           ) VALUES ($1, $2, to_timestamp($3), $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            auth.userId,
            sample.sessionId ?? null,
            sample.time,
            sample.lat,
            sample.lon,
            gridId(sample.lat, sample.lon),
            sample.accuracyM ?? null,
            sample.noiseFloorDbm ?? null,
            sample.lastRssi ?? null,
            sample.lastSnr ?? null,
            sample.txAirSecs ?? null,
            sample.rxAirSecs ?? null,
          ],
        );

        return reply.code(202).send({ accepted: 1 });
      } catch (error) {
        request.log.error(error);
        return reply.code(500).send({ error: { code: "internal" } });
      }
    },
  );
}
