/* ============================================================================
   Game link — hear the originals from the copy of Minecraft you already own.

   This app ships no Mojang audio. Link your game folder once and it reads,
   from your own disk:

     • assets/indexes/<n>.json   which hashed file is which sound
     • assets/objects/…          the vanilla .ogg files, played on demand
     • minecraft/sounds.json     the exact event list for your version
     • versions/<v>/<v>.jar      version.json for the pack format, and
                                 lang/en_us.json for the subtitle names

   Nothing is uploaded. Where the directory picker can reach the folder
   (Linux) it is remembered; on macOS and Windows the game lives somewhere
   Chrome will not hand a site a directory handle for, so the folder is read
   as a file list — and the sound files are copied into this site's private
   storage, so the originals still load by themselves on the next visit.
   ========================================================================= */

import { unzip } from '../export/zip.js';
import { Cache, Prefs } from './db.js';
import { setLinkedVersion } from './versions.js';
import { bus } from './store.js';
import { useGameList } from './soundlist.js';

const HANDLE_KEY = 'game-folder-v1';
const DATA_KEY = 'game-data-v1';

const G = {
  data: null,          // derived: { version, indexId, events, subtitles, hashes, packVersion, installs, … }
  handle: null,        // FileSystemDirectoryHandle, when the browser has them
  session: null,       // a file-list source, for browsers without
  src: null,
  permission: 'none',  // none | granted | prompt | denied
  copy: { state: 'none', done: 0, total: 0 },   // the private copy — see the end of this file
};
export const gameLink = G;
export const isLinked = () => !!G.data;
export const hasFolderPicker = () => typeof window.showDirectoryPicker === 'function';

/**
 * Whether the directory picker can reach — and so remember — the game folder.
 * Chrome refuses to hand a site anything inside ~/Library on macOS or AppData
 * on Windows ("can't open this folder because it contains system files"),
 * which is exactly where the launcher installs the game. There the folder is
 * read as a file list instead: it opens fine, but only for the session.
 */
export const canRememberFolder = () =>
  hasFolderPicker() && !/Mac|Win/i.test(navigator.platform || navigator.userAgent);

export const FOLDER_PATHS = {
  mac: '~/Library/Application Support/minecraft',
  win: '%APPDATA%\\.minecraft',
  linux: '~/.minecraft',
};

/* ========================================================================= */
/* SOURCES                                                                   */
/* A source answers two questions — "what is in this folder" and "give me     */
/* this file" — whether it is backed by a directory handle or a file list.    */
/* ========================================================================= */

function handleSource(root) {
  const dirs = new Map();
  async function dir(path) {
    if (!path) return root;
    if (dirs.has(path)) return dirs.get(path);
    let d = root;
    for (const p of path.split('/')) d = await d.getDirectoryHandle(p);
    dirs.set(path, d);
    return d;
  }
  return {
    name: root.name,
    async file(path) {
      const i = path.lastIndexOf('/');
      try {
        const d = await dir(i < 0 ? '' : path.slice(0, i));
        return await (await d.getFileHandle(path.slice(i + 1))).getFile();
      } catch { return null; }
    },
    async list(path) {
      try {
        const d = await dir(path);
        const out = [];
        for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind });
        return out;
      } catch { return null; }
    },
  };
}

function filesSource(fileList) {
  const files = new Map();
  const dirs = new Map([['', new Map()]]);
  let name = '';
  for (const f of fileList) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    name = name || parts[0];
    const rel = parts.slice(1);
    files.set(rel.join('/'), f);
    for (let i = 0; i < rel.length; i++) {
      const parent = rel.slice(0, i).join('/');
      if (!dirs.has(parent)) dirs.set(parent, new Map());
      dirs.get(parent).set(rel[i], i === rel.length - 1 ? 'file' : 'directory');
    }
  }
  return {
    name,
    async file(path) { return files.get(path) || null; },
    async list(path) {
      const m = dirs.get(path || '');
      return m ? [...m].map(([n, kind]) => ({ name: n, kind })) : null;
    },
  };
}

/* ========================================================================= */
/* READING                                                                   */
/* ========================================================================= */

/** Accept the game folder itself, or its assets folder. */
async function detect(src) {
  const top = await src.list('');
  const names = new Set((top || []).map(e => e.name));
  if (names.has('assets')) return { assets: 'assets/', versions: names.has('versions') ? 'versions/' : null };
  if (names.has('indexes') && names.has('objects')) return { assets: '', versions: null };
  throw new Error('That does not look like a Minecraft folder. Pick the one called "minecraft" (".minecraft" on Windows) — the folder that holds assets and versions.');
}

