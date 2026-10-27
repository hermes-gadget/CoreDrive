import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SERVICE_NAME, SERVICE_VERSION } from "@coredrive/protocol";
import { config } from "../config.js";
import { checkDb } from "../db/pool.js";
import { metricsText, registry } from "../metrics.js";

function metricsTokenMatches(provided: string | undefined): boolean {
  const expected = config.METRICS_TOKEN;
  if (!expected || !provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

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

  app.get(
    "/metrics",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      // No token configured means the endpoint is not exposed at all.
      if (!config.METRICS_TOKEN) {
        return reply.code(404).send({ error: { code: "not_found", message: "Not found" } });
      }

      const authorization = request.headers.authorization;
      const headerToken = request.headers["x-metrics-token"];
      const provided =
        typeof authorization === "string" && authorization.startsWith("Bearer ")
          ? authorization.slice(7)
          : typeof headerToken === "string"
            ? headerToken
            : undefined;

      if (!metricsTokenMatches(provided)) {
        return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized" } });
      }

      return reply.type(registry.contentType).send(await metricsText());
    },
  );
}
