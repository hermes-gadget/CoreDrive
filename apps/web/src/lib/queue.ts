import { openDB, type IDBPDatabase } from "idb";
import type { Observation } from "@coredrive/protocol";

export interface QueueItem {
  id: string;
  sessionId: string;
  obs: Observation;
  attempts: number;
  nextAttemptAt: number;
}

const DB_NAME = "coredrive";
const STORE = "observations";

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: "id" });
    },
  });
  return dbPromise;
}

export async function enqueue(item: QueueItem): Promise<void> {
  await (await db()).put(STORE, item);
}

export async function pending(limit = 100): Promise<QueueItem[]> {
  const all = (await (await db()).getAll(STORE)) as QueueItem[];
  const now = Date.now();
  return all
    .filter((item) => item.nextAttemptAt <= now)
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

export async function count(): Promise<number> {
  return (await db()).count(STORE);
}
