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

  it("is stable when heardId is omitted versus uppercase after normalisation", () => {
    const omitted = normaliseObservation({ ...base, heardId: undefined });
    const uppercase = normaliseObservation({ ...base, heardId: "A1B2" });
    expect(omitted.ok).toBe(true);
    expect(uppercase.ok).toBe(true);
    if (!omitted.ok || !uppercase.ok) return;

    const fromOmitted = dedupeKey(
      "ben",
      omitted.value.obs,
      omitted.value.obs.lat,
      omitted.value.obs.lon,
    );
    const fromUppercase = dedupeKey(
      "ben",
      uppercase.value.obs,
      uppercase.value.obs.lat,
      uppercase.value.obs.lon,
    );

    expect(fromOmitted).toBe(fromUppercase);

    // Hashing the unnormalised input is what used to split these into two keys.
    expect(dedupeKey("ben", { ...base, heardId: "A1B2" }, base.lat, base.lon)).not.toBe(
      fromOmitted,
    );
  });
});
