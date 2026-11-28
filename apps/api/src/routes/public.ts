import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db/pool.js";

const coverageQuery = z.object({
  mode: z.enum(["any", "direct", "relayed"]).default("any"),
  days: z.coerce.number().int().min(1).max(180).default(30),
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
});

export async function publicRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/v1/coverage",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const parsed = coverageQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "invalid_payload", message: "Invalid coverage query" },
      });
    }

    const { mode, days, bbox, limit } = parsed.data;
    const modeFilter =
      mode === "direct"
        ? "route_type IN (0, 1) AND packet_type <> 9 AND hops = 0"
        : mode === "relayed"
          ? "route_type IN (0, 1) AND packet_type <> 9 AND hops > 0"
          : "true";

    let bounds: number[] | null = null;
    if (bbox) bounds = bbox.split(",").map(Number);

    const { rows } = await pool.query(
      `SELECT grid_id,
              observations,
              repeaters,
              best_snr,
              last_heard,
              lat,
              lon
         FROM (
           SELECT grid_id,
                  count(*)::int AS observations,
                  count(DISTINCT heard_id)::int AS repeaters,
                  max(snr)::real AS best_snr,
                  to_timestamp(floor(extract(epoch from max(time)) / 300) * 300) AS last_heard,
                  (split_part(grid_id, ':', 1)::float + 0.5) * 0.00225 AS lat,
                  (split_part(grid_id, ':', 2)::float + 0.5) * 0.00384 AS lon
             FROM observations
            WHERE time > now() - ($1 || ' days')::interval
              AND ${modeFilter}
            GROUP BY grid_id
         ) cells
        WHERE ($2::float IS NULL OR lat >= $2)
          AND ($3::float IS NULL OR lon >= $3)
          AND ($4::float IS NULL OR lat <= $4)
          AND ($5::float IS NULL OR lon <= $5)
        ORDER BY observations DESC
        LIMIT $6`,
      [days, bounds?.[1] ?? null, bounds?.[0] ?? null, bounds?.[3] ?? null, bounds?.[2] ?? null, limit],
    );

    return { mode, days, cells: rows };
  });

  app.get(
    "/api/v1/repeaters",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const parsed = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_payload" } });
    }

    const { rows } = await pool.query(
      `SELECT id, name, node_type, lat, lon, last_heard, source
         FROM repeaters
        WHERE lat IS NOT NULL AND lon IS NOT NULL
        ORDER BY last_heard DESC NULLS LAST
        LIMIT $1`,
      [parsed.data.limit],
    );

    return { repeaters: rows };
  });

  app.get(
    "/api/v1/repeaters/:id",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const parsed = z
      .object({ id: z.string().regex(/^[0-9a-f]{2,64}$/i) })
      .safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "invalid_payload" } });
    }

    const id = parsed.data.id.toLowerCase();
    let summary = await pool.query(
      `SELECT id, name, node_type, lat, lon, last_heard, source
         FROM repeaters
        WHERE id = $1`,
      [id],
    );

    // A short path hash is a prefix of the full public key. Only resolve it
    // when exactly one registry entry matches; otherwise report the ambiguity
    // instead of inventing a repeater.
    if (!summary.rows[0] && id.length < 64) {
      const candidates = await pool.query(
        `SELECT id, name, node_type, lat, lon, last_heard, source
           FROM repeaters
          WHERE id LIKE $1 || '%'
          LIMIT 2`,
        [id],
      );
      if (candidates.rows.length > 1) {
        return reply.code(409).send({
          error: { code: "ambiguous", message: "More than one node matches that path hash" },
          candidates: candidates.rows.map((row) => row.id),
        });
      }
      summary = candidates;
    }

    if (!summary.rows[0]) {
      return reply.code(404).send({ error: { code: "not_found" } });
    }

    // Path hashes are derived from the public key, not a prefix of it, so a
    // registry entry cannot be joined to observations until the resolver
    // stores path_hash. V1 returns the node itself; cells arrive in P2.
    return { repeater: summary.rows[0], cells: [] };
  });

  app.get(
    "/api/v1/stats",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (_request, reply) => {
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM sessions) AS sessions,
         (SELECT count(*)::int FROM observations) AS observations,
         (SELECT count(DISTINCT heard_id)::int FROM observations WHERE heard_id IS NOT NULL) AS repeaters,
         (SELECT count(*)::int FROM observations WHERE time > now() - interval '24 hours') AS last_24h,
         (SELECT to_timestamp(floor(extract(epoch from max(time)) / 300) * 300) FROM observations) AS last_observation`,
    );

    return rows[0];
  });
}
