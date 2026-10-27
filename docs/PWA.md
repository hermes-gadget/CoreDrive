# PWA

CoreDrive is a phone tool. The web client refuses to run on desktop, because Web Bluetooth and reliable GPS are not available there.

## Flow

1. **Gate** checks for a mobile user agent and a coarse pointer. Desktop sees a QR-sized URL and an explanation.
2. **Login** posts to `/api/v1/auth/login`; the backend verifies the UKMesh MQTT credential with a broker CONNECT and returns a token.
3. **Radio** opens the Web Bluetooth picker filtered to the MeshCore NUS service (`6e400001-...`), subscribes to notifications and sends `CMD_APP_START`.
4. **Listening** parses every `PUSH_CODE_LOG_RX_DATA` frame, attaches the latest GPS fix and writes an observation to IndexedDB.
5. **Upload** flushes 100 observations every five seconds with the bearer token. Failures back off and stay queued.

## Frame parsing

The client reads the header, skips transport codes when present, decodes the path length byte (hop count in bits 0-5, hash size minus one in bits 6-7), and extracts the path. The last path entry is the repeater that delivered the frame; earlier entries are topology.

A frame is dropped when:

- the fix is older than the session or worse than 100 m accuracy;
- the path is truncated;
- the payload is missing.

## Zero transmissions

The only writes to the radio are `CMD_APP_START` (a BLE session announcement) and notification subscription. The client contains no transmit API. A session must leave `tx_air_secs` unchanged on the companion.

## Queue

IndexedDB store `coredrive/observations`. Each item carries `attempts` and `nextAttemptAt`. The queue survives reloads and offline periods. The UI shows frames, queued and sent counts.

## iOS

Safari has no Web Bluetooth. iOS users need Bluefy or a similar Web Bluetooth browser. The gate explains this rather than failing silently.

## Privacy

Exact coordinates stay on the device until upload and are visible only to the account that recorded them. Public maps use the snapped grid cells.
