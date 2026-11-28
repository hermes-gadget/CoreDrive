import { verifyAsync } from "@noble/ed25519";
import { parseAdvertData, type AdvertData } from "./advert.js";
import { PUB_KEY_SIZE } from "./constants.js";
import { hex } from "./frame.js";

const TIMESTAMP_SIZE = 4;
const SIGNATURE_SIZE = 64;

export interface ParsedAdvert {
  /** Full Ed25519 public key; the canonical identity of the sender. */
  pubkey: string;
  /** MeshCore RTC seconds, little-endian in the packet. */
  timestamp: number;
  appData: Uint8Array;
  data: AdvertData | null;
}

export interface VerifiedAdvert extends ParsedAdvert {
  verified: boolean;
  error: string | null;
}

/**
 * Decode a PAYLOAD_TYPE_ADVERT payload:
 *   pub_key[32] || timestamp[4 LE] || signature[64] || app_data[1..]
 *
 * The signature covers pub_key || timestamp || app_data, exactly as
 * Mesh::createAdvert does. App data is parsed even when the signature is bad,
 * so a forged advert can be shown and flagged rather than silently dropped.
 */
export function parseAdvertPacket(payload: Uint8Array): ParsedAdvert | null {
  if (payload.length < PUB_KEY_SIZE + TIMESTAMP_SIZE + SIGNATURE_SIZE + 1) return null;

  const pubkey = payload.subarray(0, PUB_KEY_SIZE);
  const timestampView = new DataView(
    payload.buffer,
    payload.byteOffset + PUB_KEY_SIZE,
    TIMESTAMP_SIZE,
  );
  const timestamp = timestampView.getUint32(0, true);
  const appData = payload.subarray(PUB_KEY_SIZE + TIMESTAMP_SIZE + SIGNATURE_SIZE);

  return {
    pubkey: hex(pubkey),
    timestamp,
    appData,
    data: parseAdvertData(appData),
  };
}

export async function verifyAdvert(payload: Uint8Array): Promise<VerifiedAdvert | null> {
  const parsed = parseAdvertPacket(payload);
  if (!parsed) return null;

  const signature = payload.subarray(
    PUB_KEY_SIZE + TIMESTAMP_SIZE,
    PUB_KEY_SIZE + TIMESTAMP_SIZE + SIGNATURE_SIZE,
  );
  const message = new Uint8Array(PUB_KEY_SIZE + TIMESTAMP_SIZE + parsed.appData.length);
  message.set(payload.subarray(0, PUB_KEY_SIZE + TIMESTAMP_SIZE));
  message.set(parsed.appData, PUB_KEY_SIZE + TIMESTAMP_SIZE);

  try {
    const verified = await verifyAsync(signature, message, payload.subarray(0, PUB_KEY_SIZE));
    return {
      ...parsed,
      verified,
      error: verified ? null : "signature mismatch",
    };
  } catch (error) {
    return {
      ...parsed,
      verified: false,
      error: error instanceof Error ? error.message : "invalid signature",
    };
  }
}
