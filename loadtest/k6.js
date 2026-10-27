import http from "k6/http";
import { check, sleep } from "k6";

const keys = JSON.parse(open(__ENV.KEYS_FILE || "./keys.json"));

export const options = {
  scenarios: {
    load: {
      executor: "per-vu-iterations",
      vus: Number(__ENV.VUS || 50),
      iterations: Number(__ENV.ITERATIONS || 120),
      maxDuration: __ENV.MAX_DURATION || "12m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<150"],
    checks: ["rate>0.99"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function hex(length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += "0123456789abcdef"[Math.floor(Math.random() * 16)];
  }
  return out;
}

export default function () {
  const key = keys[(__VU - 1) % keys.length];
  const sessionId = `00000000-0000-4000-8000-${String(__VU).padStart(12, "0")}`;
  const path = [hex(4), hex(4)];
  const body = JSON.stringify({
    session: { id: sessionId, client: "pwa", appVersion: "loadtest", device: "k6" },
    data: [
      {
        type: "OBS",
        time: Math.floor(Date.now() / 1000),
        lat: 54.5 + Math.random() * 0.6,
        lon: -1.8 + Math.random() * 0.6,
        accuracyM: 10,
        snr: 6 + Math.random() * 6,
        rssi: -110 + Math.floor(Math.random() * 20),
        routeType: 1,
        packetType: 2,
        hops: 2,
        hashSize: 2,
        path,
        heardId: path[1],
        packetHash: hex(16),
        payloadLen: 24,
      },
    ],
  });

  const response = http.post(`${__ENV.BASE}/api/v1/ingest`, body, {
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
    },
  });

  check(response, {
    accepted: (result) => result.status === 202,
  });
  sleep(Number(__ENV.SLEEP_SECONDS || 5));
}
