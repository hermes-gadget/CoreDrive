import { describe, expect, it } from "vitest";
import type { Observation } from "@coredrive/protocol";
import { dedupeKey, normaliseObservation } from "../src/domain/observations.js";

const now = Math.floor(Date.now() / 1000);

const base: Observation = {
  type: "OBS",
  time: now,
  lat: 54.5741,
  lon: -1.3182,
  routeType: 1,
  packetType: 5,
  hops: 2,
  hashSize: 2,
  path: ["4e2f", "a1b2"],
  packetHash: "9f3c1d2e",
};

describe("normaliseObservation", () => {
  it("accepts a multibyte relayed path", () => {
    const result = normaliseObservation(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.heardId).toBe("a1b2");
      expect(result.value.lowResolution).toBe(false);
    }
  });

  it("accepts a zero-hop observation", () => {
    const result = normaliseObservation({ ...base, hops: 0, path: [], heardId: undefined });
    expect(result.ok).toBe(true);
  });

  it("rejects a zero-hop with a path", () => {
    const result = normaliseObservation({ ...base, hops: 0 });
    expect(result.ok).toBe(false);
  });

  it("rejects a path length that disagrees with hops", () => {
    const result = normaliseObservation({ ...base, hops: 3 });
    expect(result.ok).toBe(false);
  });

  it("rejects an id whose width disagrees with the hash size", () => {
    const result = normaliseObservation({ ...base, hashSize: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects a heard id that is not the last hop", () => {
    const result = normaliseObservation({ ...base, heardId: "ffff" });
    expect(result.ok).toBe(false);
  });

  it("rejects a direct observation that supplies a heard id", () => {
    const result = normaliseObservation({ ...base, routeType: 2, heardId: "a1b2" });
    expect(result.ok).toBe(false);
  });

  it("rejects a trace observation that supplies a heard id", () => {
    const result = normaliseObservation({ ...base, packetType: 9, heardId: "a1b2" });
    expect(result.ok).toBe(false);
  });

  it("derives no heard id for direct routes", () => {
    const result = normaliseObservation({ ...base, routeType: 2 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.heardId).toBeNull();
      expect(result.value.obs.heardId).toBeUndefined();
    }
  });

  it("derives no heard id for trace packets", () => {
    const result = normaliseObservation({ ...base, packetType: 9 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.heardId).toBeNull();
      expect(result.value.obs.heardId).toBeUndefined();
    }
  });

  it("flags one-byte hashes as low resolution", () => {
    const result = normaliseObservation({
      ...base,
      hashSize: 1,
      path: ["4e", "a1"],
      heardId: "a1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lowResolution).toBe(true);
  });

  it("rejects future and stale timestamps", () => {
    expect(normaliseObservation({ ...base, time: now + 3600 }).ok).toBe(false);
    expect(normaliseObservation({ ...base, time: now - 60 * 60 * 24 * 31 }).ok).toBe(false);
  });
});

describe("dedupeKey", () => {
  it("is stable for the same observation", () => {
    expect(dedupeKey("ben", base, base.lat, base.lon)).toBe(
      dedupeKey("ben", base, base.lat, base.lon),
    );
  });

  it("changes with the user", () => {
    expect(dedupeKey("ben", base, base.lat, base.lon)).not.toBe(
      dedupeKey("other", base, base.lat, base.lon),
    );
  });
});
