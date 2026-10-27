# Privacy

CoreDrive logs what a MeshCore radio hears and where the phone was when it heard it. That is location data, so the defaults are conservative.

## What is collected

- UKMesh MQTT username (the account identity)
- Device model and radio configuration
- GPS position, accuracy, and timestamp at the moment a packet was received
- Radio metadata: SNR, RSSI, route type, packet type, hop count and path

## What is not collected

- Message contents, contacts, or other users' locations
- Any data from the phone beyond location and the radio connection
- Advertising or analytics identifiers

## What is public

The public map shows grid cells of roughly 250 metres, with timestamps bucketed to five minutes. It never shows a continuous track or an exact position.

Signed-in users can see their own exact observations.

## Retention and deletion

Raw observations are kept for 180 days. Aggregated cells are kept indefinitely. An account can delete its raw data from the account page; the deletion is recorded in an audit log.

## Accounts

There is no signup. CoreDrive uses existing UKMesh MQTT credentials and stores no passwords.

## Contact

Open an issue for privacy questions that do not involve a vulnerability. Security reports go through the private advisory flow in [SECURITY.md](../SECURITY.md).
