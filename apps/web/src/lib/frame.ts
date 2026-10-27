export interface ParsedFrame {
  header: number;
  routeType: number;
  payloadType: number;
  hops: number;
  hashSize: number;
  path: string[];
  heardId: string | null;
  payloadLen: number;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseFrame(raw: Uint8Array): ParsedFrame | null {
  if (raw.length < 3) return null;

  const header = raw[0]!;
  const routeType = header & 0x03;
  const payloadType = (header >> 2) & 0x0f;

  let offset = 1;
  if (routeType === 0 || routeType === 3) offset += 4;
  if (raw.length <= offset) return null;

  const pathLength = raw[offset++]!;
  const hops = pathLength & 0x3f;
  const hashSize = ((pathLength >> 6) & 0x03) + 1;
  const pathBytes = hops * hashSize;

  if (raw.length < offset + pathBytes) return null;

  const path: string[] = [];
  for (let hop = 0; hop < hops; hop += 1) {
    const start = offset + hop * hashSize;
    path.push(hex(raw.subarray(start, start + hashSize)));
  }

  return {
    header,
    routeType,
    payloadType,
    hops,
    hashSize,
    path,
    heardId: path.at(-1) ?? null,
    payloadLen: raw.length - offset - pathBytes,
  };
}

export async function packetHash(raw: Uint8Array): Promise<string> {
  const copy = new Uint8Array(raw.byteLength);
  copy.set(raw);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return hex(new Uint8Array(digest)).slice(0, 32);
}

export function hexFrame(raw: Uint8Array): string {
  return hex(raw).slice(0, 600);
}
