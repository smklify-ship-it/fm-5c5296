/** Minimal promise wrapper over IndexedDB (no dependency needed for 4 key-value stores). */

const DB_NAME = 'veg-map';
const DB_VERSION = 1;

export const STORES = {
  files: 'files', // prefecture PMTiles blobs, key = file name
  tiles: 'tiles', // base-map vector tiles, key = "z/x/y"
  memos: 'memos', // Memo, key = id
  areas: 'areas', // SavedArea, key = id
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of Object.values(STORES)) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('cannot open IndexedDB'));
    };
  });
  return dbPromise;
}

/** Test hook: forget the cached connection (fake-indexeddb is reset between tests). */
export function resetDbForTests(): void {
  dbPromise = null;
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  const req = db.transaction(store, 'readonly').objectStore(store).get(key);
  return (await requestToPromise(req)) as T | undefined;
}

export async function dbPut(store: StoreName, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await txDone(tx);
}

/** Many writes in one transaction: far faster than one transaction per tile. */
export async function dbPutMany(store: StoreName, entries: [string, unknown][]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const [key, value] of entries) os.put(value, key);
  await txDone(tx);
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await txDone(tx);
}

export async function dbClear(store: StoreName): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  await txDone(tx);
}

export async function dbAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const req = db.transaction(store, 'readonly').objectStore(store).getAll();
  return (await requestToPromise(req)) as T[];
}

export async function dbHasKey(store: StoreName, key: string): Promise<boolean> {
  const db = await openDb();
  const req = db.transaction(store, 'readonly').objectStore(store).count(key);
  return (await requestToPromise(req)) > 0;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function dbKeys(store: StoreName): Promise<string[]> {
  const db = await openDb();
  const req = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
  return (await requestToPromise(req)).map(String);
}
