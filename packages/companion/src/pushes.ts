import {
  ADV_TYPE_CHAT,
  PUB_KEY_SIZE,
  RESP_CODE_CLI_REPLY,
  RESP_CODE_CONTACT,
  RESP_CODE_DEVICE_INFO,
  RESP_CODE_SELF_INFO,
  RESP_CODE_STATS,
  STATS_TYPE_CORE,
  STATS_TYPE_PACKETS,
  STATS_TYPE_RADIO,
} from "./constants.js";
import { parseAdvertData, type AdvertData } from "./advert.js";

export interface RxPush {
  kind: "rx";
  snr: number;
  rssi: number;
  frame: Uint8Array;
}

export interface ContactPush {
  kind: "contact";
  code: number;
  pubkey: string;
  nodeType: number;
  flags: number;
  outPathLen: number;
  outPath: string;
  name: string | null;
  lastAdvert: number;
  lat: number | null;
  lon: number | null;
  lastMod: number;
}

export interface AdvertUpdatePush {
  kind: "advertUpdate";
  pubkey: string;
}

export interface TracePush {
  kind: "trace";
  tag: number;
  authCode: number;
  flags: number;
  pathSize: number;
  path: string[];
  snrs: number[];
  finalSnr: number;
}

export interface UnknownPush {
  kind: "unknown";
  code: number;
}

export type PushMessage = RxPush | ContactPush | AdvertUpdatePush | TracePush | UnknownPush;

function int8(value: number): number {
  return (value << 24) >> 24;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const slice = bytes.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return new TextDecoder().decode(end >= 0 ? slice.subarray(0, end) : slice);
}

/** Contact record, as written by MyMesh::writeContactRespFrame. */
export function parseContactPush(frame: Uint8Array): ContactPush | null {
  const minimum = 1 + PUB_KEY_SIZE + 1 + 1 + 1 + 64 + 32 + 4 + 4 + 4 + 4;
  if (frame.length < minimum) return null;

  let offset = 1;
  const pubkey = hex(frame.subarray(offset, offset + PUB_KEY_SIZE));
  offset += PUB_KEY_SIZE;
  const nodeType = frame[offset++]!;
  const flags = frame[offset++]!;
  const outPathLen = frame[offset++]!;
  const outPath = hex(frame.subarray(offset, offset + 64));
  offset += 64;
  const name = readString(frame, offset, 32) || null;
  offset += 32;
  const view = new DataView(frame.buffer, frame.byteOffset + offset);
  const lastAdvert = view.getUint32(0, true);
  const latRaw = view.getInt32(4, true);
  const lonRaw = view.getInt32(8, true);
  const lastMod = view.getUint32(12, true);

  const lat = latRaw / 1e6;
  const lon = lonRaw / 1e6;
  const hasPosition =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0);

  return {
    kind: "contact",
    code: frame[0]!,
    pubkey,
    nodeType,
    flags,
    outPathLen,
    outPath,
    name,
    lastAdvert,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    lastMod,
  };
}

/**
 * TRACE push, as written by MyMesh::onTraceRecv:
 * code, reserved, path_len (bytes), flags, tag, auth_code, path hashes,
 * per-hop SNRs, final SNR. flags bits 0-1 are the path hash size exponent.
 */
export function parseTracePush(frame: Uint8Array): TracePush | null {
  if (frame.length < 12) return null;
  const pathLen = frame[2]!;
  const flags = frame[3]!;
  const pathSize = 1 << (flags & 0x03);
  if (pathSize < 1 || pathSize > 8) return null;
  const hops = pathLen >> (flags & 0x03);
  if (hops < 1 || hops > 64) return null;

  const headerLength = 12;
  const expected = headerLength + pathLen + hops + 1;
  if (frame.length < expected) return null;

  const view = new DataView(frame.buffer, frame.byteOffset + 4);
  const tag = view.getUint32(0, true);
  const authCode = view.getUint32(4, true);

  let offset = headerLength;
  const path: string[] = [];
  for (let hop = 0; hop < hops; hop += 1) {
    path.push(hex(frame.subarray(offset, offset + pathSize)));
    offset += pathSize;
  }

  const snrs: number[] = [];
  for (let hop = 0; hop < hops; hop += 1) {
    snrs.push(int8(frame[offset++]!) / 4);
  }

  return {
    kind: "trace",
    tag,
    authCode,
    flags,
    pathSize,
    path,
    snrs,
    finalSnr: int8(frame[offset]!) / 4,
  };
}

export function parsePush(frame: Uint8Array): PushMessage | null {
  if (frame.length < 2) return null;
  const code = frame[0]!;

  switch (code) {
    case 0x88: {
      if (frame.length < 4) return null;
      return {
        kind: "rx",
        snr: int8(frame[1]!) / 4,
        rssi: int8(frame[2]!) > 0 ? int8(frame[2]!) - 256 : int8(frame[2]!),
        frame: frame.subarray(3),
      };
    }
    case 0x8a:
      return parseContactPush(frame);
    case 0x80: {
      if (frame.length < 1 + PUB_KEY_SIZE) return null;
      return { kind: "advertUpdate", pubkey: hex(frame.subarray(1, 1 + PUB_KEY_SIZE)) };
    }
    case 0x89:
      return parseTracePush(frame);
    default:
      return { kind: "unknown", code };
  }
}

export interface SelfInfo {
  kind: "self";
  advType: number;
  txPowerDbm: number;
  maxTxPowerDbm: number;
  pubkey: string;
  lat: number | null;
  lon: number | null;
  multiAcks: number;
  advertLocPolicy: number;
  telemetryMode: number;
  manualAddContacts: number;
  freqMhz: number;
  bandwidthKhz: number;
  spreadingFactor: number;
  codingRate: number;
  name: string | null;
}

