import { randomUUID } from "node:crypto";
import mqtt from "mqtt";
import { config } from "../config.js";

export function verifyMqttCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const client = mqtt.connect(config.MQTT_VERIFY_URL, {
      username,
      password,
      reconnectPeriod: 0,
      connectTimeout: 5000,
      clean: true,
      clientId: `coredrive-verify-${randomUUID()}`,
    });

    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        client.end(true);
      } catch {
        // ignore teardown errors
      }
      resolve(ok);
    };

    timer = setTimeout(() => finish(false), 6000);
    client.once("connect", () => finish(true));
    client.once("error", () => finish(false));
  });
}
