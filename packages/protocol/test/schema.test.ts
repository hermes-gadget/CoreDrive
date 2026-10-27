import { describe, expect, it } from "vitest";
import { ingestRequestSchema, observationSchema, gridId, gridCenter } from "../src/index.js";

const base = {
  type: "OBS" as const,
  time: 1768762843,
  lat: 54.5741,
  lon: -1.3182,
  routeType: 1,
  packetType: 5,
  hops: 2,
  hashSize: 2,
  path: ["4e2f", "a1b2"],
  heardId: "a1b2",
  packetHash: "9f3c1d2e",
};

describe("observation schema", () => {
  it("accepts a multibyte path", () => {
    expect(observationSchema.parse(base)).toMatchObject({ hops: 2, hashSize: 2 });
  });

  it("rejects an out-of-range latitude", () => {
    expect(() => observationSchema.parse({ ...base, lat: 91 })).toThrow();
  });

  it("rejects a bad path id", () => {
    expect(() => observationSchema.parse({ ...base, path: ["zz"] })).toThrow();
  });

  it("requires at least one observation per batch", () => {
    expect(() => ingestRequestSchema.parse({ data: [] })).toThrow();
  });

  it("caps a batch at 200", () => {
    const data = Array.from({ length: 201 }, () => base);
    expect(() => ingestRequestSchema.parse({ data })).toThrow();
  });
});

describe("grid", () => {
  it("round-trips a cell centre", () => {
    const id = gridId(54.5741, -1.3182);
    const centre = gridCenter(id);
    expect(gridId(centre.lat, centre.lon)).toBe(id);
    expect(Math.abs(centre.lat - 54.5741)).toBeLessThan(0.003);
    expect(Math.abs(centre.lon + 1.3182)).toBeLessThan(0.005);
  });
});
