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

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser");
    }

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this.disconnectHandler?.();
    });

    const server = await this.device.gatt?.connect();
    if (!server) throw new Error("Could not connect to the radio");

    const service = await server.getPrimaryService(SERVICE_UUID);
    const characteristics = await service.getCharacteristics();
    this.rx = characteristics.find((c) => c.uuid === RX_UUID) ?? null;
    this.tx = characteristics.find((c) => c.uuid === TX_UUID) ?? null;

    if (!this.rx || !this.tx) throw new Error("Companion service is missing characteristics");

    await this.tx.startNotifications();
    this.tx.addEventListener("characteristicvaluechanged", (event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const value = target.value;
      if (value) this.frameHandler?.(new Uint8Array(value.buffer));
    });

    await this.sendAppStart();
  }

  private async sendAppStart(): Promise<void> {
    const name = new TextEncoder().encode("coredrive");
    const frame = new Uint8Array(8 + name.length);
    frame[0] = CMD_APP_START;
    frame[1] = 1;
    frame.set(name, 8);
    await this.rx?.writeValue(frame);
  }

  disconnect(): void {
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // already gone
    }
    this.device = null;
    this.rx = null;
    this.tx = null;
  }
}