async function readJSON(src, path) {
  const f = await src.file(path);
  if (!f) return null;
  try { return JSON.parse(await f.text()); } catch { return null; }
}

async function installedVersions(src, layout) {
  if (!layout.versions) return [];
  const out = [];
  for (const e of (await src.list('versions')) || []) {
    if (e.kind !== 'directory') continue;
    const j = await readJSON(src, `versions/${e.name}/${e.name}.json`);
    if (!j) continue;
    out.push({ id: e.name, assets: j.assets || null, inherits: j.inheritsFrom || null, type: j.type || '', time: j.releaseTime || '' });
  }
  // A modded profile names its parent rather than an asset index.
  for (const v of out) if (!v.assets && v.inherits) v.assets = out.find(o => o.id === v.inherits)?.assets || null;
  return out.filter(v => v.assets);
}

/**
 * Read everything this app needs out of a game folder.
 * @param {object} src
 * @param {string|null} want  version id to read; null picks the newest release
 */
async function readGame(src, want, onProgress = () => {}) {
  onProgress('Looking around…', 0.05);
  const layout = await detect(src);
  const installs = await installedVersions(src, layout);
  const indexes = ((await src.list(`${layout.assets}indexes`)) || [])
    .filter(e => e.name.endsWith('.json')).map(e => e.name.slice(0, -5));
  if (!indexes.length) throw new Error('This folder has no asset indexes. Launch the game once so it downloads its sounds, then link it again.');

  const usable = installs.filter(v => indexes.includes(v.assets));
  const byTime = (a, b) => (a.time < b.time ? 1 : -1);
  const install = usable.find(v => v.id === want)
    || usable.filter(v => v.type === 'release').sort(byTime)[0]
    || usable.sort(byTime)[0]
    || null;
  const indexId = install?.assets || indexes.sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0))[0];

  onProgress('Reading the asset index…', 0.2);
  const index = await readJSON(src, `${layout.assets}indexes/${indexId}.json`);
  if (!index?.objects) throw new Error(`Asset index ${indexId} could not be read.`);
  const hashes = {};
  const sizes = new Map();
  for (const [k, v] of Object.entries(index.objects)) {
    if (k.startsWith('minecraft/sounds/') && k.endsWith('.ogg')) {
      hashes[k.slice(17, -4)] = v.hash;
      sizes.set(v.hash, v.size || 0);
    }
  }
  const soundBytes = [...sizes.values()].reduce((a, b) => a + b, 0);
  const sj = index.objects['minecraft/sounds.json'];
  if (!sj) throw new Error('This asset index has no sounds.json in it.');
  onProgress('Reading the sound list…', 0.3);
  const events = await readJSON(src, `${layout.assets}objects/${sj.hash.slice(0, 2)}/${sj.hash}`);
  if (!events) throw new Error('The game’s sounds.json is missing from assets/objects. Launch the game once to repair it.');

  let packVersion = null, subtitles = null, version = install?.id || `asset index ${indexId}`;
  const jar = install ? await src.file(`versions/${install.id}/${install.id}.jar`) : null;
  if (jar) {
    onProgress(`Opening ${install.id}.jar…`, 0.4);
    const files = await unzip(jar, {
      filter: p => p === 'version.json' || p === 'assets/minecraft/lang/en_us.json',
      onProgress: pct => onProgress(`Reading ${install.id}.jar…`, 0.4 + pct * 0.5),
    });
    const dec = new TextDecoder();
    try {
      const vj = JSON.parse(dec.decode(files.get('version.json')));
      version = vj.name || vj.id || version;
      const pv = vj.pack_version || {};
      if (Number.isFinite(pv.resource_major)) packVersion = { resource: [pv.resource_major, pv.resource_minor || 0] };
      else if (Number.isFinite(vj.pack_version?.resource)) packVersion = { resource: [vj.pack_version.resource, 0] };
    } catch { /* an older jar; the table's numbers still apply */ }
    try {
      const lang = JSON.parse(dec.decode(files.get('assets/minecraft/lang/en_us.json')));
      subtitles = {};
      for (const [k, v] of Object.entries(lang)) if (k.startsWith('subtitles.')) subtitles[k] = v;
    } catch { /* bundled names fill in */ }
  }

  onProgress('Done', 1);
  return {
    version, versionId: install?.id || null, indexId,
    installs: usable.map(v => v.id),
    assetsPrefix: layout.assets,
    folder: src.name,
    packVersion, events, subtitles, hashes,
    files: Object.keys(hashes).length,
    soundBytes,
    at: Date.now(),
  };
}

