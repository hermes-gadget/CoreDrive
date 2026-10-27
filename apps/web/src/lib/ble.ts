const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

const CMD_APP_START = 0x01;

export class CompanionConnection {
  private device: BluetoothDevice | null = null;
  private rx: BluetoothRemoteGATTCharacteristic | null = null;
  private tx: BluetoothRemoteGATTCharacteristic | null = null;
  private frameHandler: ((frame: Uint8Array) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;

  private readonly handleGattDisconnected = (): void => {
    this.disconnectHandler?.();
  };

  private readonly handleFrameValue = (event: Event): void => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (value) this.frameHandler?.(new Uint8Array(value.buffer));
  };

  get name(): string {
    return this.device?.name ?? "MeshCore companion";
  }

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  onFrame(handler: (frame: Uint8Array) => void): void {
    this.frameHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
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

    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleGattDisconnected);

    try {
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
      this.rx = characteristics.find((c) => c.uuid === RX_UUID) ?? null;
      this.tx = characteristics.find((c) => c.uuid === TX_UUID) ?? null;

      if (!this.rx || !this.tx) throw new Error("Companion service is missing characteristics");

      await this.tx.startNotifications();
      this.tx.addEventListener("characteristicvaluechanged", this.handleFrameValue);

      await this.sendAppStart();
    } catch (error) {
      // Never leave a half-open GATT link or live listeners behind: the caller
      // discards this instance and must not keep a radio still connected.
      this.teardown();
      throw error;
    }
  }

  private async sendAppStart(): Promise<void> {
    const name = new TextEncoder().encode("coredrive");
    const frame = new Uint8Array(8 + name.length);
    frame[0] = CMD_APP_START;
    frame[1] = 1;
    frame.set(name, 8);
    await this.rx?.writeValue(frame);
  }

  private teardown(): void {
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
    this.frameHandler = null;
    this.disconnectHandler = null;
  }

  disconnect(): void {
    this.teardown();
  }
}
