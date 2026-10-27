# Load test — 2026-10-27

**Target:** `https://wardrive.nemesh.uk`
**Code:** `f023b59` (metrics #25, backups #26/#27)
**Shape:** 50 virtual users, one observation every 5 seconds, 120 iterations each.

## Result: pass

| Measure | Value |
|---|---|
| Requests | 6,000 |
| Failed requests | 0 (0.00 %) |
| `checks` | 6,000 / 6,000 |
| k6 p95 latency | 61.8 ms |
| k6 p99 latency | 135.3 ms |
| k6 maximum | 276.3 ms |
| Prometheus server p95 (`/api/v1/ingest`) | 42 ms |
| Outbox pending during the run | 0 |
| Observations per minute | ~550 |

Thresholds in `loadtest/k6.js`: failed requests below 1 %, checks above 99 %, p95 below 150 ms. All passed; k6 exited 0.

## Side effects

The test created 50 `loadtest-*` users, 6,002 outbox rows and 6,000 observations. All were removed after the run:

```sql
DELETE FROM ingest_outbox WHERE username LIKE 'loadtest-%';
DELETE FROM users WHERE username LIKE 'loadtest-%';
```

`users` cascades to sessions, observations and API keys. Staging returned to zero observations.

## Repeat

See `loadtest/README.md`. Generate keys per user, keep `keys.json` out of git, and clean up with the same two statements.
