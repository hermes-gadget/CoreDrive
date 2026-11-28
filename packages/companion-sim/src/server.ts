import { WebSocketServer, type WebSocket } from "ws";
import {
  CMD_APP_START,
  CMD_DEVICE_QUERY,
  CMD_GET_CONTACTS,
  CMD_GET_STATS,
  CMD_RUN_CLI_COMMAND,
  PUB_KEY_SIZE,
  RESP_CODE_CLI_REPLY,
  RESP_CODE_CONTACT,
  RESP_CODE_CONTACTS_START,
  RESP_CODE_DEVICE_INFO,
  RESP_CODE_END_OF_CONTACTS,
  RESP_CODE_SELF_INFO,
  RESP_CODE_STATS,
  STATS_TYPE_CORE,
  STATS_TYPE_PACKETS,
  STATS_TYPE_RADIO,
} from "@coredrive/companion";

const PORT = Number(process.env.PORT ?? 8787);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 1000);
const QUIET = process.env.QUIET === "1";

interface SimNode {
  pubkey: number[];
  name: string;
  type: number;
  lat: number;
  lon: number;
  pathHash: number[];
}

const NODES: SimNode[] = [
  { pubkey: fill(0x11), name: "Gateshead-RPT", type: 2, lat: 54.955, lon: -1.61, pathHash: [0x4e, 0x2f] },
  { pubkey: fill(0x22), name: "Lordstones-RPT", type: 2, lat: 54.42, lon: -1.18, pathHash: [0xa1, 0xb2] },
  { pubkey: fill(0x33), name: "CODBECK", type: 2, lat: 54.57, lon: -1.32, pathHash: [0x9c, 0x3d] },
];

function fill(value: number): number[] {
  return new Array<number>(PUB_KEY_SIZE).fill(value);
}

function uint32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function int32(value: number): number[] {
  return uint32(value >>> 0);
}

function frame(code: number, body: number[]): Uint8Array {
  return new Uint8Array([code, ...body]);
}

function send(socket: WebSocket, bytes: Uint8Array): void {
  if (socket.readyState === socket.OPEN) socket.send(Buffer.from(bytes));
}

function selfInfo(): Uint8Array {
  return frame(RESP_CODE_SELF_INFO, [
    1, // chat
    20, // tx power
    30, // max tx power
    ...fill(0xaa),
    ...int32(54_574_100),
    ...int32(-1_318_200),
    0, 1, 0, 0,
    ...uint32(869_618),
    ...uint32(62_500),
    11, 5,
    ...ascii("Sim T-Deck", 10),
  ]);
}

function deviceInfo(): Uint8Array {
  return frame(RESP_CODE_DEVICE_INFO, [
    14, 50, 8,
    1, 2, 3, 4,
    ...ascii("2026-11-27", 12),
    ...ascii("LilyGo", 40),
    ...ascii("v1.17.1-sim", 20),
  ]);
}

function ascii(text: string, length: number): number[] {
  const out = new Array<number>(length).fill(0);
  for (let i = 0; i < Math.min(text.length, length); i += 1) out[i] = text.charCodeAt(i);
  return out;
}

function contact(node: SimNode): Uint8Array {
  return frame(RESP_CODE_CONTACT, [
    ...node.pubkey,
    node.type,
    0,
    0,
    ...new Array<number>(64).fill(0),
    ...ascii(node.name, 32),
    ...uint32(Math.floor(Date.now() / 1000) - 60),
    ...int32(node.lat * 1e6),
    ...int32(node.lon * 1e6),
    ...uint32(Math.floor(Date.now() / 1000)),
  ]);
}

