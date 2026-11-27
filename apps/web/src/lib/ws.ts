import type { Transport } from "./transport.js";

/**
 * Development transport for the fake companion. It is only reachable when the
 * page is opened with ?transport=ws&bench, so a production build cannot
 * accidentally record synthetic frames.
 */
export class WebSocketTransport implements Transport {
  private socket: WebSocket | null = null;
  private dataHandler: ((frame: Uint8Array) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private reconnectHandler: (() => void) | null = null;

  constructor(private readonly url: string) {}

  get name(): string {
    return "Simulated companion";
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  onData(handler: (frame: Uint8Array) => void): void {
    this.dataHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  onReconnect(handler: () => void): void {
    this.reconnectHandler = handler;
  }

  onReconnectFailed(_handler: () => void): void {
    // The fake companion has no link to lose.
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error(`Could not open ${this.url}`));
      socket.onclose = () => this.disconnectHandler?.();
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.dataHandler?.(new Uint8Array(event.data));
        }
      };
      this.socket = socket;
    });
  }

  async write(frame: Uint8Array): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Simulated companion is not connected");
    }
    this.socket.send(frame.slice().buffer);
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.dataHandler = null;
    this.disconnectHandler = null;
    this.reconnectHandler = null;
    try {
      socket?.close();
    } catch {
      // already closed
    }
  }

  /** The fake companion never drops the socket, so there is nothing to resume. */
  reconnect(): void {
    this.reconnectHandler?.();
  }
}
