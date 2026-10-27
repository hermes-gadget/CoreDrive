# Architecture

CoreDrive is a small, independent system. It shares two things with UKMesh: the MQTT broker as transport, and broker credentials as the login check. It shares no code, database or deployment with the UKMesh analytics backend.

## Components

| Component | Responsibility |
|---|---|
| `web` | Static PWA, nginx, `/api` proxy, OSM tile cache |
| `api` | Auth, validation, quotas, ingest outbox, read API |
| `publisher` | Drains the outbox to MQTT |
| `ingest` | Subscribes to `wardrive/#`, writes observations to the database |
| `db` | PostgreSQL 16 with TimescaleDB, own volume |

## Data flow

1. The PWA logs in against UKMesh MQTT credentials (a broker CONNECT check; no password is stored).
2. The phone connects to a MeshCore companion over BLE and receives every frame the radio demodulates.
3. The app parses the frame: route type, payload type, hop count, hash size and path.
4. Observations are queued in IndexedDB, batched, and posted to `/api/v1/ingest`.
5. The API validates and writes an outbox row per observation.
6. The publisher sends one MQTT message per observation to `wardrive/<username>/packets`.
7. The ingest worker consumes the topic and upserts into `observations`.
8. Read APIs serve the map and per-user history from the database.

The database is the source of truth; MQTT is the distribution mirror. The outbox keeps uploads durable when the broker is unavailable.

## Passive-only invariant

No component sends radio traffic. The client never imports a transmit API, and a CI check scans the bundle for transmit symbols. This is a product invariant, not a setting.

## Coverage model

An observation records where the phone was, what it heard, and the path that packet travelled. The last path hop is the repeater that was heard; earlier hops are topology. Passive data describes audibility, not whether the user can transmit into the mesh.

## Public data

Public APIs return snapped grid cells, never raw coordinates or continuous tracks. Exact observations are available only to the account that recorded them.
