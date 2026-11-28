# Companion protocol reference

The client speaks the MeshCore companion BLE protocol. Everything here is
read-only: CoreDrive never sends a radio transmission. The allowlist in
`packages/companion/src/constants.ts` is enforced by `isAllowedCommand` and
checked again against the shipped bundle by `scripts/check-no-tx.mjs`.

Pinned reference firmware: `MeshCore-MQTT` at
`7f0d6d97542b3311f09c98d4627c429756a87a64`
(`src/SerialBLEInterface.cpp`, `src/MyMesh.cpp`, `src/Mesh.cpp`,
`src/Packet.h`, `src/helpers/AdvertDataHelpers.*`). Re-verify the offsets
below whenever that pin moves.

## BLE

| Item | Value |
|---|---|
| Service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| Write (app → radio) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| Notify (radio → app) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |
| Maximum frame | 176 bytes |

Commands are one byte plus arguments. Responses start with a response code;
push codes start at `0x80`. The client only needs one request in flight at a
time, keyed by the expected response code.

## Passive commands

`CMD_APP_START` (1), `CMD_GET_CONTACTS` (4), `CMD_GET_DEVICE_TIME` (5),
`CMD_GET_BATT_AND_STORAGE` (20), `CMD_DEVICE_QUERY` (22),
`CMD_GET_CONTACT_BY_KEY` (30), `CMD_GET_CHANNEL` (31),
`CMD_GET_CUSTOM_VARS` (40), `CMD_GET_ADVERT_PATH` (42),
`CMD_GET_TUNING_PARAMS` (43), `CMD_GET_STATS` (56),
`CMD_GET_AUTOADD_CONFIG` (59), `CMD_GET_ALLOWED_REPEAT_FREQ` (60),
`CMD_GET_DEFAULT_FLOOD_SCOPE` (64), `CMD_RUN_CLI_COMMAND` (66).

`CMD_SEND_RAW_PACKET` (65) is deliberately absent. `CMD_RUN_CLI_COMMAND` is
restricted to `get …`, `stats …`, `ver`, `version` and `help`.

## Packet header

`Packet::header` is the first byte of a raw RX frame:

- bits 0–1: route type (`0` transport flood, `1` flood, `2` direct,
  `3` transport direct)
- bits 2–5: payload type (`4` advert, `9` trace)
- bits 6–7: payload version (must be `0`)

Transport routes carry a 4-byte transport code before the path length. The
path-length byte is `(hashSize - 1) << 6 | hops`; hash size 4 is reserved.
Paths are at most 64 bytes. For flood routes the final path entry is the
repeater that heard us; trace payloads carry per-hop SNRs instead.

Packet hash, used for deduplication: SHA-256 over the payload-type byte, then
(for trace only) the two-byte little-endian path length, then the payload;
the first 8 bytes of the digest are stored.

## Adverts

`PAYLOAD_TYPE_ADVERT` payload:

```
pub_key[32] | timestamp[4, uint32 LE] | signature[64] | app_data[1..]
```

The Ed25519 signature covers `pub_key || timestamp_le || app_data`. The
timestamp is the sender's RTC in seconds. `app_data` is:

```
flags | [int32 LE lat, int32 LE lon] | [uint16 LE feat1] | [uint16 LE feat2] | UTF-8 name
```

Flags: bits 0–3 node type (1 chat, 2 repeater, 3 room, 4 sensor), `0x10`
lat/lon present, `0x20` feat1, `0x40` feat2, `0x80` name present. Zero
coordinates and out-of-range values are treated as no position. Invalid
signatures are recorded, not used to reject the packet: the advert is still
mapped and flagged.

## Stats

`CMD_GET_STATS` takes a type byte:

- `0` core: battery millivolts at offset 2, uptime seconds at 4, error flags
  at 8, queue length at 10
- `1` radio: noise floor at 2, last RSSI at 4, last SNR at 5 (int8 × 4),
  tx air seconds at 6 (uint32 LE), rx air seconds at 10 (uint32 LE)
- `2` packets: seven uint32 LE counters from offset 2 (received, sent,
  sent flood, sent direct, received flood, received direct, receive errors)

`RESP_CODE_SELF_INFO` (5) carries the device name, public key prefix, radio
frequency and bandwidth from offset 2. `RESP_CODE_DEVICE_INFO` (13) carries
firmware version and model.

## Fixtures and tests

`packages/companion/test/` builds a signed advert from a deterministic
keypair, verifies it, tampers one byte and expects rejection, and feeds 200
random frames through the parsers to prove malformed input cannot throw.
Keep a fixture per push/response code when adding decoders.
