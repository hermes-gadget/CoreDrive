export interface ParsedFrame {
  header: number;
  routeType: number;
  payloadType: number;
  hops: number;
  hashSize: number;
  path: string[];
  heardId: string | null;
  payloadLen: number;
  payloadOffset: number;
}

// Packet::header layout, from MeshCore Packet.h
const PH_ROUTE_MASK = 0x03;
const PH_TYPE_SHIFT = 2;
const PH_TYPE_MASK = 0x0f;
const PH_VER_SHIFT = 6;
const PH_VER_MASK = 0x03;

const ROUTE_TYPE_TRANSPORT_FLOOD = 0x00;
const ROUTE_TYPE_FLOOD = 0x01;
const ROUTE_TYPE_TRANSPORT_DIRECT = 0x03;

const PAYLOAD_TYPE_TRACE = 0x09;
const PAYLOAD_VER_1 = 0x00;
const MAX_PATH_SIZE = 64;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The companion packs RSSI into an int8. Readings below -128 wrap into the
 * positive range, so recover the negative dBm value from the whole byte.
 */
export function decodeRssi(byte: number): number {
  const signed = (byte << 24) >> 24;
  return signed > 0 ? signed - 256 : signed;
}

/**
 * Mirror of MeshCore Packet::isValidPathLen: hash size 4 is reserved, and the
 * encoded path may never exceed MAX_PATH_SIZE bytes.
 */
function isValidPathLen(hashCount: number, hashSize: number): boolean {
  if (hashSize === 4) return false;
  return hashCount * hashSize <= MAX_PATH_SIZE;
}

export function parseFrame(raw: Uint8Array): ParsedFrame | null {
  if (raw.length < 3) return null;

  const header = raw[0]!;
  const version = (header >> PH_VER_SHIFT) & PH_VER_MASK;
  if (version !== PAYLOAD_VER_1) return null;

  const routeType = header & PH_ROUTE_MASK;
  const payloadType = (header >> PH_TYPE_SHIFT) & PH_TYPE_MASK;

  let offset = 1;
  if (routeType === ROUTE_TYPE_TRANSPORT_FLOOD || routeType === ROUTE_TYPE_TRANSPORT_DIRECT) offset += 4;
  if (raw.length <= offset) return null;

  const pathLength = raw[offset++]!;
  const hops = pathLength & 0x3f;
  const hashSize = ((pathLength >> 6) & 0x03) + 1;
  if (!isValidPathLen(hops, hashSize)) return null;

  const pathBytes = hops * hashSize;
  if (raw.length < offset + pathBytes) return null;

  const payloadLen = raw.length - offset - pathBytes;
  if (payloadLen <= 0) return null;

  const path: string[] = [];
  for (let hop = 0; hop < hops; hop += 1) {
    const start = offset + hop * hashSize;
    path.push(hex(raw.subarray(start, start + hashSize)));
  }

  // Only flood routes build up a path of repeaters, so only their final entry
  // identifies the repeater that heard us. Direct routes carry the remaining
  // destination hops, and TRACE payloads carry per-hop SNR data instead.
  const isFlood = routeType === ROUTE_TYPE_TRANSPORT_FLOOD || routeType === ROUTE_TYPE_FLOOD;
  const heardId = isFlood && payloadType !== PAYLOAD_TYPE_TRACE ? (path.at(-1) ?? null) : null;

  return {
    header,
    routeType,
    payloadType,
    hops,
    hashSize,
    path,
    heardId,
    payloadLen,
    payloadOffset: offset + pathBytes,
  };
}

/**
 * MeshCore Packet::calculatePacketHash: SHA-256 over the payload-type byte,
 * then (TRACE only) the two-byte little-endian path_len, then the payload.
 * Only the first 8 bytes of the digest are used.
 */
export async function packetHash(raw: Uint8Array, parsed: ParsedFrame): Promise<string> {
  const trace = parsed.payloadType === PAYLOAD_TYPE_TRACE;
  const pathLen = ((parsed.hashSize - 1) << 6) | (parsed.hops & 0x3f);
  const prefix = trace
    ? [parsed.payloadType, pathLen & 0xff, (pathLen >> 8) & 0xff]
    : [parsed.payloadType];

  const material = new Uint8Array(prefix.length + parsed.payloadLen);
  material.set(prefix);
  material.set(raw.subarray(parsed.payloadOffset, parsed.payloadOffset + parsed.payloadLen), prefix.length);

  const digest = await crypto.subtle.digest("SHA-256", material.buffer as ArrayBuffer);
  return hex(new Uint8Array(digest)).slice(0, 16);
}

export function hexFrame(raw: Uint8Array): string {
  return hex(raw).slice(0, 600);
}