function stats(type: number, txAirSecs: number, rxAirSecs: number): Uint8Array {
  if (type === STATS_TYPE_RADIO) {
    return frame(RESP_CODE_STATS, [
      type,
      0x92, 0xff, // noise floor -110
      0xa0, // last rssi -96
      39, // last snr 9.75
      ...uint32(txAirSecs),
      ...uint32(rxAirSecs),
    ]);
  }
  if (type === STATS_TYPE_PACKETS) {
    return frame(RESP_CODE_STATS, [
      type,
      ...uint32(1200), // recv
      ...uint32(0), // sent
      ...uint32(0),
      ...uint32(0),
      ...uint32(900),
      ...uint32(0),
      ...uint32(3),
    ]);
  }
  return frame(RESP_CODE_STATS, [
    type,
    ...uint32(4100), // battery mv
    ...uint32(3600), // uptime
    ...uint32(0), // errors
    0, // queue
  ]);
}

function rxPush(index: number): Uint8Array {
  const node = NODES[index % NODES.length]!;
  const hopBytes = node.pathHash;
  const payload = new Array<number>(12).fill(0).map((_, i) => (index * 7 + i * 13) % 256);
  const snr = 6 + (index % 9);
  const rssi = -120 + snr;
  // header: flood route, group text; path len: 2 hops, 2-byte hashes
  return frame(0x88, [snr * 4, rssi < 0 ? 256 + rssi : rssi, 0x15, 0x42, ...hopBytes, 0xa1, 0xb2, ...payload]);
}

function newAdvertPush(node: SimNode): Uint8Array {
  return frame(0x8a, [
    ...node.pubkey,
    node.type,
    0,
    0,
    ...new Array<number>(64).fill(0),
    ...ascii(node.name, 32),
    ...uint32(Math.floor(Date.now() / 1000)),
    ...int32(node.lat * 1e6),
    ...int32(node.lon * 1e6),
    ...uint32(Math.floor(Date.now() / 1000)),
  ]);
}

const server = new WebSocketServer({ port: PORT });
let txAirSecs = 1000;
let rxAirSecs = 2000;
let frames = 0;

server.on("connection", (socket) => {
  if (!QUIET) console.log("sim: client connected");
  let timer: NodeJS.Timeout | null = null;

  const startStreaming = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      frames += 1;
      send(socket, rxPush(frames));
      rxAirSecs += 1;
      if (frames % 10 === 0) send(socket, newAdvertPush(NODES[frames % NODES.length]!));
      if (frames % 25 === 0) {
        send(
          socket,
          frame(0x89, [
            0,
            4,
            1,
            ...uint32(frames),
            ...uint32(1),
            0x4e, 0x2f, 0xa1, 0xb2,
            32, 16,
            8,
          ]),
        );
      }
    }, INTERVAL_MS);
    timer.unref?.();
  };

  socket.on("message", (data) => {
    const bytes = new Uint8Array(data as Buffer);
    const cmd = bytes[0];
    if (!QUIET) console.log(`sim: command ${cmd}`);
    switch (cmd) {
      case CMD_APP_START:
        send(socket, selfInfo());
        startStreaming();
        break;
      case CMD_DEVICE_QUERY:
        send(socket, deviceInfo());
        break;
      case CMD_GET_STATS:
        send(socket, stats(bytes[1] ?? STATS_TYPE_RADIO, txAirSecs, rxAirSecs));
        break;
      case CMD_GET_CONTACTS:
        send(socket, frame(RESP_CODE_CONTACTS_START, uint32(NODES.length)));
        for (const node of NODES) send(socket, contact(node));
        send(socket, frame(RESP_CODE_END_OF_CONTACTS, []));
        break;
      case CMD_RUN_CLI_COMMAND: {
        const text = new TextDecoder().decode(bytes.subarray(1)).trim();
        const reply = text === "get radio" ? "> 869.618,62.5,11,5" : "Unknown command";
        send(socket, new Uint8Array([RESP_CODE_CLI_REPLY, ...new TextEncoder().encode(reply)]));
        break;
      }
      default:
        // The passive client never sends anything else.
        if (!QUIET) console.log(`sim: ignored command ${cmd}`);
    }
  });

  socket.on("close", () => {
    if (timer) clearInterval(timer);
    if (!QUIET) console.log(`sim: client disconnected after ${frames} frames`);
  });
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

if (!QUIET) console.log(`companion-sim listening on ws://127.0.0.1:${PORT}`);
