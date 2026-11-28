import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate } from "../auth/authenticate.js";
import { pool } from "../db/pool.js";

const NODE_TYPES: Record<number, string> = {
  1: "chat",
  2: "repeater",
  3: "room",
  4: "sensor",
};

const contactSchema = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{64}$/i),
  nodeType: z.number().int().min(0).max(15),
  flags: z.number().int().min(0).max(255).optional(),
  outPath: z.string().regex(/^[0-9a-f]{0,128}$/i).optional(),
  outPathLen: z.number().int().min(0).max(64).optional(),
  name: z.string().max(64).nullable().optional(),
  lastAdvert: z.number().int().min(0).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lon: z.number().min(-180).max(180).nullable().optional(),
  lastMod: z.number().int().min(0).optional(),
});

const bodySchema = z.object({
  contacts: z.array(contactSchema).min(1).max(500),
});

/**
 * Contacts come from the radio's own address book. They are advisory: the
 * canonical identity is the full public key, and a position is only stored
 * when the radio reports a plausible one. Nothing here transmits.
 */
export async function registryRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/registry/contacts",
    {
      preHandler: authenticate,
      bodyLimit: 262144,
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!pool) return reply.code(503).send({ error: { code: "unavailable" } });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { code: "invalid_payload", details: parsed.error.issues.slice(0, 10) } });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let accepted = 0;

        for (const contact of parsed.data.contacts) {
          const pubkey = contact.pubkey.toLowerCase();
          const lat = contact.lat ?? null;
          const lon = contact.lon ?? null;
          const hasPosition =
            lat !== null &&
            lon !== null &&
            Math.abs(lat) <= 90 &&
            Math.abs(lon) <= 180 &&
            !(lat === 0 && lon === 0);
          const heardAt =
            contact.lastAdvert && contact.lastAdvert > 0
              ? new Date(contact.lastAdvert * 1000)
              : null;

          const result = await client.query(
            `INSERT INTO repeaters (
                id, public_key, name, node_type, lat, lon, first_heard, last_heard,
                ambiguous, source, out_path, out_path_len, updated_at
             ) VALUES ($1, $1, $2, $3, $4, $5, $6, $6, false, 'contact', $7, $8, now())
             ON CONFLICT (id) DO UPDATE
               SET name = COALESCE(EXCLUDED.name, repeaters.name),
                   node_type = COALESCE(EXCLUDED.node_type, repeaters.node_type),
                   lat = COALESCE(EXCLUDED.lat, repeaters.lat),
                   lon = COALESCE(EXCLUDED.lon, repeaters.lon),
                   first_heard = LEAST(repeaters.first_heard, EXCLUDED.first_heard),
                   last_heard = GREATEST(repeaters.last_heard, EXCLUDED.last_heard),
                   source = COALESCE(repeaters.source, 'contact'),
                   out_path = COALESCE(EXCLUDED.out_path, repeaters.out_path),
                   out_path_len = COALESCE(EXCLUDED.out_path_len, repeaters.out_path_len),
                   updated_at = now()`,
            [
              pubkey,
              contact.name ?? null,
              NODE_TYPES[contact.nodeType] ?? null,
              hasPosition ? lat : null,
              hasPosition ? lon : null,
              heardAt,
              contact.outPath?.toLowerCase() ?? null,
              contact.outPathLen ?? null,
            ],
          );
          accepted += result.rowCount ?? 0;
        }

        await client.query("COMMIT");
        return reply.code(202).send({ accepted, contacts: parsed.data.contacts.length });
      } catch (error) {
        await client.query("ROLLBACK");
        request.log.error(error);
        return reply.code(500).send({ error: { code: "internal" } });
      } finally {
        client.release();
      }
    },
  );
}
