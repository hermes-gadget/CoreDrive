/** Companion protocol constants from MeshCore's companion_radio firmware. */

export const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const RX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const TX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export const MAX_FRAME_SIZE = 176;
export const PUB_KEY_SIZE = 32;
export const MAX_PATH_SIZE = 64;

export const CMD_APP_START = 1;
export const CMD_GET_CONTACTS = 4;
export const CMD_GET_DEVICE_TIME = 5;
export const CMD_GET_BATT_AND_STORAGE = 20;
export const CMD_DEVICE_QUERY = 22;
export const CMD_GET_CONTACT_BY_KEY = 30;
export const CMD_GET_CHANNEL = 31;
export const CMD_GET_CUSTOM_VARS = 40;
export const CMD_GET_ADVERT_PATH = 42;
export const CMD_GET_TUNING_PARAMS = 43;
export const CMD_GET_STATS = 56;
export const CMD_GET_AUTOADD_CONFIG = 59;
export const CMD_GET_ALLOWED_REPEAT_FREQ = 60;
export const CMD_GET_DEFAULT_FLOOD_SCOPE = 64;
export const CMD_SEND_RAW_PACKET = 65;
export const CMD_RUN_CLI_COMMAND = 66;

export const STATS_TYPE_CORE = 0;
export const STATS_TYPE_RADIO = 1;
export const STATS_TYPE_PACKETS = 2;

export const RESP_CODE_OK = 0;
export const RESP_CODE_ERR = 1;
export const RESP_CODE_CONTACTS_START = 2;
export const RESP_CODE_CONTACT = 3;
export const RESP_CODE_END_OF_CONTACTS = 4;
export const RESP_CODE_SELF_INFO = 5;
export const RESP_CODE_SENT = 6;
export const RESP_CODE_CONTACT_MSG_RECV = 7;
export const RESP_CODE_CHANNEL_MSG_RECV = 8;
export const RESP_CODE_CURR_TIME = 9;
export const RESP_CODE_NO_MORE_MESSAGES = 10;
export const RESP_CODE_EXPORT_CONTACT = 11;
export const RESP_CODE_BATT_AND_STORAGE = 12;
export const RESP_CODE_DEVICE_INFO = 13;
export const RESP_CODE_PRIVATE_KEY = 14;
export const RESP_CODE_DISABLED = 15;
export const RESP_CODE_CONTACT_MSG_RECV_V3 = 16;
export const RESP_CODE_CHANNEL_MSG_RECV_V3 = 17;
export const RESP_CODE_CHANNEL_INFO = 18;
export const RESP_CODE_SIGN_START = 19;
export const RESP_CODE_SIGNATURE = 20;
export const RESP_CODE_CUSTOM_VARS = 21;
export const RESP_CODE_ADVERT_PATH = 22;
export const RESP_CODE_TUNING_PARAMS = 23;
export const RESP_CODE_STATS = 24;
export const RESP_CODE_AUTOADD_CONFIG = 25;
export const RESP_ALLOWED_REPEAT_FREQ = 26;
export const RESP_CODE_CHANNEL_DATA_RECV = 27;
export const RESP_CODE_DEFAULT_FLOOD_SCOPE = 28;
export const RESP_CODE_CLI_REPLY = 29;

export const PUSH_CODE_ADVERT = 0x80;
export const PUSH_CODE_PATH_UPDATED = 0x81;
export const PUSH_CODE_SEND_CONFIRMED = 0x82;
export const PUSH_CODE_MSG_WAITING = 0x83;
export const PUSH_CODE_RAW_DATA = 0x84;
export const PUSH_CODE_LOGIN_SUCCESS = 0x85;
export const PUSH_CODE_LOGIN_FAIL = 0x86;
export const PUSH_CODE_STATUS_RESPONSE = 0x87;
export const PUSH_CODE_LOG_RX_DATA = 0x88;
export const PUSH_CODE_TRACE_DATA = 0x89;
export const PUSH_CODE_NEW_ADVERT = 0x8a;
export const PUSH_CODE_TELEMETRY_RESPONSE = 0x8b;
export const PUSH_CODE_BINARY_RESPONSE = 0x8c;
export const PUSH_CODE_PATH_DISCOVERY_RESPONSE = 0x8d;
export const PUSH_CODE_CONTROL_DATA = 0x8e;
export const PUSH_CODE_CONTACT_DELETED = 0x8f;
export const PUSH_CODE_CONTACTS_FULL = 0x90;

export const ADV_TYPE_NONE = 0;
export const ADV_TYPE_CHAT = 1;
export const ADV_TYPE_REPEATER = 2;
export const ADV_TYPE_ROOM = 3;
export const ADV_TYPE_SENSOR = 4;

export const ADV_LATLON_MASK = 0x10;
export const ADV_FEAT1_MASK = 0x20;
export const ADV_FEAT2_MASK = 0x40;
export const ADV_NAME_MASK = 0x80;

/**
 * Commands the app is allowed to send. The product invariant is passive-only:
 * no radio transmission is permitted. These are local BLE queries only.
 */
export const ALLOWED_COMMANDS = new Set<number>([
  CMD_APP_START,
  CMD_GET_CONTACTS,
  CMD_GET_DEVICE_TIME,
  CMD_GET_BATT_AND_STORAGE,
  CMD_DEVICE_QUERY,
  CMD_GET_CONTACT_BY_KEY,
  CMD_GET_CHANNEL,
  CMD_GET_CUSTOM_VARS,
  CMD_GET_ADVERT_PATH,
  CMD_GET_TUNING_PARAMS,
  CMD_GET_STATS,
  CMD_GET_AUTOADD_CONFIG,
  CMD_GET_ALLOWED_REPEAT_FREQ,
  CMD_GET_DEFAULT_FLOOD_SCOPE,
  CMD_RUN_CLI_COMMAND,
]);

/** CLI commands that only read state. Anything else is refused. */
const READ_ONLY_CLI_PREFIXES = ["get ", "stats ", "ver", "version", "help"];

export function isAllowedCommand(frame: Uint8Array): { ok: true } | { ok: false; reason: string } {
  if (frame.length === 0) return { ok: false, reason: "empty command" };
  const code = frame[0]!;
  if (!ALLOWED_COMMANDS.has(code)) {
    return { ok: false, reason: `command ${code} is not in the passive allowlist` };
  }
  if (code === CMD_RUN_CLI_COMMAND) {
    const text = new TextDecoder().decode(frame.subarray(1)).trim().toLowerCase();
    if (!READ_ONLY_CLI_PREFIXES.some((prefix) => text === prefix || text.startsWith(prefix))) {
      return { ok: false, reason: `CLI command is not read-only: ${text}` };
    }
  }
  return { ok: true };
}
