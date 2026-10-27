# CoreDrive

Passive coverage logging for MeshCore. Your phone connects to a companion radio over Bluetooth, records every packet the radio hears, and publishes the observations to an MQTT feed. The map answers one question: what can the radio hear here?

**Status:** scaffold. The staging shell is up; the ingest API, database and PWA are being built. Nothing in this repository transmits.

## What it does

- Listens only. No pings, no discovery requests, no adverts, no radio settings changes.
- Records GPS, SNR/RSSI, hop count and the multi-byte path for every received frame.
- Treats the last path hop as the repeater that was heard; earlier hops are kept as topology.
- Publishes one observation per message on `wardrive/<username>/packets`.
- Stores its own copy in its own PostgreSQL/Timescale database.

## What it does not do

- It does not measure whether you can transmit into the mesh. Passive data is audibility, not TX coverage.
- It is not a MeshMapper replacement, fork or scraper.
- It does not transmit. Ever.

## Planned stack

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

Setup lands with the first code pull request. Until then this repository holds the project scaffold only.

## Privacy

Public maps show snapped grid cells, not tracks. Exact coordinates are visible only to the account that recorded them. Raw observations are retained for 180 days. Accounts are existing UKMesh MQTT identities; there is no signup.

## Licence

MIT. See [LICENSE](LICENSE).
