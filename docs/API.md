# API

Base URL: `https://wardrive.nemesh.uk/api/v1`.

## Authentication

Two schemes:

- `Authorization: Bearer <token>` from `POST /auth/login`.
- `X-API-Key: wdk_...` for third-party clients, created on the account page.

Login verifies the supplied username and password with a broker CONNECT against the UKMesh MQTT broker. Passwords are never stored. Accounts are existing UKMesh MQTT identities; there is no signup.

```bash
curl -sS -X POST https://wardrive.nemesh.uk/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"ben","password":"..."}'
```

```json
{"token":"eyJ...","expiresAt":"2026-11-26T02:00:00.000Z","user":{"username":"ben"}}
```

## Ingest

`POST /ingest` accepts one to 200 observations.

```bash
curl -sS -X POST https://wardrive.nemesh.uk/api/v1/ingest \
  -H 'content-type: application/json' \
  -H 'x-api-key: wdk_...' \
  --data-binary @batch.json
```

```json
{
  "session": {"client":"pwa","appVersion":"0.1.0","device":"T-Deck","radioFreq":"869.618,62.5,8,5"},
  "data": [{
    "type": "OBS", "time": 1793067693, "lat": 54.5741, "lon": -1.3182,
    "accuracyM": 8, "snr": 9.75, "rssi": -96,
    "routeType": 1, "packetType": 5, "hops": 2, "hashSize": 2,
    "path": ["4e2f","a1b2"], "heardId": "a1b2",
    "packetHash": "9f3c1d2e", "payloadLen": 48
  }]
}
```

The server recomputes the heard id from the path and rejects items where the hop count, hash width or heard id disagree. A batch returns `202`:

```json
{"accepted":1,"rejected":0,"duplicates":0,"sessionId":"8ba8792e-ef93-47ef-9c45-4bee77c3289d","errors":[]}
```

Per-item validation failures are counted in `rejected` and listed in `errors`; they do not fail the whole batch.

## Account

| Method | Path | Purpose |
|---|---|---|
| GET | `/me` | username and counts |
| GET | `/me/sessions` | recent sessions |
| GET | `/me/observations` | own observations, exact coordinates |
| GET | `/me/keys` | active API keys (prefix only) |
| POST | `/me/keys` | create a key; the secret is returned once |
| DELETE | `/me/keys/:id` | revoke a key |

## Errors

```json
{"error":{"code":"invalid_payload","message":"...","details":[]}}
```

Codes: `unauthorized`, `invalid_credentials`, `suspended`, `forbidden`, `invalid_payload`, `rate_limited`, `unavailable`, `internal`.

Login is limited to 10 attempts per IP per 15 minutes. Ingest is limited to 30 requests per minute per identity.
