import {
  buildAppStart,
  buildDeviceQuery,
  buildGetContacts,
  buildGetStats,
  buildRunCli,
  RESP_CODE_CLI_REPLY,
  RESP_CODE_CONTACT,
  RESP_CODE_DEVICE_INFO,
  RESP_CODE_END_OF_CONTACTS,
  RESP_CODE_ERR,
  RESP_CODE_SELF_INFO,
  RESP_CODE_STATS,
  STATS_TYPE_PACKETS,
  STATS_TYPE_RADIO,
  parseCliReply,
  parseContactPush,
  parseDeviceInfo,
  parsePush,
  parseSelfInfo,
  parseStats,
  type ContactPush,
  type DeviceInfo,
  type PacketStats,
  type PushMessage,
  type RadioStats,
  type SelfInfo,
} from "@coredrive/companion";
import type { Transport } from "./transport.js";

interface Pending {
  resolve: (frame: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export class CompanionClient {
  private readonly pending = new Map<number, Pending>();
  private pushHandler: ((push: PushMessage) => void) | null = null;
  private contactSink: ((frame: Uint8Array) => void) | null = null;

  constructor(private readonly transport: Transport) {
    transport.onData((frame) => this.handleFrame(frame));
  }

  onPush(handler: (push: PushMessage) => void): void {
    this.pushHandler = handler;
  }

  private handleFrame(frame: Uint8Array): void {
    if (frame.length === 0) return;
    const code = frame[0]!;
    if (
      this.contactSink &&
      (code === RESP_CODE_CONTACT || code === RESP_CODE_END_OF_CONTACTS || code === RESP_CODE_ERR)
    ) {
      this.contactSink(frame);
      return;
    }
    const waiter = this.pending.get(code);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.pending.delete(code);
      waiter.resolve(frame);
      return;
    }
    const push = parsePush(frame);
    if (push) this.pushHandler?.(push);
  }

  private request(expected: number, frame: Uint8Array, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
    if (this.pending.has(expected)) {
      return Promise.reject(new Error(`A ${expected} request is already in flight`));
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(expected);
        reject(new Error(`Radio did not answer request ${expected}`));
      }, timeoutMs);
      this.pending.set(expected, { resolve, reject, timer });
      void this.transport.write(frame).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(expected);
        reject(error instanceof Error ? error : new Error("Radio write failed"));
      });
    });
  }

  async start(name = "coredrive"): Promise<SelfInfo> {
    const frame = await this.request(RESP_CODE_SELF_INFO, buildAppStart(name));
    const info = parseSelfInfo(frame);
    if (!info) throw new Error("Radio returned an unreadable self description");
    return info;
  }

  async radioStats(): Promise<RadioStats> {
    const frame = await this.request(RESP_CODE_STATS, buildGetStats(STATS_TYPE_RADIO));
    const stats = parseStats(frame);
    if (!stats || stats.kind !== "radio") throw new Error("Radio does not report radio stats");
    return stats;
  }

  async packetStats(): Promise<PacketStats> {
    const frame = await this.request(RESP_CODE_STATS, buildGetStats(STATS_TYPE_PACKETS));
    const stats = parseStats(frame);
    if (!stats || stats.kind !== "packets") throw new Error("Radio does not report packet stats");
    return stats;
  }

  async deviceInfo(): Promise<DeviceInfo> {
    const frame = await this.request(RESP_CODE_DEVICE_INFO, buildDeviceQuery());
    const info = parseDeviceInfo(frame);
    if (!info) throw new Error("Radio returned an unreadable device description");
    return info;
  }

  async runCli(command: string): Promise<string> {
    const frame = await this.request(RESP_CODE_CLI_REPLY, buildRunCli(command));
    return parseCliReply(frame) ?? "";
  }

  /**
   * Read the radio's contact list. The response is a streamed list rather than
   * one frame: contacts (code 3) until end-of-contacts (code 4). This gives the
   * map a named repeater set before a single advert is heard.
   */
  async contacts(since?: number, timeoutMs = 8_000): Promise<ContactPush[]> {
    if (this.contactSink) throw new Error("A contact sync is already in flight");

    return new Promise<ContactPush[]>((resolve, reject) => {
      const collected: ContactPush[] = [];
      const finish = (error?: Error) => {
        clearTimeout(timer);
        this.contactSink = null;
        if (error) reject(error);
        else resolve(collected);
      };
      const timer = setTimeout(
        () => finish(new Error("Radio did not finish the contact list")),
        timeoutMs,
      );

      this.contactSink = (frame) => {
        const code = frame[0]!;
        if (code === RESP_CODE_CONTACT) {
          const contact = parseContactPush(frame);
          if (contact) collected.push(contact);
          return;
        }
        if (code === RESP_CODE_END_OF_CONTACTS) {
          finish();
          return;
        }
        if (code === RESP_CODE_ERR) finish(new Error("Radio rejected the contact request"));
      };

      void this.transport.write(buildGetContacts(since)).catch((error) => {
        finish(error instanceof Error ? error : new Error("Radio write failed"));
      });
    });
  }

  disconnect(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Radio disconnected"));
    }
    this.pending.clear();
    this.contactSink = null;
    this.pushHandler = null;
  }
}
