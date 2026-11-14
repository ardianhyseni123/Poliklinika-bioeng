// Minimal promise helpers over IndexedDB, for the device-only stores (write journal,
// attachments) and for reading the old app's database.

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export function openDatabase(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, oldVersion: number) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = event => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgraded the database: close so it can proceed.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    request.onblocked = () => reject(new Error(`IndexedDB ${name} is blocked by another tab.`));
  });
}

/** Opens an existing database without creating or upgrading it; null when it does not exist. */
export async function openExistingDatabase(name: string): Promise<IDBDatabase | null> {
  if (typeof indexedDB.databases === 'function') {
    const known = await indexedDB.databases();
    if (!known.some(item => item.name === name)) return null;
  }
  return new Promise((resolve, reject) => {
    let created = false;
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => { created = true; };
    request.onsuccess = () => {
      const db = request.result;
      if (!created) {
        resolve(db);
        return;
      }
      // Opening created an empty database: remove it again.
      db.close();
      indexedDB.deleteDatabase(name);
      resolve(null);
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export async function getAll<T>(db: IDBDatabase, store: string, index?: string, key?: IDBValidKey): Promise<T[]> {
  const objectStore = db.transaction(store, 'readonly').objectStore(store);
  const source = index ? objectStore.index(index) : objectStore;
  return requestResult(source.getAll(key) as IDBRequest<T[]>);
}

export async function getOne<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return requestResult(db.transaction(store, 'readonly').objectStore(store).get(key) as IDBRequest<T | undefined>);
}

export async function putOne(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  const transaction = db.transaction(store, 'readwrite');
  transaction.objectStore(store).put(value);
  await transactionDone(transaction);
}

export async function deleteKeys(db: IDBDatabase, store: string, keys: IDBValidKey[]): Promise<void> {
  if (!keys.length) return;
  const transaction = db.transaction(store, 'readwrite');
  for (const key of keys) transaction.objectStore(store).delete(key);
  await transactionDone(transaction);
}
