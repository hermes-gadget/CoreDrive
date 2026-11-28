#!/usr/bin/env node
/**
 * Zero-transmission invariant.
 *
 * CoreDrive must never transmit on the radio. The client may only send local
 * BLE queries, and those are allowlisted in @coredrive/companion. This scan
 * fails the build if a transmit symbol ever reaches the shipped bundle.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = process.argv[2] ?? "apps/web/dist";
const BANNED = [
  "CMD_SEND_RAW_PACKET",
  "CMD_SEND_TXT_MSG",
  "CMD_SEND_CHANNEL_TXT_MSG",
  "CMD_SEND_CHANNEL_DATA",
  "sendText(",
  "sendChannelText(",
  "sendPacket(",
  "sendSelfAdvertisement(",
  "startTransmit(",
  ".transmit(",
];

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...walk(path));
    else if (entry.endsWith(".js")) files.push(path);
  }
  return files;
}

const files = walk(DIST);
const hits = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const symbol of BANNED) {
    if (source.includes(symbol)) hits.push(`${file}: ${symbol}`);
  }
}

if (hits.length > 0) {
  console.error("zero-TX scan FAILED: transmit symbols found in the bundle");
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.log(`zero-TX scan: clean (${files.length} bundles, 0 transmit symbols)`);