function apply(data) {
  G.data = data;
  G.copy = data?.copied
    ? { state: data.copied.complete ? 'done' : 'partial', done: data.copied.count, total: data.copied.count }
    : { state: 'none', done: 0, total: 0 };
  setLinkedVersion(data ? { version: data.version, packVersion: data.packVersion } : null);
  useGameList(data);
  bus.emit('game:changed', data);
}

/* ========================================================================= */
/* LINKING                                                                   */
/* ========================================================================= */

/** Pick a folder with a directory handle (Chrome, Edge). */
export async function linkWithPicker(onProgress) {
  // Called straight from a click: the picker must open before any await.
  const handle = await window.showDirectoryPicker({ id: 'minecraft', mode: 'read' });
  return linkWithHandle(handle, onProgress);
}

/** Link any directory handle — the picker's, or one restored from storage. */
export async function linkWithHandle(handle, onProgress) {
  const src = handleSource(handle);
  const data = await readGame(src, null, onProgress);
  G.handle = handle; G.src = src; G.session = null; G.permission = 'granted';
  await Prefs.set(HANDLE_KEY, handle).catch(() => {});   // not every browser can store one
  await Cache.set(DATA_KEY, data);
  apply(data);
  return data;
}

/** The fallback: an <input webkitdirectory> file list, good for this session. */
export async function linkWithFiles(fileList, onProgress) {
  const src = filesSource(fileList);
  const data = await readGame(src, null, onProgress);
  G.handle = null; G.session = src; G.src = src; G.permission = 'granted';
  await Cache.set(DATA_KEY, data);
  apply(data);
  return data;
}

/** Re-read the same folder for a different installed version. */
export async function switchVersion(id, onProgress) {
  const src = await activeSource({ ask: true });
  if (!src) throw new Error('Reconnect your game folder first.');
  const data = await readGame(src, id, onProgress);
  await Cache.set(DATA_KEY, data);
  apply(data);
  return data;
}

/** Called once at boot: the list and pack numbers come back straight away;
 *  playing originals may need one click to re-grant read access. */
export async function restoreGameLink() {
  try {
    const data = await Cache.get(DATA_KEY);
    if (data) apply(data);
    const handle = await Prefs.get(HANDLE_KEY, null);
    if (handle?.queryPermission) {
      G.handle = handle;
      G.permission = await handle.queryPermission({ mode: 'read' });
      if (G.permission === 'granted') G.src = handleSource(handle);
    }
    bus.emit('game:permission', G.permission);
    return data;
  } catch (e) {
    console.warn('[game] could not restore', e);
    return null;
  }
}

export async function unlinkGame() {
  await dropCopy();
  await Cache.remove(DATA_KEY);
  await Prefs.remove(HANDLE_KEY);
  G.handle = null; G.session = null; G.src = null; G.permission = 'none';
  apply(null);
}

/** Whether playing an original right now would work without asking. */
export function originalsState() {
  if (!G.data) return 'unlinked';
  if (G.data.copied?.complete) return 'ready';
  if (G.session || (G.handle && G.permission === 'granted')) return 'ready';
  if (G.handle) return 'reconnect';
  return 'relink';          // a session-only link from an earlier visit
}

async function activeSource({ ask = false } = {}) {
  if (G.session) return G.session;
  if (!G.handle) return null;
  let p = await G.handle.queryPermission({ mode: 'read' });
  // requestPermission needs a user gesture; every caller is a click.
  if (p !== 'granted' && ask) p = await G.handle.requestPermission({ mode: 'read' });
  if (p !== G.permission) { G.permission = p; bus.emit('game:permission', p); }
  if (p !== 'granted') return null;
  G.src = G.src || handleSource(G.handle);
  return G.src;
}

export async function reconnect() { return !!(await activeSource({ ask: true })); }

/**
 * One vanilla sound file, by its sounds.json name ("mob/cow/say1").
 * Returns a File, or null when the game does not have it.
 */
export async function originalFile(name) {
  const hash = G.data?.hashes?.[String(name).replace(/^minecraft:/, '')];
  if (!hash) return null;
  const kept = await copiedFile(hash);
  if (kept) return kept;
  const src = await activeSource({ ask: true });
  if (!src) throw new Error('Your game folder needs reconnecting before the originals can play.');
  return src.file(`${G.data.assetsPrefix}objects/${hash.slice(0, 2)}/${hash}`);
}

export const hasOriginal = name => !!G.data?.hashes?.[String(name).replace(/^minecraft:/, '')];

