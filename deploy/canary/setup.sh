#!/usr/bin/env bash
# Create the synthetic canary account and its API key. Run once on the host.
set -euo pipefail

ENV_FILE="${CANARY_ENV:-/home/ben/coredrive/canary.env}"
if [[ -f "$ENV_FILE" ]]; then
  echo "canary env already exists at $ENV_FILE"
  exit 0
fi

KEY="wdk_$(openssl rand -hex 32)"
umask 077
printf 'CANARY_KEY=%s\nCANARY_BASE=http://127.0.0.1:3011\n' "$KEY" > "$ENV_FILE"

docker exec -i coredrive-db-1 psql -U coredrive -d coredrive -v ON_ERROR_STOP=1 -v key="$KEY" <<'SQL'
INSERT INTO users (username) VALUES ('__canary__')
ON CONFLICT (username) DO NOTHING;

INSERT INTO api_keys (user_id, key_hash, key_prefix, label)
SELECT id, encode(digest(:'key', 'sha256'), 'hex'), left(:'key', 12), 'synthetic canary'
  FROM users
 WHERE username = '__canary__'
ON CONFLICT (key_hash) DO NOTHING;

INSERT INTO service_status (service, updated_at, mqtt_connected)
VALUES ('canary', now(), true)
ON CONFLICT (service) DO UPDATE SET updated_at = now(), mqtt_connected = true;
SQL

echo "canary account created; key stored in $ENV_FILE"
