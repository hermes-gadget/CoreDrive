import { z } from "zod";

export const SERVICE_NAME = "coredrive";
export const SERVICE_VERSION = "0.1.0";

export const observationSchema = z.object({
  type: z.literal("OBS"),
  time: z.number().int().positive(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(100000).optional(),
  snr: z.number().min(-40).max(40).optional(),
  rssi: z.number().int().min(-160).max(0).optional(),
  routeType: z.number().int().min(0).max(3),
  packetType: z.number().int().min(0).max(15),
  hops: z.number().int().min(0).max(63),
  hashSize: z.number().int().min(1).max(3),
  path: z.array(z.string().regex(/^[0-9a-f]{2,6}$/i)).max(64).default([]),
  heardId: z.string().regex(/^[0-9a-f]{2,6}$/i).optional(),
  senderKey: z.string().regex(/^[0-9a-f]{8,64}$/i).optional(),
  packetHash: z.string().regex(/^[0-9a-f]{2,64}$/i),
  payloadLen: z.number().int().min(0).max(255).optional(),
  channelHash: z.string().regex(/^[0-9a-f]{2,16}$/i).optional(),
  rawFrame: z.string().regex(/^[0-9a-f]+$/i).max(600).optional(),
});

export const sessionInfoSchema = z.object({
  id: z.string().uuid().optional(),
  client: z.string().max(64).optional(),
  appVersion: z.string().max(64).optional(),
  device: z.string().max(128).optional(),
  radioFreq: z.string().max(64).optional(),
});

export const ingestRequestSchema = z.object({
  session: sessionInfoSchema.optional(),
  data: z.array(observationSchema).min(1).max(200),
});

export type Observation = z.infer<typeof observationSchema>;
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;

const LAT_STEP = 0.00225;
const LON_STEP = 0.00384;

export function gridId(lat: number, lon: number): string {
  return `${Math.floor(lat / LAT_STEP)}:${Math.floor(lon / LON_STEP)}`;
}

export const envelopeSchema = z.object({
  v: z.literal(1),
  kind: z.literal("observation"),
  id: z.string().uuid(),
  username: z.string().min(1).max(128),
  sessionId: z.string().uuid().nullable(),
  source: z.enum(["pwa", "api", "meshmapper-app"]),
  receivedAt: z.string().datetime(),
  dedupeKey: z.string().length(64),
  obs: observationSchema,
});

export type Envelope = z.infer<typeof envelopeSchema>;
