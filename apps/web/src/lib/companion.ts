import {
  buildAppStart,
  buildDeviceQuery,
  buildGetStats,
  buildRunCli,
  RESP_CODE_CLI_REPLY,
  RESP_CODE_DEVICE_INFO,
  RESP_CODE_SELF_INFO,
  RESP_CODE_STATS,
  STATS_TYPE_PACKETS,
  STATS_TYPE_RADIO,
  parseCliReply,
  parseDeviceInfo,
  parsePush,
  parseSelfInfo,
  parseStats,
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

  constructor(private readonly transport: Transport) {
    transport.onData((frame) => this.handleFrame(frame));
  }

  onPush(handler: (push: PushMessage) => void): void {
    this.pushHandler = handler;
  }

  private handleFrame(frame: Uint8Array): void {
    if (frame.length === 0) return;
    const code = frame[0]!;
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

  disconnect(): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Radio disconnected"));
    }
    this.pending.clear();
    this.pushHandler = null;
  }
}
