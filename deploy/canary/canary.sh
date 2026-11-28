#!/usr/bin/env bash
# End-to-end synthetic wardrive: API -> outbox -> MQTT -> ingest -> database.
# Fails loudly if any leg is broken. Runs every 15 minutes from a user timer.
set -euo pipefail

ENV_FILE="${CANARY_ENV:-/home/ben/coredrive/canary.env}"
# shellcheck disable=SC1090
source "$ENV_FILE"

BASE="${CANARY_BASE:-http://127.0.0.1:3011}"
SESSION="$(cat /proc/sys/kernel/random/uuid)"
HASH="$(openssl rand -hex 8)"
NOW="$(date -u +%s)"
BODY="$(mktemp)"
RESULT="$(mktemp)"
trap 'rm -f "$BODY" "$RESULT"' EXIT

cat >"$BODY" <<JSON
{
  "session": {
    "id": "$SESSION",
    "client": "canary",
    "appVersion": "0.1.0",
    "device": "synthetic",
    "radioFreq": "869.618,62.5,11,5"
  },
  "data": [
    {
      "type": "OBS",
      "time": $NOW,
      "lat": 54.5741,
      "lon": -1.3182,
      "accuracyM": 8,
      "snr": 9.75,
      "rssi": -96,
      "routeType": 1,
      "packetType": 5,
      "hops": 2,
      "hashSize": 2,
      "path": ["4e2f", "a1b2"],
      "heardId": "a1b2",
      "packetHash": "$HASH",
      "payloadLen": 12
    }
  ]
}
JSON

curl -fsS --max-time 10 -X POST "$BASE/api/v1/ingest" \
  -H 'content-type: application/json' \
  -H "x-api-key: $CANARY_KEY" \
  --data-binary @"$BODY" >"$RESULT"

grep -q '"accepted":1' "$RESULT" || {
  echo "canary: ingest did not accept the observation: $(cat "$RESULT")" >&2
  exit 1
}

# The observation must survive the MQTT round trip and be readable by its owner.
# Capture the body first: piping curl into grep -q lets grep close the pipe
# early, and pipefail would then report a false failure.
FOUND=0
for _ in $(seq 1 10); do
  OBSERVATIONS="$(curl -fsS --max-time 10 "$BASE/api/v1/me/observations?limit=20" \
    -H "x-api-key: $CANARY_KEY" || true)"
  if printf '%s' "$OBSERVATIONS" | grep -q "$SESSION"; then
    FOUND=1
    break
  fi
  sleep 2
done

if [[ "$FOUND" != "1" ]]; then
  echo "canary: observation did not reach the database" >&2
  exit 1
fi

docker exec coredrive-db-1 psql -U coredrive -d coredrive -q -c \
  "INSERT INTO service_status (service, updated_at, mqtt_connected)
   VALUES ('canary', now(), true)
   ON CONFLICT (service) DO UPDATE SET updated_at = now(), mqtt_connected = true;"

curl -fsS --max-time 10 -X DELETE "$BASE/api/v1/me/data" \
  -H "x-api-key: $CANARY_KEY" >/dev/null

echo "canary: ok"
