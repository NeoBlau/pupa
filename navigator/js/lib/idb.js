/* idb.js — thin promise wrapper over IndexedDB plus the app's schema. */

const DB_NAME = 'compass-nav';
const DB_VERSION = 4;

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

const SCHEMA = {
  regions:   { keyPath: 'id' },
  graph:     { keyPath: 'regionId' },
  cameras:   { keyPath: 'id', indexes: { cell: 'cell', regionId: 'regionId' } },
  trails:    { keyPath: 'id', indexes: { regionId: 'regionId', cell: 'cell' } },
  pois:      { keyPath: 'id', indexes: { cell: 'cell', regionId: 'regionId',
                                          tokens: { keyPath: 'tokens', multiEntry: true } } },
  tracks:    { keyPath: 'id', indexes: { startedAt: 'startedAt' } },
  favorites: { keyPath: 'id', indexes: { createdAt: 'createdAt' } },
  history:   { keyPath: 'id', indexes: { at: 'at' } },
  kv:        { keyPath: 'key' },
};

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [idx, spec] of Object.entries(def.indexes ?? {})) {
          if (store.indexNames.contains(idx)) continue;
          const { keyPath = spec, multiEntry = false, unique = false } =
            typeof spec === 'string' ? {} : spec;
          store.createIndex(idx, keyPath, { multiEntry, unique });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const out = fn(tx.objectStore(storeName), tx);
    tx.oncomplete = () => resolve(out?.__result ?? out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  }));
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export const idb = {
  async get(store, key)       { return run(store, 'readonly',  (s) => wrap(s.get(key))); },
  async getAll(store, query)  { return run(store, 'readonly',  (s) => wrap(s.getAll(query))); },
  async put(store, value)     { return run(store, 'readwrite', (s) => wrap(s.put(value))); },
  async delete(store, key)    { return run(store, 'readwrite', (s) => wrap(s.delete(key))); },
  async clear(store)          { return run(store, 'readwrite', (s) => wrap(s.clear())); },
  async count(store)          { return run(store, 'readonly',  (s) => wrap(s.count())); },

  /** Bulk insert — one transaction for the whole batch, which matters for 100k+ rows. */
  async putAll(store, values) {
    if (!values.length) return 0;
    const db = await openDB();
    const CHUNK = 5000;
    for (let i = 0; i < values.length; i += CHUNK) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const v of values.slice(i, i + CHUNK)) os.put(v);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
    return values.length;
  },

  async byIndex(store, index, query) {
    return run(store, 'readonly', (s) => wrap(s.index(index).getAll(query)));
  },

  /** Collect rows whose index value is any of `keys` (used for spatial cell lookup). */
  async byIndexAny(store, index, keys) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const idx = tx.objectStore(store).index(index);
      const out = [];
      let pending = keys.length;
      if (!pending) return resolve(out);
      for (const key of keys) {
        const req = idx.getAll(key);
        req.onsuccess = () => { out.push(...req.result); if (--pending === 0) resolve(out); };
        req.onerror = () => reject(req.error);
      }
      tx.onerror = () => reject(tx.error);
    });
  },

  /** Rows whose index value starts with `prefix` — the offline search primitive. */
  async byIndexPrefix(store, index, prefix, limit = 300) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
      const req = tx.objectStore(store).index(index).openCursor(range);
      const out = [];
      const seen = new Set();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) return resolve(out);
        if (!seen.has(cur.primaryKey)) { seen.add(cur.primaryKey); out.push(cur.value); }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async deleteByIndex(store, index, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).index(index).openKeyCursor(key);
      let n = 0;
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        tx.objectStore(store).delete(cur.primaryKey); n++;
        cur.continue();
      };
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => reject(tx.error);
    });
  },
};

/* ---------- key/value convenience ---------- */

export const kv = {
  async get(key, fallback = null) { return (await idb.get('kv', key))?.value ?? fallback; },
  async set(key, value) { return idb.put('kv', { key, value, at: Date.now() }); },
  async del(key) { return idb.delete('kv', key); },
};

/** Persisted storage keeps offline packs from being evicted under pressure. */
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch { return false; }
}

export async function storageEstimate() {
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    return { usage, quota };
  } catch { return { usage: 0, quota: 0 }; }
}