/** Reply to CMD_APP_START, as written by MyMesh::handleCmdFrame. */
export function parseSelfInfo(frame: Uint8Array): SelfInfo | null {
  const fixed = 1 + 1 + 1 + 1 + PUB_KEY_SIZE + 4 + 4 + 1 + 1 + 1 + 1 + 4 + 4 + 1 + 1;
  if (frame.length < fixed) return null;

  let offset = 0;
  const code = frame[offset++]!;
  if (code !== RESP_CODE_SELF_INFO) return null;

  const advType = frame[offset++]!;
  const txPowerDbm = int8(frame[offset++]!);
  const maxTxPowerDbm = int8(frame[offset++]!);
  const pubkey = hex(frame.subarray(offset, offset + PUB_KEY_SIZE));
  offset += PUB_KEY_SIZE;

  const view = new DataView(frame.buffer, frame.byteOffset + offset);
  const lat = view.getInt32(0, true) / 1e6;
  const lon = view.getInt32(4, true) / 1e6;
  offset += 8;

  const multiAcks = frame[offset++]!;
  const advertLocPolicy = frame[offset++]!;
  const telemetryMode = frame[offset++]!;
  const manualAddContacts = frame[offset++]!;

  const freqKhz = new DataView(frame.buffer, frame.byteOffset + offset).getUint32(0, true);
  offset += 4;
  const bwKhz = new DataView(frame.buffer, frame.byteOffset + offset).getUint32(0, true);
  offset += 4;
  const spreadingFactor = frame[offset++]!;
  const codingRate = frame[offset++]!;
  const name = readString(frame, offset, frame.length - offset) || null;

  const hasPosition =
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0);

  return {
    kind: "self",
    advType: advType || ADV_TYPE_CHAT,
    txPowerDbm,
    maxTxPowerDbm,
    pubkey,
    lat: hasPosition ? lat : null,
    lon: hasPosition ? lon : null,
    multiAcks,
    advertLocPolicy,
    telemetryMode,
    manualAddContacts,
    freqMhz: freqKhz / 1000,
    bandwidthKhz: bwKhz / 1000,
    spreadingFactor,
    codingRate,
    name,
  };
}

export interface RadioStats {
  kind: "radio";
  noiseFloorDbm: number;
  lastRssi: number;
  lastSnr: number;
  txAirSecs: number;
  rxAirSecs: number;
}

export interface CoreStats {
  kind: "core";
  batteryMv: number;
  uptimeSecs: number;
  errorFlags: number;
  queueLen: number;
}

export interface PacketStats {
  kind: "packets";
  recv: number;
  sent: number;
  sentFlood: number;
  sentDirect: number;
  recvFlood: number;
  recvDirect: number;
  recvErrors: number;
}

export type Stats = RadioStats | CoreStats | PacketStats;

/** Reply to CMD_GET_STATS (v8+). */
export function parseStats(frame: Uint8Array): Stats | null {
  if (frame.length < 3 || frame[0] !== RESP_CODE_STATS) return null;
  const type = frame[1]!;
  const view = new DataView(frame.buffer, frame.byteOffset + 2);

  if (type === STATS_TYPE_RADIO) {
    if (frame.length < 2 + 2 + 1 + 1 + 4 + 4) return null;
    return {
      kind: "radio",
      noiseFloorDbm: view.getInt16(0, true),
      lastRssi: int8(frame[2 + 2]!),
      lastSnr: int8(frame[2 + 3]!) / 4,
      txAirSecs: view.getUint32(4, true),
      rxAirSecs: view.getUint32(8, true),
    };
  }

  if (type === STATS_TYPE_CORE) {
    if (frame.length < 2 + 2 + 4 + 2 + 1) return null;
    return {
      kind: "core",
      batteryMv: view.getUint16(0, true),
      uptimeSecs: view.getUint32(2, true),
      errorFlags: view.getUint16(6, true),
      queueLen: frame[2 + 8]!,
    };
  }

  if (type === STATS_TYPE_PACKETS) {
    if (frame.length < 2 + 28) return null;
    return {
      kind: "packets",
      recv: view.getUint32(0, true),
      sent: view.getUint32(4, true),
      sentFlood: view.getUint32(8, true),
      sentDirect: view.getUint32(12, true),
      recvFlood: view.getUint32(16, true),
      recvDirect: view.getUint32(20, true),
      recvErrors: view.getUint32(24, true),
    };
  }

  return null;
}

export interface DeviceInfo {
  kind: "device";
  firmwareVersionCode: number;
  maxContacts: number;
  maxChannels: number;
  buildDate: string | null;
  manufacturer: string | null;
  firmwareVersion: string | null;
}

export function parseDeviceInfo(frame: Uint8Array): DeviceInfo | null {
  if (frame.length < 8 || frame[0] !== RESP_CODE_DEVICE_INFO) return null;
  let offset = 4; // code, version, max contacts/2, max channels
  // 4-byte BLE pin follows.
  offset += 4;
  const buildDate = readString(frame, offset, 12) || null;
  offset += 12;
  const manufacturer = readString(frame, offset, 40) || null;
  offset += 40;
  const firmwareVersion = readString(frame, offset, 20) || null;
  return {
    kind: "device",
    firmwareVersionCode: frame[1]!,
    maxContacts: frame[2]! * 2,
    maxChannels: frame[3]!,
    buildDate,
    manufacturer,
    firmwareVersion,
  };
}

export function parseCliReply(frame: Uint8Array): string | null {
  if (frame.length < 2 || frame[0] !== RESP_CODE_CLI_REPLY) return null;
  return readString(frame, 1, frame.length - 1);
}
