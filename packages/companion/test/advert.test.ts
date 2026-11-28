import { describe, expect, it } from "vitest";
import { keygenAsync, signAsync } from "@noble/ed25519";
import { parseAdvertData } from "../src/advert.js";
import { parseAdvertPacket, verifyAdvert } from "../src/advertVerify.js";
import { parsePush } from "../src/pushes.js";

function concat(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function int32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function uint32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function buildAppData(name: string): Uint8Array {
  const encoded = new TextEncoder().encode(name);
  const bytes = new Uint8Array(1 + 8 + encoded.length);
  bytes[0] = 0x92; // name + lat/lon, repeater
  bytes.set(int32le(54_574_100), 1);
  bytes.set(int32le(-1_318_200), 5);
  bytes.set(encoded, 9);
  return bytes;
}

async function signedAdvert(name = "Test-RPT", timestamp = 1_700_000_000) {
  const keys = await keygenAsync(new Uint8Array(32).fill(7));
  const appData = buildAppData(name);
  const message = concat(keys.publicKey, uint32le(timestamp), appData);
  const signature = await signAsync(message, keys.secretKey);
  const payload = concat(keys.publicKey, uint32le(timestamp), signature, appData);
  return { payload, keys, appData };
}

describe("advert verification", () => {
  it("parses the signed envelope and the advert data", async () => {
    const { payload, keys } = await signedAdvert();
    const parsed = parseAdvertPacket(payload);

    expect(parsed?.pubkey).toHaveLength(64);
    expect(parsed?.pubkey).toBe(
      Array.from(keys.publicKey, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
    expect(parsed?.timestamp).toBe(1_700_000_000);
    expect(parsed?.data?.type).toBe(2);
    expect(parsed?.data?.name).toBe("Test-RPT");
    expect(parsed?.data?.lat).toBeCloseTo(54.5741, 5);
    expect(parsed?.data?.lon).toBeCloseTo(-1.3182, 5);
  });

  it("verifies a genuine advert", async () => {
    const { payload } = await signedAdvert();
    const result = await verifyAdvert(payload);

    expect(result?.verified).toBe(true);
    expect(result?.error).toBeNull();
  });

  it("rejects a tampered app data byte", async () => {
    const { payload } = await signedAdvert();
    const tampered = payload.slice();
    tampered[1 + 32 + 4 + 64] = 0x00; // first app-data byte: flags

    const result = await verifyAdvert(tampered);
    expect(result?.verified).toBe(false);
    expect(result?.error).toBe("signature mismatch");
  });

  it("rejects a truncated payload without throwing", async () => {
    const { payload } = await signedAdvert();
    expect(parseAdvertPacket(payload.subarray(0, 40))).toBeNull();
    expect(await verifyAdvert(payload.subarray(0, 40))).toBeNull();
  });

  it("does not throw on random frames", async () => {
    let seed = 0x1234_5678;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff;
      return (seed >>> 16) & 0xff;
    };

    for (let length = 0; length < 200; length += 1) {
      const frame = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) frame[index] = random();

      expect(() => parseAdvertPacket(frame)).not.toThrow();
      expect(() => parsePush(frame)).not.toThrow();
      expect(() => parseAdvertData(frame)).not.toThrow();
    }
  });
});
