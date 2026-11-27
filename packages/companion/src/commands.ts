import {
  CMD_APP_START,
  CMD_DEVICE_QUERY,
  CMD_GET_CONTACTS,
  CMD_GET_STATS,
  CMD_RUN_CLI_COMMAND,
  isAllowedCommand,
} from "./constants.js";

function concat(prefix: number[], text: string): Uint8Array {
  const body = new TextEncoder().encode(text);
  const frame = new Uint8Array(prefix.length + body.length);
  frame.set(prefix);
  frame.set(body, prefix.length);
  return frame;
}

function checked(frame: Uint8Array): Uint8Array {
  const result = isAllowedCommand(frame);
  if (!result.ok) throw new Error(result.reason);
  return frame;
}

export function buildAppStart(name: string): Uint8Array {
  return checked(concat([CMD_APP_START, 1, 0, 0, 0, 0, 0, 0], name));
}

export function buildDeviceQuery(protocolVersion = 3): Uint8Array {
  return checked(new Uint8Array([CMD_DEVICE_QUERY, protocolVersion]))
}

export function buildGetStats(type: number): Uint8Array {
  return checked(new Uint8Array([CMD_GET_STATS, type]));
}

export function buildGetContacts(since?: number): Uint8Array {
  if (since === undefined) return checked(new Uint8Array([CMD_GET_CONTACTS]));
  const frame = new Uint8Array(5);
  frame[0] = CMD_GET_CONTACTS;
  new DataView(frame.buffer).setUint32(1, since, true);
  return checked(frame);
}

export function buildRunCli(text: string): Uint8Array {
  return checked(concat([CMD_RUN_CLI_COMMAND], text));
}
