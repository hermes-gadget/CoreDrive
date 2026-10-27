import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { httpDuration, httpRequests } from "./metrics.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { meRoutes } from "./routes/me.js";
import { publicRoutes } from "./routes/public.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: config.LOG_LEVEL,
      enabled: config.NODE_ENV !== "test",
    },
  });

  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? "unmatched";
    if (route === "/metrics") return;
    const labels = {
      method: request.method,
      route,
      status: String(reply.statusCode),
    };
    httpRequests.inc(labels);
    httpDuration.observe(labels, (reply.elapsedTime ?? 0) / 1000);
  });

  app.register(rateLimit, { global: false });
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(ingestRoutes);
  app.register(meRoutes);
  app.register(publicRoutes);

  return app;
}
