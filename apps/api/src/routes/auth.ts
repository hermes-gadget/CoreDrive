import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { loginTotal } from "../metrics.js";
import { pool } from "../db/pool.js";
import { verifyMqttCredentials } from "../auth/mqttVerify.js";
import { signToken } from "../auth/tokens.js";
import { authenticate } from "../auth/authenticate.js";

const loginSchema = z.object({
  username: z.string().regex(/^[A-Za-z0-9_.@-]{1,128}$/),
  password: z.string().min(1).max(256),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        loginTotal.inc({ result: "invalid" });
        return reply.code(400).send({
          error: { code: "invalid_payload", message: "username and password are required" },
        });
      }

      if (!pool) {
        return reply
          .code(503)
          .send({ error: { code: "unavailable", message: "Database not configured" } });
      }

      const { username, password } = parsed.data;
      const valid = await verifyMqttCredentials(username, password);
      if (!valid) {
        loginTotal.inc({ result: "failure" });
        return reply.code(401).send({
          error: { code: "invalid_credentials", message: "Invalid username or password" },
        });
      }

      const { rows } = await pool.query<{ id: string; username: string; status: string }>(
        `INSERT INTO users (username, last_seen)
         VALUES ($1, now())
         ON CONFLICT (username) DO UPDATE SET last_seen = now()
         RETURNING id, username, status`,
        [username],
      );

      const user = rows[0]!;
      if (user.status !== "active") {
        loginTotal.inc({ result: "suspended" });
        return reply
          .code(403)
          .send({ error: { code: "suspended", message: "Account is suspended" } });
      }

      const sid = randomUUID();
      const expiresAt = new Date(Date.now() + config.TOKEN_TTL_DAYS * 86400_000);
      await pool.query(
        `INSERT INTO auth_sessions (sid, user_id, expires_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, $5)`,
        [sid, user.id, expiresAt, request.headers["user-agent"] ?? null, request.ip],
      );

      const token = await signToken({ sub: user.id, username: user.username, sid });
      loginTotal.inc({ result: "success" });
      return reply.send({
        token,
        expiresAt: expiresAt.toISOString(),
        user: { username: user.username },
      });
    },
  );

  app.post("/api/v1/auth/logout", { preHandler: authenticate }, async (request, reply) => {
    const auth = request.auth!;
    if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

    await pool.query(
      `UPDATE auth_sessions SET revoked_at = now()
        WHERE sid = $1 AND revoked_at IS NULL`,
      [auth.sid],
    );

    return reply.code(204).send();
  });
}
