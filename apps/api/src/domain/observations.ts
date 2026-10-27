import { createHash } from "node:crypto";
import type { Observation } from "@coredrive/protocol";

export interface NormalisedObservation {
  obs: Observation & { heardId?: string };
  heardId: string | null;
  lowResolution: boolean;
}

export type NormaliseResult =
  | { ok: true; value: NormalisedObservation }
  | { ok: false; error: string };

export function normaliseObservation(obs: Observation): NormaliseResult {
  const now = Math.floor(Date.now() / 1000);
  if (obs.time > now + 600) return { ok: false, error: "timestamp is in the future" };
  if (obs.time < now - 60 * 60 * 24 * 30) return { ok: false, error: "timestamp older than 30 days" };

  if (obs.hops === 0) {
    if (obs.path.length !== 0) return { ok: false, error: "zero-hop observation has a path" };
    if (obs.heardId) return { ok: false, error: "zero-hop observation has a heard id" };
    return { ok: true, value: { obs, heardId: null, lowResolution: obs.hashSize < 2 } };
  }

  if (obs.path.length !== obs.hops) {
    return { ok: false, error: "path length does not match hop count" };
  }

  const expectedLength = obs.hashSize * 2;
  for (const hop of obs.path) {
    if (hop.length !== expectedLength) {
      return { ok: false, error: "path id does not match hash size" };
    }
  }

  const last = obs.path[obs.path.length - 1]!.toLowerCase();
  if (obs.heardId && obs.heardId.toLowerCase() !== last) {
    return { ok: false, error: "heard id does not match the last path hop" };
  }

  return {
    ok: true,
    value: {
      obs: { ...obs, heardId: last },
      heardId: last,
      lowResolution: obs.hashSize < 2,
    },
  };
}

export function dedupeKey(
  username: string,
  obs: Observation,
  lat: number,
  lon: number,
): string {
  const material = [
    username,
    obs.packetHash.toLowerCase(),
    obs.time,
    lat.toFixed(5),
    lon.toFixed(5),
    obs.heardId ?? "",
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}
