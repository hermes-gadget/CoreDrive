import { ADV_LATLON_MASK, ADV_NAME_MASK, ADV_TYPE_NONE } from "./constants.js";

export interface AdvertData {
  type: number;
  hasLocation: boolean;
  lat: number | null;
  lon: number | null;
  name: string | null;
  flags: number;
}

/**
 * Advert application data, as encoded by AdvertDataBuilder::encodeTo:
 *   flags (type in bits 0-3, 0x10 lat/lon, 0x20/0x40 feature words, 0x80 name)
 *   optional int32 LE lat, int32 LE lon
 *   optional uint16 LE feature words
 *   optional UTF-8 name occupying the remainder
 */
export function parseAdvertData(bytes: Uint8Array): AdvertData | null {
  if (bytes.length < 1) return null;

  const flags = bytes[0]!;
  let offset = 1;

  let lat: number | null = null;
  let lon: number | null = null;
  if (flags & ADV_LATLON_MASK) {
    if (bytes.length < offset + 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    lat = view.getInt32(0, true) / 1e6;
    lon = view.getInt32(4, true) / 1e6;
    offset += 8;
  }

  if (flags & 0x20) {
    if (bytes.length < offset + 2) return null;
    offset += 2;
  }
  if (flags & 0x40) {
    if (bytes.length < offset + 2) return null;
    offset += 2;
  }

  let name: string | null = null;
  if (flags & ADV_NAME_MASK && bytes.length > offset) {
    name = new TextDecoder().decode(bytes.subarray(offset)).replace(/\0+$/, "");
    if (name.length === 0) name = null;
  }

  if (lat !== null && lon !== null) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      (lat === 0 && lon === 0)
    ) {
      lat = null;
      lon = null;
    }
  }

  return {
    type: flags & 0x0f || ADV_TYPE_NONE,
    hasLocation: lat !== null && lon !== null,
    lat,
    lon,
    name,
    flags,
  };
}
