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

const ROUTE_TYPE_TRANSPORT_FLOOD = 0;
const ROUTE_TYPE_FLOOD = 1;
const PAYLOAD_TYPE_TRACE = 9;

/**
 * MeshCore only builds a repeater path on flood routes; direct routes carry the
 * remaining destinations and TRACE payloads carry per-hop SNR data, so neither
 * identifies a repeater that heard the packet.
 */
function derivesHeardId(routeType: number, packetType: number): boolean {
  const isFlood = routeType === ROUTE_TYPE_TRANSPORT_FLOOD || routeType === ROUTE_TYPE_FLOOD;
  return isFlood && packetType !== PAYLOAD_TYPE_TRACE;
}

export function normaliseObservation(obs: Observation): NormaliseResult {
  const now = Math.floor(Date.now() / 1000);
  if (obs.time > now + 600) return { ok: false, error: "timestamp is in the future" };
  if (obs.time < now - 60 * 60 * 24 * 30) return { ok: false, error: "timestamp older than 30 days" };
  if (obs.payloadLen === 0) return { ok: false, error: "missing payload" };

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
  if (!derivesHeardId(obs.routeType, obs.packetType)) {
    if (obs.heardId) {
      return { ok: false, error: "heard id is only defined for flood, non-trace observations" };
    }
    return {
      ok: true,
      value: {
        obs: { ...obs, heardId: undefined },
        heardId: null,
        lowResolution: obs.hashSize < 2,
      },
    };
  }

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
