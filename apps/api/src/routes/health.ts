import type { FastifyInstance } from "fastify";
import { SERVICE_NAME, SERVICE_VERSION } from "@coredrive/protocol";
import { checkDb } from "../db/pool.js";

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
}