/* ========================================================================= */
/* THE PRIVATE COPY                                                          */
/*                                                                           */
/* A web page cannot remember a path, and Chrome will not hand it a folder   */
/* inside ~/Library or AppData at all. What a page can do is keep files of   */
/* its own. So once the folder has been picked, the game's sound files are   */
/* copied into this site's private storage (the origin private file system), */
/* and from then on the originals play on every visit with nothing to pick.  */
/*                                                                           */
/* They are the user's own files, on the user's own disk, readable only by   */
/* this page. Nothing is uploaded, and unlinking deletes the lot.            */
/* ========================================================================= */

const COPY_DIR = 'originals';
let copyJob = null;
let copyAbort = false;

export const canKeepCopy = () =>
  typeof navigator.storage?.getDirectory === 'function' &&
  typeof FileSystemFileHandle !== 'undefined' &&
  'createWritable' in FileSystemFileHandle.prototype;

async function copyDir(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(COPY_DIR, { create });
}

/** One file out of the copy, laid out like assets/objects: ab/abcdef…. */
async function copiedFile(hash) {
  if (!G.data?.copied || !canKeepCopy()) return null;
  try {
    const d = await (await copyDir()).getDirectoryHandle(hash.slice(0, 2));
    return await (await d.getFileHandle(hash)).getFile();
  } catch { return null; }
}

/** What the copy already holds. A write is only committed on close, so a
 *  copy cut short by closing the tab never leaves half a file behind. */
async function copiedHashes(root) {
  const have = new Set();
  for await (const [, sub] of root.entries()) {
    if (sub.kind !== 'directory') continue;
    for await (const [name, h] of sub.entries()) if (h.kind === 'file') have.add(name);
  }
  return have;
}

function copyProgress(patch) {
  Object.assign(G.copy, patch);
  bus.emit('game:copy', G.copy);
}

/**
 * Copy every sound file the linked version uses, skipping what is already
 * there — so linking a newer version later only copies what changed. Runs in
 * the background with progress on 'game:copy'. Resolves true when complete.
 */
export function keepCopy() {
  if (copyJob) return copyJob;
  copyJob = (async () => {
    if (!G.data || !canKeepCopy()) return false;
    const src = G.session || (G.handle ? await activeSource() : null);
    if (!src) return false;
    copyAbort = false;
    const prefix = G.data.assetsPrefix;
    const want = [...new Set(Object.values(G.data.hashes))];
    const root = await copyDir(true);
    const have = await copiedHashes(root);
    const todo = want.filter(h => !have.has(h));

    const perFile = want.length ? (G.data.soundBytes || 0) / want.length : 0;
    const est = await navigator.storage.estimate?.().catch(() => null);
    if (est?.quota && est.quota - est.usage < todo.length * perFile * 1.1) {
      copyProgress({ state: 'nospace', done: want.length - todo.length, total: want.length });
      return false;
    }
    // Ask the browser not to evict it under storage pressure. Best-effort.
    navigator.storage.persist?.().catch(() => {});

    copyProgress({ state: 'copying', done: want.length - todo.length, total: want.length });
    let next = 0, failed = 0, last = 0;
    const worker = async () => {
      while (next < todo.length && !copyAbort) {
        const hash = todo[next++];
        try {
          const f = await src.file(`${prefix}objects/${hash.slice(0, 2)}/${hash}`);
          if (!f) { failed++; }
          else {
            const d = await root.getDirectoryHandle(hash.slice(0, 2), { create: true });
            const w = await (await d.getFileHandle(hash, { create: true })).createWritable();
            await w.write(f);
            await w.close();
          }
        } catch { failed++; }
        G.copy.done++;
        const now = performance.now();
        if (now - last > 200) { last = now; bus.emit('game:copy', G.copy); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (copyAbort || !G.data) return false;

    G.data.copied = { complete: !failed, count: want.length - failed, bytes: G.data.soundBytes || 0, at: Date.now() };
    await Cache.set(DATA_KEY, G.data);
    copyProgress({ state: failed ? 'partial' : 'done', failed });
    bus.emit('game:permission', G.permission);
    return !failed;
  })()
    .catch(e => { console.warn('[game] copy failed', e); copyProgress({ state: 'error' }); return false; })
    .finally(() => { copyJob = null; });
  return copyJob;
}

/** Delete the copy — on unlink, or when its switch is turned off. */
export async function dropCopy() {
  copyAbort = true;
  if (copyJob) await copyJob;
  if (canKeepCopy()) {
    try { await (await navigator.storage.getDirectory()).removeEntry(COPY_DIR, { recursive: true }); } catch { /* none yet */ }
  }
  if (G.data?.copied) { G.data.copied = null; await Cache.set(DATA_KEY, G.data); }
  copyProgress({ state: 'none', done: 0, total: 0 });
  bus.emit('game:permission', G.permission);
}

export const copyStatus = () => ({ ...G.copy, kept: G.data?.copied || null });
