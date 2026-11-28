import { describe, expect, it } from "vitest";
import {
  CMD_APP_START,
  CMD_GET_CONTACTS,
  CMD_GET_STATS,
  RESP_CODE_CONTACT,
  RESP_CODE_CONTACTS_START,
  RESP_CODE_END_OF_CONTACTS,
  RESP_CODE_SELF_INFO,
  RESP_CODE_STATS,
  STATS_TYPE_RADIO,
} from "@coredrive/companion";
import { CompanionClient } from "../src/lib/companion.js";
import type { Transport } from "../src/lib/transport.js";

function contactFrame(): Uint8Array {
  const frame = new Uint8Array(148);
  const view = new DataView(frame.buffer);
  let offset = 0;
  frame[offset++] = RESP_CODE_CONTACT;
  frame.fill(0xbb, offset, offset + 32);
  offset += 32;
  frame[offset++] = 2; // node type: repeater
  frame[offset++] = 0; // flags
  frame[offset++] = 2; // out path length
  frame[offset] = 0x4e;
  frame[offset + 1] = 0x2f;
  offset += 64;
  const name = new TextEncoder().encode("Gateshead-RPT");
  frame.set(name, offset);
  offset += 32;
  view.setUint32(offset, 1_700_000_000, true);
  offset += 4;
  view.setInt32(offset, 54_574_100, true);
  offset += 4;
  view.setInt32(offset, -1_318_200, true);
  offset += 4;
  view.setUint32(offset, 1_700_000_000, true);
  return frame;
}

class FakeTransport implements Transport {
  readonly name = "Fake radio";
  connected = true;
  written: Uint8Array[] = [];
  private dataHandler: ((frame: Uint8Array) => void) | null = null;

  onData(handler: (frame: Uint8Array) => void): void {
    this.dataHandler = handler;
  }
  onDisconnect(): void {}
  onReconnect(): void {}
  onReconnectFailed(): void {}
  async connect(): Promise<void> {}
  disconnect(): void {
    this.connected = false;
  }

  async write(frame: Uint8Array): Promise<void> {
    this.written.push(frame);
    queueMicrotask(() => this.respond(frame));
  }

  private respond(frame: Uint8Array): void {
    if (frame[0] === CMD_GET_CONTACTS) {
      this.dataHandler?.(new Uint8Array([RESP_CODE_CONTACTS_START, 0, 0, 0, 1]));
      this.dataHandler?.(contactFrame());
      this.dataHandler?.(new Uint8Array([RESP_CODE_END_OF_CONTACTS]));
    }
    if (frame[0] === CMD_APP_START) {
      this.dataHandler?.(
        new Uint8Array([
          RESP_CODE_SELF_INFO,
          1, 20, 30,
          ...new Array<number>(32).fill(0xaa),
          0x14, 0xbc, 0x40, 0x03,
          0xc8, 0xe2, 0xeb, 0xff,
          0, 1, 0, 0,
          0xf2, 0x44, 0x0d, 0x00,
          0x24, 0xf4, 0x00, 0x00,
          11, 5,
          ...new TextEncoder().encode("Fake"),
        ]),
      );
    }
    if (frame[0] === CMD_GET_STATS && frame[1] === STATS_TYPE_RADIO) {
      this.dataHandler?.(
        new Uint8Array([RESP_CODE_STATS, STATS_TYPE_RADIO, 0x92, 0xff, 0xa0, 39, 100, 0, 0, 0, 200, 0, 0, 0]),
      );
    }
  }
}

describe("CompanionClient", () => {
  it("sends an allowlisted app start and decodes the self description", async () => {
    const transport = new FakeTransport();
    const client = new CompanionClient(transport);
    const info = await client.start("probe");

    expect(transport.written[0]![0]).toBe(CMD_APP_START);
    expect(new TextDecoder().decode(transport.written[0]!.subarray(8))).toBe("probe");
    expect(info.freqMhz).toBeCloseTo(869.618, 3);
    expect(info.bandwidthKhz).toBeCloseTo(62.5, 1);
    expect(info.spreadingFactor).toBe(11);
    expect(info.codingRate).toBe(5);
    expect(info.name).toBe("Fake");
  });

  it("decodes radio stats used for the zero-TX proof", async () => {
    const transport = new FakeTransport();
    const client = new CompanionClient(transport);
    await expect(client.radioStats()).resolves.toMatchObject({
      txAirSecs: 100,
      rxAirSecs: 200,
      noiseFloorDbm: -110,
    });
  });

  it("rejects a second request to the same response code", async () => {
    const transport = new FakeTransport();
    const client = new CompanionClient(transport);
    const first = client.radioStats();
    await expect(client.radioStats()).rejects.toThrow(/already in flight/);
    await first;
  });

  it("reads a streamed contact list", async () => {
    const transport = new FakeTransport();
    const client = new CompanionClient(transport);
    const contacts = await client.contacts();

    expect(transport.written[0]![0]).toBe(CMD_GET_CONTACTS);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      pubkey: "bb".repeat(32),
      nodeType: 2,
      name: "Gateshead-RPT",
    });
    expect(contacts[0]!.lat).toBeCloseTo(54.5741, 5);
    expect(contacts[0]!.lon).toBeCloseTo(-1.3182, 5);
  });
});
