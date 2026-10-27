import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { ingestRoutes } from "./routes/ingest.js";
import { meRoutes } from "./routes/me.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      enabled: config.NODE_ENV !== "test",
    },
  });

  app.register(rateLimit, { global: false });
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(ingestRoutes);
  app.register(meRoutes);

  return app;
}
