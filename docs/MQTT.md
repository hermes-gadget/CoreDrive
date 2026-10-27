# MQTT contract

CoreDrive publishes every accepted observation to the UKMesh broker. One message per observation.

## Topics

| Topic | Retain | QoS | Payload |
|---|---|---|---|
| `wardrive/<username>/packets` | no | 1 | observation envelope |
| `wardrive/<username>/status` | yes | 1 | last seen, session, counters (planned) |
| `wardrive/<username>/sessions` | no | 1 | start and end events (planned) |

The producer uses the service identity `wardrive-svc`, which is limited to `readwrite wardrive/#`. It cannot read mesh traffic or publish to `meshcore/#`.

## Envelope

```json
{
  "v": 1,
  "kind": "observation",
  "id": "bf0dcbeb-811e-4622-b653-7fbf07c498a6",
  "username": "testuser",
  "sessionId": "8ba8792e-ef93-47ef-9c45-4bee77c3289d",
  "source": "pwa",
  "receivedAt": "2026-10-27T02:21:35.129Z",
  "dedupeKey": "f6070f8bb34dd11e883784e80002627b36e89e5a099d925039e9289866f09497",
  "obs": {
    "type": "OBS",
    "time": 1793067693,
    "lat": 54.5741,
    "lon": -1.3182,
    "accuracyM": 8,
    "snr": 9.75,
    "rssi": -96,
    "routeType": 1,
    "packetType": 5,
    "hops": 2,
    "hashSize": 2,
    "path": ["4e2f", "a1b2"],
    "heardId": "a1b2",
    "packetHash": "9f3c1d2e",
    "payloadLen": 48
  }
}
```

## Semantics

- `hops = 0` means a zero-hop transmission: the sender was in direct range and nothing relayed it.
- `hops > 0` means the packet was relayed. `heardId` is the last path entry, the repeater that delivered the packet to the receiver. Earlier entries are the relay chain, not reception evidence.
- `hashSize` is the path hash width in bytes. The live UK mesh uses 2, so ids are four hex characters. A value of 1 produces ambiguous ids and is flagged in the database.
- `dedupeKey` is the idempotency key. The consumer upserts on it, so replaying a batch never duplicates observations.

## Consumption

```bash
mosquitto_sub -h mqtt.ukmesh.com -p 443 --tls --cafile /etc/ssl/certs/ca-certificates.crt \
  -u <user> -P <password> -t 'wardrive/#' -v
```

Consumers must tolerate duplicate deliveries. Use `id` or `dedupeKey` to deduplicate.
