const DB_NAME = 'medalforge-local';
const DB_VERSION = 1;
const STORES = ['projects', 'inventory', 'settings'];

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const store of STORES) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return databasePromise;
}

async function transaction(store, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadRecord(store, key, fallback = null) {
  try {
    const value = await transaction(store, 'readonly', objectStore => objectStore.get(key));
    return value ?? fallback;
  } catch {
    const raw = localStorage.getItem(`${DB_NAME}:${store}:${key}`);
    try { return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  }
}

export async function saveRecord(store, key, value) {
  try {
    await transaction(store, 'readwrite', objectStore => objectStore.put(value, key));
  } catch {
    localStorage.setItem(`${DB_NAME}:${store}:${key}`, JSON.stringify(value));
  }
}

export async function clearRecord(store, key) {
  try {
    await transaction(store, 'readwrite', objectStore => objectStore.delete(key));
  } catch {
    localStorage.removeItem(`${DB_NAME}:${store}:${key}`);
  }
}
