export interface Transport {
  readonly name: string;
  readonly connected: boolean;
  connect(options?: { allDevices?: boolean }): Promise<void>;
  disconnect(): void;
  write(frame: Uint8Array): Promise<void>;
  onData(handler: (frame: Uint8Array) => void): void;
  onDisconnect(handler: () => void): void;
  onReconnect(handler: () => void): void;
  onReconnectFailed(handler: () => void): void;
}
