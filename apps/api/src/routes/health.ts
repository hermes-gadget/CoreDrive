import type { FastifyInstance } from "fastify";
import { SERVICE_NAME, SERVICE_VERSION } from "@coredrive/protocol";
import { checkDb, pool } from "../db/pool.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async (_request, reply) => {
    return reply.type("text/plain").send("ok\n");
  });

  app.get("/api/v1/healthz", async () => {
    return {
      status: "ok",
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  app.get("/readyz", async (_request, reply) => {
    const db = await checkDb();
    if (!db) {
      return reply.code(503).send({ status: "degraded", db: "unavailable" });
    }
    return { status: "ok", db: "ok" };
  });

  app.get("/metrics", async (_request, reply) => {
    const lines = [
      "# HELP coredrive_up Process is serving requests.",
      "# TYPE coredrive_up gauge",
      "coredrive_up 1",
      "# HELP coredrive_uptime_seconds Process uptime.",
      "# TYPE coredrive_uptime_seconds gauge",
      `coredrive_uptime_seconds ${Math.round(process.uptime())}`,
    ];

    if (pool) {
      try {
        const { rows } = await pool.query<{
          observations: number;
          users: number;
          repeaters: number;
          pending: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM observations) AS observations,
             (SELECT count(*)::int FROM users) AS users,
             (SELECT count(DISTINCT heard_id)::int FROM observations WHERE heard_id IS NOT NULL) AS repeaters,
             (SELECT count(*)::int FROM ingest_outbox WHERE delivered_at IS NULL) AS pending`,
        );
        const row = rows[0]!;
        lines.push(
          "# HELP coredrive_observations_total Stored observations.",
          "# TYPE coredrive_observations_total gauge",
          `coredrive_observations_total ${row.observations}`,
          "# HELP coredrive_users_total Known users.",
          "# TYPE coredrive_users_total gauge",
          `coredrive_users_total ${row.users}`,
          "# HELP coredrive_repeaters_total Distinct heard repeater ids.",
          "# TYPE coredrive_repeaters_total gauge",
          `coredrive_repeaters_total ${row.repeaters}`,
          "# HELP coredrive_outbox_pending Undelivered outbox rows.",
          "# TYPE coredrive_outbox_pending gauge",
          `coredrive_outbox_pending ${row.pending}`,
        );
      } catch {
        lines.push("coredrive_db_available 0");
      }
    } else {
      lines.push("coredrive_db_available 0");
    }

    return reply.type("text/plain; version=0.0.4").send(`${lines.join("\n")}\n`);
  });
}
