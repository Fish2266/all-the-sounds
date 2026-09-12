/* ============================================================================
   Project — the document a sound pack is made of.

   A project is small on purpose: a name, a namespace, a target, and for each
   sound event you have touched, a list of takes. The audio itself lives in the
   assets store (core/db.js), so this record stays cheap to autosave on every
   trim-handle drag.

     project.sounds['entity.cow.ambient'] = {
       mode: 'replace' | 'mix',   // replace the vanilla pool, or join it
       takes: [ take, take, … ],  // the game picks one at random, like vanilla
     }

   A take is non-destructive. The source audio is kept as captured; trim, gain,
   fades and normalising are settings, applied once on the way into the pack.
   ========================================================================= */

import { uid, slugifyNamespace } from './util.js';
import { getVersion, DEFAULT_VERSION } from './versions.js';

export const SCHEMA_VERSION = 1;
export const PROJECT_FILE = '.all-the-sounds/project.json';

/* A few milliseconds of fade either side is inaudible as a fade and removes
   the click a hard trim makes. Normalising is on because a pack that mixes
   one quiet take with one loud one is the first thing anyone notices. */
export const TAKE_DEFAULTS = {
  trimStart: 0, trimEnd: 0,          // seconds into the source; 0 end = the end
  gain: 1,                           // linear, applied after normalising
  normalize: true,                   // to -1 dBFS
  mono: true,                        // positional audio only works on mono
  fadeIn: 0.004, fadeOut: 0.02,
  weight: 1,                         // sounds.json: how often the game picks it
  volume: 1, pitch: 1,               // sounds.json: applied by the game
};

export const NAMESPACE_RE = /^[a-z0-9_.-]+$/;

export function createProject(opts = {}) {
  const now = Date.now();
  const name = (opts.name || 'My sounds').trim();
  return {
    id: uid('prj'),
    schema: SCHEMA_VERSION,
    name,
    namespace: opts.namespace || slugifyNamespace(name, 'sounds'),
    description: opts.description || '',
    mcVersion: opts.mcVersion || DEFAULT_VERSION,
    advanced: {},
    createdAt: now,
    updatedAt: now,
    sounds: {},
  };
}

export function createTake(partial = {}) {
  return { key: uid('tk'), createdAt: Date.now(), ...TAKE_DEFAULTS, ...partial };
}

/** The entry for one event, optionally creating it. */
export function soundEntry(project, id, create = false) {
  let e = project.sounds[id];
  if (!e && create) e = project.sounds[id] = { mode: 'replace', takes: [] };
  return e || null;
}

export const takesFor = (project, id) => project?.sounds?.[id]?.takes || [];
export const hasTakes = (project, id) => takesFor(project, id).length > 0;

export const takeEnd = t => (t.trimEnd > 0 ? t.trimEnd : t.durationSec || 0);
export const takeLength = t => Math.max(0, takeEnd(t) - (t.trimStart || 0));

/** Every event id that has at least one take, sorted. */
export function recordedIds(project) {
  return Object.keys(project?.sounds || {}).filter(id => project.sounds[id].takes?.length).sort();
}

export function projectStats(project) {
  let events = 0, takes = 0, seconds = 0;
  const byCat = {};
  for (const [id, e] of Object.entries(project?.sounds || {})) {
    if (!e.takes?.length) continue;
    events++;
    takes += e.takes.length;
    for (const t of e.takes) seconds += takeLength(t);
    const cat = id.split('.')[0];
    byCat[cat] = (byCat[cat] || 0) + 1;
  }
  return { events, takes, seconds, byCat };
}

/* ---- Pack formats ------------------------------------------------------- */
export function packFormats(project) {
  const v = getVersion(project.mcVersion);
  const a = project.advanced || {};
  const resource = a.resourceFormat ?? v.resource;
  return {
    resource,
    resourceMax: a.resourceMaxFormat ?? resource,
    rangeShape: !!v.range,
    declareRange: a.declareRange !== false,
    verified: v.verified && !a.resourceFormat,
  };
}

/* ---- Validation --------------------------------------------------------- */
/** { errors: [], warnings: [] }, each entry { field, message, eventId? }. */
export function validateProject(project) {
  const errors = [], warnings = [];
  if (!project.name?.trim()) errors.push({ field: 'name', message: 'The pack needs a name.' });
  if (!NAMESPACE_RE.test(project.namespace || '')) {
    errors.push({ field: 'namespace', message: 'The namespace can only use a–z, 0–9, _ . and -.' });
  } else if (project.namespace === 'minecraft') {
    // The replacement files would share a folder with the game's own. Nothing
    // collides today, but it is one rename away from overwriting a real sound.
    errors.push({ field: 'namespace', message: 'Pick your own namespace — "minecraft" belongs to the game. Your sounds.json still goes there; only your files need a home of their own.' });
  }

  const stats = projectStats(project);
  if (!stats.events) warnings.push({ field: 'sounds', message: 'Nothing is recorded yet, so the pack would change nothing.' });

  for (const [id, e] of Object.entries(project.sounds || {})) {
    for (const t of e.takes || []) {
      if (t.mono === false) {
        warnings.push({ field: 'mono', eventId: id, message: `${id}: a stereo take plays flat, ignoring where it happens in the world.` });
      }
      if (takeLength(t) < 0.02) {
        warnings.push({ field: 'trim', eventId: id, message: `${id}: one take is trimmed to almost nothing.` });
      }
    }
  }
  return { errors, warnings };
}

/* ---- Serialisation ------------------------------------------------------ */
export function projectToJSON(project) {
  return JSON.parse(JSON.stringify({ ...project, schema: SCHEMA_VERSION }));
}

export function projectFromJSON(j) {
  return migrate(JSON.parse(JSON.stringify(j)));
}

export function migrate(p) {
  p.schema = SCHEMA_VERSION;
  p.sounds = p.sounds || {};
  p.advanced = p.advanced || {};
  p.mcVersion = p.mcVersion || DEFAULT_VERSION;
  for (const e of Object.values(p.sounds)) {
    e.mode = e.mode === 'mix' ? 'mix' : 'replace';
    e.takes = (e.takes || []).map(t => ({ ...TAKE_DEFAULTS, ...t }));
  }
  return p;
}
