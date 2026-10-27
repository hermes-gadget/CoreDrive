# CoreDrive

Passive coverage logging for MeshCore. Your phone connects to a companion radio over Bluetooth, records every packet the radio hears, and publishes the observations to an MQTT feed. The map answers one question: what can the radio hear here?

**Status:** live at https://wardrive.nemesh.uk. Passive only. The PWA, ingest API, publisher, map and privacy page are deployed; the feed and login use the production UKMesh broker.

## What it does

- Listens only. No pings, no discovery requests, no adverts, no radio settings changes.
- Records GPS, SNR/RSSI, hop count and the multi-byte path for every received frame.
- Treats the last path hop as the repeater that was heard; earlier hops are kept as topology.
- Publishes one observation per message on `wardrive/<username>/packets`.
- Stores its own copy in its own PostgreSQL/Timescale database.
- Shows a public map of snapped grid cells and a private exact view for the account that recorded it.

## What it does not do

- It does not measure whether you can transmit into the mesh. Passive data is audibility, not TX coverage.
- It is not a MeshMapper replacement, fork or scraper.
- It does not transmit. Ever.

## Stack

- API: TypeScript, Fastify, zod
- Data: PostgreSQL 16 + TimescaleDB
- Feed: MQTT 5
- Client: React + Vite PWA, Web Bluetooth, vendored MIT companion client
- Deploy: Docker Compose

## Repository layout

```
apps/api        HTTP API and auth
apps/publisher  outbox to MQTT
apps/ingest     MQTT to database
apps/web        phone PWA
packages/       shared protocol schemas
db/             migrations
deploy/         compose, nginx, deploy script
```

## Development

```bash
npm install
cp .env.example deploy/.env        # set a real POSTGRES_PASSWORD
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d db
npm run build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm api node apps/api/dist/db/migrate.js
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
curl -sS http://127.0.0.1:3011/api/v1/healthz
```

Checks: `npm run typecheck`, `npm test`, `npm run build`.

The API runs on port 3000 inside the compose network; nginx serves the static shell and proxies `/api/`, `/readyz` and the authenticated `/metrics` endpoint.

## Privacy

Public maps show snapped grid cells, not tracks. Exact coordinates are visible only to the account that recorded them. Raw observations are retained for 180 days. Accounts are existing UKMesh MQTT identities; there is no signup. The public policy is at https://wardrive.nemesh.uk/privacy.

## Licence

MIT. See [LICENSE](LICENSE).
