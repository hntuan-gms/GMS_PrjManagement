/**
 * A key → value store in IndexedDB, for what is too big for localStorage (about 5 MB for the whole site, and
 * a 4000-task project with its SLA fields no longer fits in the 3 MB tasksCache.ts allows itself). Every
 * method resolves rather than throws: no IndexedDB (a private window, a blocked profile) just means no cache.
 */
export interface AsyncStore {
  get<T>(key: string): Promise<T | null>;
  put(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DB_NAME = "gms-cache";
const STORE = "entries";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let opened: Promise<IDBDatabase | null> | null = null;

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | undefined, fallback: T): Promise<T> {
  opened ??= open();
  const db = await opened;
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve((req?.result as T | undefined) ?? fallback);
      tx.onerror = tx.onabort = () => resolve(fallback);
    } catch {
      resolve(fallback);
    }
  });
}

export const idbStore: AsyncStore = {
  get: <T>(key: string) => run<T | null>("readonly", (s) => s.get(key), null),
  put: (key, value) => run<void>("readwrite", (s) => s.put(value, key), undefined),
  del: (key) => run<void>("readwrite", (s) => s.delete(key), undefined),
  clear: () => run<void>("readwrite", (s) => s.clear(), undefined),
};
