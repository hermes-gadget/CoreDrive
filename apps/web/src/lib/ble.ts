import { RX_UUID, SERVICE_UUID, TX_UUID } from "@coredrive/companion";
import type { Transport } from "./transport.js";

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

export class BluetoothTransport implements Transport {
  private device: BluetoothDevice | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private dataHandler: ((frame: Uint8Array) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private reconnectHandler: (() => void) | null = null;
  private reconnectFailedHandler: (() => void) | null = null;
  private reconnecting = false;
  private stopping = false;

  private readonly handleGattDisconnected = (): void => {
    if (this.stopping) return;
    this.disconnectHandler?.();
    void this.reconnect();
  };

  private readonly handleFrameValue = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (value) this.dataHandler?.(new Uint8Array(value.buffer));
  };

  get name(): string {
    return this.device?.name ?? "MeshCore companion";
  }

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
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

  onReconnectFailed(handler: () => void): void {
    this.reconnectFailedHandler = handler;
  }

  async connect(options: { allDevices?: boolean } = {}): Promise<void> {
    const bluetooth = navigator.bluetooth;
    if (!bluetooth) {
      throw new Error(
        "Web Bluetooth is not available here. Open this page in Chrome on Android over HTTPS. Safari and in-app browsers do not support it.",
      );
    }

    let device: BluetoothDevice;
    try {
      device = options.allDevices
        ? await bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [SERVICE_UUID],
          })
        : await bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }],
          });
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        throw new Error(
          "No radio selected. Turn on Bluetooth and Location, close the MeshCore app, then try again or show all Bluetooth devices.",
        );
      }
      throw error;
    }

    this.stopping = false;
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleGattDisconnected);

    try {
      await this.attach(device);
    } catch (error) {
      // Never leave a half-open GATT link or live listeners behind: the caller
      // discards this instance and must not keep a radio still connected.
      this.disconnect();
      throw error;
    }
  }

  private async attach(device: BluetoothDevice): Promise<void> {
    const server = await device.gatt?.connect();
    if (!server) throw new Error("Could not connect to the radio");

    let service: BluetoothRemoteGATTService;
    try {
      service = await server.getPrimaryService(SERVICE_UUID);
    } catch {
      throw new Error(
        "That device does not expose the MeshCore companion service. Check that it is running companion firmware, not repeater firmware.",
      );
    }

    const characteristics = await service.getCharacteristics();
    const rx = characteristics.find((c) => c.uuid === RX_UUID) ?? null;
    const tx = characteristics.find((c) => c.uuid === TX_UUID) ?? null;
    if (!rx || !tx) throw new Error("Companion service is missing characteristics");

    // Reconnects replace the characteristic objects; drop the old listener so
    // a recovered link never delivers every frame twice.
    if (this.tx) this.tx.removeEventListener("characteristicvaluechanged", this.handleFrameValue);

    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", this.handleFrameValue);
    this.rx = rx;
    this.tx = tx;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.stopping || !this.device) return;
    this.reconnecting = true;
    try {
      for (const delay of RECONNECT_DELAYS_MS) {
        if (this.stopping) return;
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          await this.attach(this.device);
          this.reconnectHandler?.();
          return;
        } catch {
          // try the next delay
        }
      }
      this.reconnectFailedHandler?.();
    } finally {
      this.reconnecting = false;
    }
  }

  async write(frame: Uint8Array): Promise<void> {
    if (!this.rx) throw new Error("Radio is not connected");
    await this.rx.writeValue(frame.slice().buffer);
  }

  disconnect(): void {
    this.stopping = true;
    this.device?.removeEventListener("gattserverdisconnected", this.handleGattDisconnected);
    this.tx?.removeEventListener("characteristicvaluechanged", this.handleFrameValue);
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // already gone
    }
    this.device = null;
    this.rx = null;
    this.tx = null;
    this.dataHandler = null;
    this.disconnectHandler = null;
    this.reconnectHandler = null;
    this.reconnectFailedHandler = null;
  }
}
