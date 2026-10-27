#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "missing deploy/.env" >&2
  exit 1
fi

compose_args=(-f docker-compose.yml)
if [[ -f docker-compose.staging.yml ]]; then
  compose_args+=(-f docker-compose.staging.yml)
fi

docker compose "${compose_args[@]}" --env-file .env build
docker compose "${compose_args[@]}" --env-file .env up -d db
sleep 5
docker compose "${compose_args[@]}" --env-file .env run --rm api node apps/api/dist/db/migrate.js
docker compose "${compose_args[@]}" --env-file .env up -d --remove-orphans
docker compose "${compose_args[@]}" --env-file .env restart web
docker compose "${compose_args[@]}" --env-file .env ps

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3011/api/v1/healthz >/dev/null \
     && curl -fsS http://127.0.0.1:3011/readyz >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:3011/healthz
curl -fsS http://127.0.0.1:3011/api/v1/healthz
curl -fsS http://127.0.0.1:3011/readyz
