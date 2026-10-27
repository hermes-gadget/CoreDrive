import { describe, expect, it } from "vitest";
import { decodeRssi, packetHash, parseFrame } from "../src/lib/frame.js";

function frame(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

describe("parseFrame", () => {
  it("parses a two-byte path", () => {
    const result = parseFrame(frame([0x15, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]));
    expect(result).toMatchObject({
      routeType: 1,
      payloadType: 5,
      hops: 2,
      hashSize: 2,
      path: ["4e2f", "a1b2"],
      heardId: "a1b2",
      payloadLen: 3,
      payloadOffset: 6,
    });
  });

  it("skips transport codes", () => {
    const result = parseFrame(frame([0x00, 1, 2, 3, 4, 0x41, 0x4e, 0x2f, 9]));
    expect(result).toMatchObject({ routeType: 0, hops: 1, hashSize: 2, path: ["4e2f"] });
  });

  it("parses a zero-hop packet", () => {
    const result = parseFrame(frame([0x0a, 0x00, 7, 8]));
    expect(result).toMatchObject({ hops: 0, path: [], heardId: null, payloadLen: 2 });
  });

  it("does not attribute a heard id on a direct route", () => {
    const result = parseFrame(frame([0x16, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]));
    expect(result).toMatchObject({ routeType: 2, hops: 2, path: ["4e2f", "a1b2"], heardId: null });
  });

  it("does not attribute a heard id on a trace packet", () => {
    const result = parseFrame(frame([0x25, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 0x11, 0x22, 0x33]));
    expect(result).toMatchObject({ payloadType: 9, hops: 2, path: ["4e2f", "a1b2"], heardId: null });
  });

  it("rejects an unsupported payload version", () => {
    // version 1, payload type 5, flood route
    expect(parseFrame(frame([0x55, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]))).toBeNull();
    expect(parseFrame(frame([0x95, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]))).toBeNull();
  });

  it("rejects the reserved four-byte hash size", () => {
    // hash size 4, one hop
    expect(parseFrame(frame([0x15, 0xc1, 1, 2, 3, 4, 9]))).toBeNull();
  });

  it("rejects a frame with no payload", () => {
    expect(parseFrame(frame([0x15, 0x42, 0x4e, 0x2f, 0xa1, 0xb2]))).toBeNull();
  });

  it("accepts a 64-byte path and rejects anything longer", () => {
    const exact = new Uint8Array(2 + 64 + 1);
    exact[0] = 0x15;
    exact[1] = 0x60; // 32 hops x 2 bytes = 64
    exact.fill(0xab, 2, 66);
    exact[66] = 0x01;
    expect(parseFrame(exact)).toMatchObject({ hops: 32, hashSize: 2, payloadLen: 1 });

    const oversized = new Uint8Array(2 + 66 + 1);
    oversized[0] = 0x15;
    oversized[1] = 0x61; // 33 hops x 2 bytes = 66
    oversized.fill(0xab, 2, 68);
    oversized[68] = 0x01;
    expect(parseFrame(oversized)).toBeNull();
  });

  it("rejects a truncated path", () => {
    expect(parseFrame(frame([0x15, 0x42, 0x4e]))).toBeNull();
  });

  it("rejects a frame shorter than the header", () => {
    expect(parseFrame(frame([0x15]))).toBeNull();
  });

  it("never throws on hostile input", () => {
    for (let length = 0; length < 48; length += 1) {
      const bytes = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) bytes[index] = (index * 37 + length) & 0xff;
      expect(() => parseFrame(bytes)).not.toThrow();
    }
  });
});

describe("decodeRssi", () => {
  it("recovers wrapped weak readings", () => {
    expect(decodeRssi(0x7e)).toBe(-130);
    expect(decodeRssi(0x80)).toBe(-128);
    expect(decodeRssi(0x9c)).toBe(-100);
  });
});

describe("packetHash", () => {
  it("hashes the payload type and payload", async () => {
    const raw = frame([0x15, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]);
    const parsed = parseFrame(raw);
    expect(parsed).not.toBeNull();
    await expect(packetHash(raw, parsed!)).resolves.toBe("9cde9054b5b1b34d");
  });

  it("adds the two-byte little-endian path length for trace packets", async () => {
    const raw = frame([0x25, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 0x11, 0x22, 0x33]);
    const parsed = parseFrame(raw);
    expect(parsed).not.toBeNull();
    await expect(packetHash(raw, parsed!)).resolves.toBe("00e5f13f91927abb");
  });
});
