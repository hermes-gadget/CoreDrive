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

backup_dir="${HOME}/backups/coredrive"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="${backup_dir}/coredrive-${stamp}.dump"

docker compose exec -T db pg_dump \
  -U "${POSTGRES_USER:-coredrive}" \
  -d "${POSTGRES_DB:-coredrive}" \
  -Fc > "$file"

chmod 600 "$file"
find "$backup_dir" -type f -name 'coredrive-*.dump' -mtime +30 -delete

echo "wrote ${file}"
