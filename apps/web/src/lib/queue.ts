import { openDB, type IDBPDatabase } from "idb";
import type { Observation } from "@coredrive/protocol";

export interface QueueItem {
  id: string;
  /** Account that recorded the observation. Nobody else may upload it. */
  username: string;
  sessionId: string;
  obs: Observation;
  attempts: number;
  nextAttemptAt: number;
}

const DB_NAME = "coredrive";
const STORE = "observations";
const DB_VERSION = 3;

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade: async (database, oldVersion, _newVersion, transaction) => {
      if (oldVersion < 1) database.createObjectStore(STORE, { keyPath: "id" });
      if (oldVersion < 2) {
        // Rows written before the queue carried an owner cannot be attributed to
        // an account, so they can never be uploaded safely. Drop them.
        await transaction.objectStore(STORE).clear();
      }
      if (oldVersion < 3) {
        // Strip packet payload bytes captured before the metadata-only policy.
        const store = transaction.objectStore(STORE);
        const rows = (await store.getAll()) as QueueItem[];
        for (const row of rows) {
          if (row.obs && "rawFrame" in row.obs) {
            delete (row.obs as Observation & { rawFrame?: string }).rawFrame;
            await store.put(row);
          }
        }
      }
    },
  });
  return dbPromise;
}

export async function enqueue(item: QueueItem): Promise<void> {
  await (await db()).put(STORE, item);
}

export async function pending(username: string, limit = 100): Promise<QueueItem[]> {
  const all = (await (await db()).getAll(STORE)) as QueueItem[];
  const now = Date.now();
  return all
    .filter((item) => item.username === username && item.nextAttemptAt <= now)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId))
    .slice(0, limit);
}

export async function acknowledge(ids: string[]): Promise<void> {
  const database = await db();
  const tx = database.transaction(STORE, "readwrite");
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function retryLater(ids: string[], delayMs: number): Promise<void> {
  const database = await db();
  const tx = database.transaction(STORE, "readwrite");
  const next = Date.now() + delayMs;
  for (const id of ids) {
    const item = (await tx.store.get(id)) as QueueItem | undefined;
    if (item) await tx.store.put({ ...item, attempts: item.attempts + 1, nextAttemptAt: next });
  }
  await tx.done;
}

export async function count(username: string): Promise<number> {
  const all = (await (await db()).getAll(STORE)) as QueueItem[];
  return all.filter((item) => item.username === username).length;
}
