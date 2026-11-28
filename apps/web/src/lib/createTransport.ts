import { BluetoothTransport } from "./ble.js";
import { WebSocketTransport } from "./ws.js";
import type { Transport } from "./transport.js";

export function createTransport(): Transport {
  const params = new URLSearchParams(window.location.search);
  if (params.get("transport") === "ws") {
    if (!import.meta.env.DEV && !params.has("bench")) {
      throw new Error("The simulated radio is only available in development");
    }
    const url = params.get("url") ?? "ws://127.0.0.1:8787";
    return new WebSocketTransport(url);
  }
  return new BluetoothTransport();
}
