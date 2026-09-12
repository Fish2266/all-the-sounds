/* ============================================================================
   Storage — IndexedDB for projects, binary assets and preferences.

   Projects hold structured data (layers keep their pixels as Uint8ClampedArray,
   which IndexedDB stores natively — no base64 round-trip). Audio and imported
   source images live in a separate `assets` store keyed by id so a project
   record stays small enough to read and write quickly on every autosave.
   ========================================================================= */

const DB_NAME = 'all-the-sounds';
const DB_VERSION = 2;

const S_PROJECTS = 'projects';
const S_ASSETS   = 'assets';
const S_PREFS    = 'prefs';
const S_CACHE    = 'cache';

let _db = null;
let _opening = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;
  _opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = req.result;
      if (!db.objectStoreNames.contains(S_PROJECTS)) {
        const s = db.createObjectStore(S_PROJECTS, { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
        s.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains(S_ASSETS)) {
        const s = db.createObjectStore(S_ASSETS, { keyPath: 'id' });
        s.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(S_PREFS)) db.createObjectStore(S_PREFS);
      if (!db.objectStoreNames.contains(S_CACHE)) db.createObjectStore(S_CACHE);
      void e;
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another open tab of this app.'));
  });
  return _opening;
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function wrap(request) {
  return new Promise((res, rej) => {
    request.onsuccess = () => res(request.result);
    request.onerror = () => rej(request.error);
  });
}

/* ---- Generic ------------------------------------------------------------ */
async function put(store, value, key) { return wrap((await tx(store, 'readwrite')).put(value, key)); }
async function get(store, key)        { return wrap((await tx(store)).get(key)); }
async function del(store, key)        { return wrap((await tx(store, 'readwrite')).delete(key)); }
async function all(store)             { return wrap((await tx(store)).getAll()); }

/* ---- Projects ----------------------------------------------------------- */
export const Projects = {
  async list() {
    const rows = await all(S_PROJECTS);
    return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  get:  id => get(S_PROJECTS, id),
  save: rec => put(S_PROJECTS, rec),
  async remove(id) {
    await del(S_PROJECTS, id);
    await Assets.removeForProject(id);
  },
  async count() {
    const s = await tx(S_PROJECTS);
    return wrap(s.count());
  },
};

/* ---- Assets (audio blobs, source images) -------------------------------- */
export const Assets = {
  get:  id => get(S_ASSETS, id),
  async put(rec) { await put(S_ASSETS, rec); return rec.id; },
  remove: id => del(S_ASSETS, id),
  async forProject(projectId) {
    const s = await tx(S_ASSETS);
    return wrap(s.index('projectId').getAll(projectId));
  },
  async removeForProject(projectId) {
    const store = await tx(S_ASSETS, 'readwrite');
    const keys = await wrap(store.index('projectId').getAllKeys(projectId));
    await Promise.all(keys.map(k => wrap(store.delete(k))));
  },
  /** Delete assets belonging to a project that nothing references any more. */
  async gc(projectId, liveIds) {
    const rows = await Assets.forProject(projectId);
    const live = new Set(liveIds);
    const dead = rows.filter(r => !live.has(r.id));
    await Promise.all(dead.map(r => Assets.remove(r.id)));
    return dead.length;
  },
};

/* ---- Preferences -------------------------------------------------------- */
export const Prefs = {
  async get(key, fallback = null) {
    const v = await get(S_PREFS, key);
    return v === undefined ? fallback : v;
  },
  set: (key, value) => put(S_PREFS, value, key),
  remove: key => del(S_PREFS, key),
  async all() {
    const s = await tx(S_PREFS);
    const keys = await wrap(s.getAllKeys());
    const vals = await wrap(s.getAll());
    return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  },
};

/* ---- Binary cache (the vorbis encoder, imported font blobs, …) ---------- */
export const Cache = {
  get: key => get(S_CACHE, key),
  set: (key, value) => put(S_CACHE, value, key),
  remove: key => del(S_CACHE, key),
};

/* ---- Quota -------------------------------------------------------------- */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, pct: quota ? usage / quota : 0 };
  } catch { return null; }
}

/** Ask the browser to keep this origin's data around. Best-effort. */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch { return false; }
}

/** Wipe everything — used only behind an explicit confirm. */
export async function nukeAll() {
  const db = await openDB();
  db.close(); _db = null; _opening = null;
  return new Promise((res, rej) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => res(true);
    req.onerror = () => rej(req.error);
    req.onblocked = () => res(false);
  });
}
