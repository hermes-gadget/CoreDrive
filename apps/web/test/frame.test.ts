import { describe, expect, it } from "vitest";
import { parseFrame } from "../src/lib/frame.js";

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

  it("rejects a truncated path", () => {
    expect(parseFrame(frame([0x15, 0x42, 0x4e]))).toBeNull();
  });

  it("rejects a frame shorter than the header", () => {
    expect(parseFrame(frame([0x15]))).toBeNull();
  });
});
