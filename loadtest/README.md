# Load test

`k6.js` runs 50 virtual users, each posting one observation every five seconds for 120 iterations. That is 6,000 requests over ten minutes.

## Prepare staging

Create 50 users and API keys. Store the keys in `loadtest/keys.json` as a JSON array. Do not commit that file.

```sql
INSERT INTO users (username, last_seen)
VALUES ('loadtest-01', now()), ...;

INSERT INTO api_keys (id, user_id, key_hash, key_prefix, label)
SELECT gen_random_uuid(), id, encode(sha256('wdk_load_...'::bytea), 'hex'), 'wdk_load_...', 'loadtest'
  FROM users WHERE username = 'loadtest-01';
```

The prefix and hash must come from the same key. Generate them with a short script, not by hand.

## Run

```bash
BASE=https://wardrive.nemesh.uk \
KEYS_FILE=./keys.json \
k6 run loadtest/k6.js
```

Override `VUS`, `ITERATIONS`, `SLEEP_SECONDS`, or `MAX_DURATION` for a shorter run.

## Clean up

```sql
DELETE FROM ingest_outbox WHERE username LIKE 'loadtest-%';
DELETE FROM users WHERE username LIKE 'loadtest-%';
```

Users cascade to sessions, observations and API keys.

## Pass criteria

- `http_req_failed < 1%`
- `checks > 99%`
- `http_req_duration p(95) < 150 ms`
