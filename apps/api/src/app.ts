import Fastify, { type FastifyInstance } from "fastify";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      enabled: config.NODE_ENV !== "test",
    },
  });

  app.register(healthRoutes);

  return app;
}
