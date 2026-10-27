import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
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

  app.register(rateLimit, { global: false });
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(ingestRoutes);
  app.register(meRoutes);
  app.register(publicRoutes);

  return app;
}
