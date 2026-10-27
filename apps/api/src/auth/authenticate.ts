import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../db/pool.js";
import { hashApiKey } from "./apiKeys.js";
import { verifyToken } from "./tokens.js";

export interface AuthContext {
  userId: string;
  username: string;
  sid: string | null;
  via: "token" | "api-key";
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function unauthorized(reply: FastifyReply, message = "Authentication required"): void {
  reply.code(401).send({ error: { code: "unauthorized", message } });
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!pool) {
    reply.code(503).send({ error: { code: "unavailable", message: "Database not configured" } });
    return;
  }

  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const payload = await verifyToken(header.slice("Bearer ".length));
    if (!payload) {
      unauthorized(reply, "Invalid or expired token");
      return;
    }

    const { rows } = await pool.query<{
      id: string;
      username: string;
      status: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT u.id, u.username, u.status, s.expires_at, s.revoked_at
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.sid = $1`,
      [payload.sid],
    );

    const row = rows[0];
    if (
      !row ||
      row.revoked_at !== null ||
      new Date(row.expires_at).getTime() <= Date.now() ||
      row.status !== "active"
    ) {
      unauthorized(reply, "Session is no longer valid");
      return;
    }

    request.auth = {
      userId: row.id,
      username: row.username,
      sid: payload.sid,
      via: "token",
    };
    return;
  }

  const apiKey = request.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.startsWith("wdk_")) {
    const { rows } = await pool.query<{
      id: string;
      user_id: string;
      username: string;
      status: string;
    }>(
      `SELECT k.id, k.user_id, u.username, u.status
         FROM api_keys k
         JOIN users u ON u.id = k.user_id
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
      [hashApiKey(apiKey)],
    );

    const row = rows[0];
    if (!row || row.status !== "active") {
      unauthorized(reply, "Invalid API key");
      return;
    }

    await pool.query(
      `UPDATE api_keys
          SET last_used_at = now()
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < now() - interval '1 hour')`,
      [row.id],
    );

    request.auth = {
      userId: row.user_id,
      username: row.username,
      sid: null,
      via: "api-key",
    };
    return;
  }

  unauthorized(reply);
}
