import { describe, expect, it } from "vitest";
import {
  buildAppStart,
  buildGetContacts,
  buildGetStats,
  buildRunCli,
} from "../src/commands.js";
import { isAllowedCommand } from "../src/constants.js";
import { parseAdvertData } from "../src/advert.js";
import { decodeRssi, packetHash, parseFrame } from "../src/frame.js";
import {
  parseCliReply,
  parseContactPush,
  parseDeviceInfo,
  parsePush,
  parseSelfInfo,
  parseStats,
  parseTracePush,
} from "../src/pushes.js";

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < Math.min(text.length, length); i += 1) out[i] = text.charCodeAt(i);
  return out;
}

function uint32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function int32(value: number): number[] {
  return uint32(value >>> 0);
}

describe("frame parsing", () => {
  it("parses a two-byte path", () => {
    const result = parseFrame(bytes([0x15, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]));
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

  it("does not attribute a heard id on a direct route or a trace", () => {
    expect(parseFrame(bytes([0x16, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]))?.heardId).toBeNull();
    expect(parseFrame(bytes([0x25, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 0x11, 0x22, 0x33]))?.heardId).toBeNull();
  });

  it("rejects a reserved hash size and a missing payload", () => {
    expect(parseFrame(bytes([0x15, 0xc1, 1, 2, 3, 4, 9]))).toBeNull();
    expect(parseFrame(bytes([0x15, 0x42, 0x4e, 0x2f, 0xa1, 0xb2]))).toBeNull();
  });

  it("hashes payload material to 16 hex characters", async () => {
    const raw = bytes([0x15, 0x42, 0x4e, 0x2f, 0xa1, 0xb2, 1, 2, 3]);
    const parsed = parseFrame(raw)!;
    await expect(packetHash(raw, parsed)).resolves.toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("rssi", () => {
  it("recovers negative dBm from an int8", () => {
    expect(decodeRssi(0xa0)).toBe(-96);
    expect(decodeRssi(0xff)).toBe(-1);
  });
});

describe("advert data", () => {
  it("decodes a repeater with a name and location", () => {
    const lat = 54_574_100;
    const lon = -1_318_200;
    const frame = bytes([0x92, ...int32(lat), ...int32(lon), ...ascii("RPT-1", 5)]);
    expect(parseAdvertData(frame)).toMatchObject({
      type: 2,
      hasLocation: true,
      lat: 54.5741,
      lon: -1.3182,
      name: "RPT-1",
    });
  });

  it("decodes a name-only advert", () => {
    expect(parseAdvertData(bytes([0x81, ...ascii("BEN", 3)]))).toMatchObject({
      type: 1,
      hasLocation: false,
      name: "BEN",
    });
  });

  it("rejects an out-of-range position", () => {
    const frame = bytes([0x12, ...int32(91_000_000), ...int32(0)]);
    expect(parseAdvertData(frame)?.hasLocation).toBe(false);
  });
});

describe("push frames", () => {
  it("decodes an RX push", () => {
    const push = parsePush(bytes([0x88, 39, 0xa0, 0x15, 0x42, 1, 2, 3]));
    expect(push).toMatchObject({ kind: "rx", snr: 9.75, rssi: -96 });
    if (push?.kind === "rx") expect(Array.from(push.frame)).toEqual([0x15, 0x42, 1, 2, 3]);
  });

  it("decodes a new-advert contact push", () => {
    const pubkey = new Array<number>(32).fill(0xab);
    const frame = bytes([
      0x8a,
      ...pubkey,
      2, // repeater
      0,
      0, // out path len
      ...new Array<number>(64).fill(0),
      ...ascii("Gateshead", 32),
      ...uint32(1700000000),
      ...int32(54_955_000),
      ...int32(-1_610_000),
      ...uint32(1700000100),
    ]);
    expect(parseContactPush(frame)).toMatchObject({
      kind: "contact",
      pubkey: "ab".repeat(32),
      nodeType: 2,
      name: "Gateshead",
      lat: 54.955,
      lon: -1.61,
      lastAdvert: 1700000000,
    });
  });

  it("decodes a trace push with per-hop SNRs", () => {
    const frame = bytes([
      0x89,
      0,
      4, // 2 hops x 2-byte hashes
      1, // path size 2
      ...uint32(1234),
      ...uint32(5678),
      0x4e, 0x2f, 0xa1, 0xb2,
      39, 20, // 9.75 dB, 5 dB
      12, // 3 dB final
    ]);
    expect(parseTracePush(frame)).toMatchObject({
      kind: "trace",
      tag: 1234,
      authCode: 5678,
      pathSize: 2,
      path: ["4e2f", "a1b2"],
      snrs: [9.75, 5],
      finalSnr: 3,
    });
  });

  it("returns unknown for unhandled push codes", () => {
    expect(parsePush(bytes([0x8e, 1, 2]))).toEqual({ kind: "unknown", code: 0x8e });
  });
});

describe("responses", () => {
  it("decodes radio stats", () => {
    const frame = bytes([24, 1, 0x92, 0xff, 0xa0, 39, ...uint32(100), ...uint32(200)]);
    expect(parseStats(frame)).toEqual({
      kind: "radio",
      noiseFloorDbm: -110,
      lastRssi: -96,
      lastSnr: 9.75,
      txAirSecs: 100,
      rxAirSecs: 200,
    });
  });

  it("decodes packet stats", () => {
    const values = [1, 2, 3, 4, 5, 6, 7].flatMap(uint32);
    expect(parseStats(bytes([24, 2, ...values]))).toMatchObject({
      kind: "packets",
      recv: 1,
      sent: 2,
      recvErrors: 7,
    });
  });

  it("decodes self info including radio config", () => {
    const frame = bytes([
      5, 1, 20, 30,
      ...new Array<number>(32).fill(0xcd),
      ...int32(54_574_100),
      ...int32(-1_318_200),
      0, 1, 0, 0,
      ...uint32(869_618),
      ...uint32(62_500),
      11, 5,
      ...ascii("T-Deck", 6),
    ]);
    expect(parseSelfInfo(frame)).toMatchObject({
      kind: "self",
      pubkey: "cd".repeat(32),
      freqMhz: 869.618,
      bandwidthKhz: 62.5,
      spreadingFactor: 11,
      codingRate: 5,
      name: "T-Deck",
    });
  });

  it("decodes device info and CLI replies", () => {
    const frame = bytes([
      13, 14, 50, 8,
      1, 2, 3, 4,
      ...ascii("2026-11-27", 12),
      ...ascii("LilyGo", 40),
      ...ascii("v1.17.1", 20),
    ]);
    expect(parseDeviceInfo(frame)).toMatchObject({
      kind: "device",
      maxContacts: 100,
      manufacturer: "LilyGo",
      firmwareVersion: "v1.17.1",
    });
    expect(parseCliReply(bytes([29, ...ascii("> 869.618,62.5,11,5", 22)]))).toBe(
      "> 869.618,62.5,11,5",
    );
  });
});

describe("command allowlist", () => {
  it("permits passive queries", () => {
    expect(isAllowedCommand(buildGetStats(1))).toEqual({ ok: true });
    expect(isAllowedCommand(buildGetContacts())).toEqual({ ok: true });
    expect(isAllowedCommand(buildAppStart("coredrive"))).toEqual({ ok: true });
    expect(isAllowedCommand(buildRunCli("get radio"))).toEqual({ ok: true });
  });

  it("refuses transmit and configuration commands", () => {
    expect(isAllowedCommand(bytes([65, 1, 2, 3])).ok).toBe(false);
    expect(() => buildRunCli("set radio 869.618,62.5,11,5")).toThrow(/read-only/);
    expect(() => buildRunCli("advert")).toThrow(/read-only/);
    expect(() => buildRunCli("reboot")).toThrow(/read-only/);
  });
});
