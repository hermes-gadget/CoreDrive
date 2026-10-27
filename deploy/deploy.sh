#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "missing deploy/.env" >&2
  exit 1
fi

docker compose --env-file .env build
docker compose --env-file .env run --rm api node apps/api/dist/db/migrate.js
docker compose --env-file .env up -d --remove-orphans
docker compose --env-file .env ps

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3011/healthz >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:3011/healthz
curl -fsS http://127.0.0.1:3011/api/v1/healthz
