/* ============================================================================
   Store — app state, subscriptions and autosave.
   The same shape as Frame & Groove's, minus the pixel history.
   ========================================================================= */

import { Projects, Assets, Prefs } from './db.js';
import { syncThemeColor } from './themecolor.js';
import { projectToJSON, projectFromJSON, createProject, projectStats } from './project.js';
import { debounce, uid } from './util.js';

/* ---- Tiny emitter ------------------------------------------------------- */
class Emitter {
  #m = new Map();
  on(evt, fn) {
    if (!this.#m.has(evt)) this.#m.set(evt, new Set());
    this.#m.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  once(evt, fn) { const off = this.on(evt, (...a) => { off(); fn(...a); }); return off; }
  off(evt, fn) { this.#m.get(evt)?.delete(fn); }
  emit(evt, ...a) {
    const s = this.#m.get(evt);
    if (s) for (const fn of [...s]) { try { fn(...a); } catch (e) { console.error(`[bus:${evt}]`, e); } }
  }
}
export const bus = new Emitter();

/**
 * Subscribe on behalf of a DOM node, and stop when that node leaves the page —
 * for components rebuilt on every render that have nowhere to hang a disposer.
 */
export function bindLive(el, evt, handler) {
  const off = bus.on(evt, (...args) => {
    if (!el.isConnected) { off(); return; }
    handler(...args);
  });
  return off;
}

/* ========================================================================= */
/* APP STATE                                                                 */
/* ========================================================================= */

export const state = {
  ready: false,
  route: 'library',            // library | sounds | export
  project: null,
  projectDirty: false,
  saving: false,
  lastSavedAt: 0,
  selEvent: null,              // sound event id
  selTake: null,               // take key within the selected event
  filter: { cat: 'all', status: 'all', q: '' },
  library: [],
  prefs: {
    theme: 'deepslate',
    grain: true,
    textures: true,
    sound: true,
    soundVolume: 55,
    reduceMotion: false,
    autoTrim: true,             // cut the silence either side of a new take
    autoPlay: true,             // play a take back as soon as it is captured
    advanceAfterTake: false,    // jump to the next unrecorded sound after a take
    inputDevice: null,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    quality: 4,
    keepOriginals: true,        // copy the game's sounds into this browser on link
    firstRun: true,
  },
};

export function setRoute(route, opts = {}) {
  if (state.route === route && !opts.force) return;
  state.route = route;
  bus.emit('route', route, opts);
}

export function markDirty(reason = 'edit') {
  state.projectDirty = true;
  bus.emit('project:dirty', reason);
  scheduleSave();
}

/* ---- Preferences -------------------------------------------------------- */
export async function loadPrefs() {
  const stored = await Prefs.get('prefs', null);
  if (stored) Object.assign(state.prefs, stored);
  applyPrefs();
}
export const savePrefs = debounce(() => Prefs.set('prefs', { ...state.prefs }), 350);

export function setPref(key, value) {
  state.prefs[key] = value;
  applyPrefs();
  savePrefs();
  bus.emit('prefs', key, value);
}

export function applyPrefs() {
  const root = document.documentElement;
  root.dataset.theme = state.prefs.theme || 'deepslate';
  syncThemeColor('allthesounds:theme');   // the iOS status bar follows the page background
  document.body.dataset.grain = state.prefs.grain ? 'on' : 'off';
  root.dataset.textures = state.prefs.textures === false ? 'off' : 'on';
  if (state.prefs.reduceMotion) root.style.setProperty('--d-base', '0ms');
  else root.style.removeProperty('--d-base');
}

/* ---- Library ------------------------------------------------------------ */
export async function refreshLibrary() {
  state.library = await Projects.list();
  bus.emit('library', state.library);
  return state.library;
}

function indexRecord(project) {
  const s = projectStats(project);
  return {
    id: project.id,
    name: project.name,
    namespace: project.namespace,
    mcVersion: project.mcVersion,
    createdAt: project.createdAt,
    updatedAt: Date.now(),
    events: s.events,
    takes: s.takes,
    seconds: s.seconds,
    byCat: s.byCat,
    doc: projectToJSON(project),
  };
}

export async function saveProject({ silent = false } = {}) {
  if (!state.project) return;
  state.saving = true;
  if (!silent) bus.emit('save:state', 'saving');
  try {
    state.project.updatedAt = Date.now();
    await Projects.save(indexRecord(state.project));
    state.projectDirty = false;
    state.lastSavedAt = Date.now();
    bus.emit('save:state', 'saved');
    bus.emit('project:saved', state.project);
  } catch (e) {
    console.error('save failed', e);
    bus.emit('save:state', 'error', e);
    throw e;
  } finally {
    state.saving = false;
  }
}

export const scheduleSave = debounce(() => { saveProject({ silent: true }).catch(() => {}); }, 900);

function adopt(project) {
  state.project = project;
  state.projectDirty = false;
  state.selTake = null;
  if (!state.selEvent) state.selEvent = Object.keys(project.sounds)[0] || null;
}

export async function openProject(id) {
  const rec = await Projects.get(id);
  if (!rec) throw new Error('That pack is no longer in your library.');
  const p = projectFromJSON(rec.doc);
  p.id = rec.id;
  adopt(p);
  bus.emit('project:open', p);
  await Prefs.set('lastProject', id);
  return p;
}

export async function newProject(opts) {
  const p = createProject(opts);
  adopt(p);
  await saveProject({ silent: true });
  await refreshLibrary();
  bus.emit('project:open', p);
  await Prefs.set('lastProject', p.id);
  return p;
}

export async function adoptProject(project) {
  adopt(project);
  await saveProject({ silent: true });
  await refreshLibrary();
  bus.emit('project:open', project);
  await Prefs.set('lastProject', project.id);
  return project;
}

export async function closeProject() {
  if (state.projectDirty) { try { await saveProject({ silent: true }); } catch {} }
  state.project = null;
  bus.emit('project:close');
  await Prefs.remove('lastProject');
}

export async function deleteProject(id) {
  await Projects.remove(id);
  if (state.project?.id === id) { state.project = null; bus.emit('project:close'); }
  await refreshLibrary();
}

export async function duplicateProject(id) {
  const rec = await Projects.get(id);
  if (!rec) return null;
  const p = projectFromJSON(rec.doc);
  const newId = uid('prj');
  p.id = newId;
  p.name = `${p.name} copy`;
  p.createdAt = Date.now();
  // Clone every asset so the two packs stay independent.
  const assets = await Assets.forProject(id);
  const map = new Map();
  for (const a of assets) {
    const nid = uid('ast');
    map.set(a.id, nid);
    await Assets.put({ ...a, id: nid, projectId: newId });
  }
  for (const e of Object.values(p.sounds)) {
    for (const t of e.takes) {
      t.assetId = map.get(t.assetId) || t.assetId;
      if (t.encoded) t.encoded.assetId = map.get(t.encoded.assetId) || t.encoded.assetId;
    }
  }
  await Projects.save({ ...indexRecord(p), id: newId, createdAt: p.createdAt });
  await refreshLibrary();
  return newId;
}

/* ---- Selection ---------------------------------------------------------- */
export function selectEvent(id, { take = null } = {}) {
  if (state.selEvent === id && take === state.selTake) return;
  state.selEvent = id;
  state.selTake = take;
  bus.emit('select:event', id);
}
export function selectTake(key) {
  state.selTake = key;
  bus.emit('select:take', key);
}

/* ---- Assets ------------------------------------------------------------- */
export async function putAsset(kind, blob, meta = {}) {
  const id = uid('ast');
  await Assets.put({
    id, projectId: state.project.id, kind, blob,
    mime: blob.type, size: blob.size, name: meta.name || '', meta, at: Date.now(),
  });
  return id;
}
export async function getAsset(id) { return id ? Assets.get(id) : null; }

function liveAssetIds(project) {
  const live = [];
  for (const e of Object.values(project.sounds || {})) {
    for (const t of e.takes || []) {
      if (t.assetId) live.push(t.assetId);
      if (t.encoded?.assetId) live.push(t.encoded.assetId);
    }
  }
  return live;
}

/** Remove assets nothing in the project points at any more. */
export async function gcAssets() {
  if (!state.project) return 0;
  return Assets.gc(state.project.id, liveAssetIds(state.project));
}
