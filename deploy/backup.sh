#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "missing deploy/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

backup_dir="${BACKUP_DIR:-${HOME}/backups/coredrive}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="${backup_dir}/coredrive-${stamp}.dump"
tmp="${file}.partial"
trap 'rm -f "$tmp"' EXIT

compose_args=(-f docker-compose.yml)
if [[ "${DEPLOY_MODE:-staging}" == "staging" && -f docker-compose.staging.yml ]]; then
  compose_args+=(-f docker-compose.staging.yml)
fi

docker compose "${compose_args[@]}" --env-file .env exec -T db pg_dump \
  -U "${POSTGRES_USER:-coredrive}" \
  -d "${POSTGRES_DB:-coredrive}" \
  -Fc > "$tmp"

test -s "$tmp"
mv "$tmp" "$file"
chmod 600 "$file"
sha256sum "$file" > "${file}.sha256"
chmod 600 "${file}.sha256"

find "$backup_dir" -type f \( -name 'coredrive-*.dump' -o -name 'coredrive-*.dump.sha256' \) -mtime +30 -delete

echo "wrote ${file}"
