# Runbook

## Service map

| Component | Container | Notes |
|---|---|---|
| web | `coredrive-web-1` | nginx, port `127.0.0.1:3011` |
| api | `coredrive-api-1` | Fastify, internal `3000` |
| publisher | `coredrive-publisher-1` | outbox to MQTT |
| ingest | `coredrive-ingest-1` | MQTT to Postgres |
| db | `coredrive-db-1` | Timescale, volume `coredrive_coredrive-db` |
| mqtt | `coredrive-mqtt-1` | staging only; the UKMesh broker is the production target |

Stack root: `/home/ben/coredrive/repo/deploy`.

## Metrics

`GET /metrics` is served by the API and proxied by nginx. It requires `METRICS_TOKEN` from `deploy/.env`:

```bash
curl -fsS https://wardrive.nemesh.uk/metrics \
  -H "Authorization: Bearer $METRICS_TOKEN"
```

If `METRICS_TOKEN` is unset the endpoint returns 404; a wrong token returns 401. Prometheus on `zima` scrapes the public hostname every 30 seconds with a bearer token stored in `/etc/prometheus/coredrive-metrics-token`. Alert rules live at `deploy/prometheus/coredrive.rules.yml`.

Metrics cover HTTP requests and latency, ingest results, login results, active sessions, observations per minute, outbox depth and age, MQTT connection state, publisher and consumer counters, service heartbeats, database availability and database size.

## Deploy

```bash
cd /home/ben/coredrive/repo
git pull --ff-only
bash deploy/deploy.sh
```

The script builds, starts the database, migrates, brings the stack up, restarts nginx so its upstream follows a recreated API container, and checks `/healthz` and `/api/v1/healthz`.

## Rollback

```bash
cd /home/ben/coredrive/repo
git log --oneline -5
git checkout <previous-sha>
bash deploy/deploy.sh
```

Migrations are additive. Do not roll back a migration without a backup.

## Broker down

Symptoms: publisher logs MQTT errors, `coredrive_outbox_pending` grows, uploads still return 202.

1. Confirm the broker is reachable from the API container.
2. Leave the publisher running; it retries every second and republishes after 15 minutes.
3. Check `SELECT count(*) FROM ingest_outbox WHERE delivered_at IS NULL`.
4. When the broker returns, the backlog drains without client involvement.

## Database down

Symptoms: `/readyz` returns 503, ingest returns 503, the PWA queue grows.

1. `docker compose ps db` and `docker compose logs db`.
2. Check disk: `df -h /`.
3. Restart only the database: `docker compose restart db`.
4. Verify `/readyz`.

## Consumer lag

Symptoms: `coredrive_outbox_pending` rises while the publisher is healthy.

1. `docker compose logs ingest`.
2. Check the broker subscription and ACL.
3. Restart ingest; duplicates are idempotent by `dedupe_key`.

## Tunnel failure

Symptoms: the public hostname fails while localhost works.

1. `docker logs cloudflared-nemesh`.
2. Confirm the public hostname points at `http://127.0.0.1:3011`.
3. The tunnel is managed in the Cloudflare dashboard; it is not part of this compose stack.

## Backup and restore

```bash
cd /home/ben/coredrive/repo/deploy
bash backup.sh
```

Restore:

```bash
set -euo pipefail
docker compose stop api publisher ingest
docker compose exec -T db dropdb -U coredrive coredrive
docker compose exec -T db createdb -U coredrive coredrive
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U coredrive -d coredrive -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U coredrive -d coredrive -c "SELECT timescaledb_pre_restore();"
docker compose exec -T db pg_restore -U coredrive -d coredrive --no-owner --exit-on-error < backup.dump
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U coredrive -d coredrive -c "SELECT timescaledb_post_restore();"
docker compose start api publisher ingest
```

`timescaledb_pre_restore()` and `timescaledb_post_restore()` are required when a dump contains hypertables. Do not start writers until `timescaledb_post_restore()` succeeds.

## Abusive user

```sql
UPDATE users SET status = 'suspended' WHERE username = '...';
```

Suspended users fail login and API-key auth. Their existing data remains until deleted.

## Data deletion

`DELETE /api/v1/me/data` removes the caller's observations and sessions and writes an audit row. There is no admin endpoint to delete another user's data yet.

## Known gaps

- The UKMesh broker grant for `wardrive-svc` is not provisioned; staging uses its own Mosquitto.
- No service worker; the app shell is not cached offline, but the observation queue is.
