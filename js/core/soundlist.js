/* ============================================================================
   The sound list — every sound event in the game.

   Two sources, one shape:
     • The bundled list (js/data/sounds.json), read out of the 26.2 client by
       scripts/build-sounds-data.py. Names, subtitles and the vanilla `sounds`
       arrays only; not a byte of audio.
     • Your own game, once a game folder is linked. Its sounds.json is the
       authority for the version you actually play, snapshots included, so the
       list cannot go stale.

   An event is the thing the game plays — `entity.cow.ambient` — and each one
   points at one or more files, of which the game picks one at random. That is
   the unit this app works in: you record takes for an event, and the game
   picks among your takes exactly the way it picked among Mojang's.
   ========================================================================= */

import { bus } from './store.js';

/* Each category wears one colour from the shared ore palette, the same in the
   sidebar and on the pack art, so the colour alone says which bar is which.
   `light` is the same ore a few steps deeper, for the Bone theme: iron and
   gold at their dark-theme brightness all but vanish on paper. */
export const CATEGORIES = [
  { id: 'entity',     label: 'Mobs & entities', color: '#3FD98B', light: '#149E5C' },   // emerald
  { id: 'block',      label: 'Blocks',          color: '#E0784A', light: '#C4592C' },   // copper
  { id: 'item',       label: 'Items',           color: '#F2B33D', light: '#C98A14' },   // gold
  { id: 'ambient',    label: 'Ambient',         color: '#4FD8DE', light: '#1E9AA3' },   // diamond
  { id: 'music',      label: 'Music',           color: '#B084F5', light: '#7B45CE' },   // amethyst
  { id: 'music_disc', label: 'Music discs',     color: '#F05C48', light: '#C9331F' },   // redstone
  { id: 'weather',    label: 'Weather',         color: '#5B7CE8', light: '#3D5FCC' },   // lapis
  { id: 'ui',         label: 'Interface',       color: '#C8D2DA', light: '#6E7A85' },   // iron
  { id: 'other',      label: 'Everything else', color: '#B99A62', light: '#8A6A3C' },   // oak
];
const CAT_IDS = new Set(CATEGORIES.map(c => c.id));
export const categoryLabel = id => CATEGORIES.find(c => c.id === id)?.label || id;

const S = {
  base: null,          // the bundled file, as loaded
  game: null,          // the linked game's list, when there is one
  list: [],
  byId: new Map(),
  version: null,
  source: 'bundled',
};

/* ---- Loading ------------------------------------------------------------ */
export async function loadSoundList() {
  const res = await fetch(new URL('../data/sounds.json', import.meta.url));
  if (!res.ok) throw new Error(`The sound list could not be loaded (HTTP ${res.status}).`);
  S.base = await res.json();
  rebuild();
}

/** Swap in the linked game's own list, or pass null to go back to the bundled one. */
export function useGameList(game) {
  S.game = game?.events ? game : null;
  rebuild();
  bus.emit('sounds:list');
}

function rebuild() {
  let rows;
  if (S.game) {
    // Subtitle strings live in the jar; when a snapshot adds an event the jar
    // was not read for, the bundled strings are the next best source.
    const bundled = new Map(S.base.events.filter(e => e.key).map(e => [e.key, e.sub]));
    rows = Object.entries(S.game.events).map(([id, v]) => {
      const key = v.subtitle || null;
      return { id, key, sub: (key && (S.game.subtitles?.[key] || bundled.get(key))) || null, s: v.sounds || [] };
    });
    S.version = S.game.version;
    S.source = 'game';
  } else {
    rows = S.base.events.map(e => ({ ...e }));
    S.version = S.base.version;
    S.source = 'bundled';
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const r of rows) decorate(r);
  S.list = rows;
  S.byId = new Map(rows.map(r => [r.id, r]));
}

/* ---- Names -------------------------------------------------------------- */
const humanize = s => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function decorate(ev) {
  const parts = ev.id.split('.');
  ev.cat = CAT_IDS.has(parts[0]) ? parts[0] : 'other';
  ev.group = ev.cat === 'music_disc' ? 'disc'
    : ev.cat === 'other' ? parts[0]
    : parts[1] || parts[0];
  ev.groupLabel = ev.cat === 'music_disc' ? 'Music discs' : humanize(ev.group);
  // Subtitles are what the game itself calls a sound, so they win. Music,
  // discs and ambience have none, and their ids read well enough humanised.
  ev.label = ev.sub || parts.slice(1).map(humanize).join(' · ') || humanize(ev.id);
  ev.hay = `${ev.label} ${ev.id.replace(/[._]/g, ' ')} ${ev.groupLabel} ${ev.id}`.toLowerCase();
  return ev;
}

/** An event a project has takes for that the current list does not know —
 *  from a newer version, or a list swapped out underneath it. Never dropped. */
export function orphanEvent(id) {
  return decorate({ id, key: null, sub: null, s: [], orphan: true });
}

/* ---- Access ------------------------------------------------------------- */
export const soundList = () => S.list;
export const getEvent = id => S.byId.get(id) || null;
export const eventOrOrphan = id => S.byId.get(id) || orphanEvent(id);
export function listMeta() {
  return {
    version: S.version,
    source: S.source,
    count: S.list.length,
    snapshot: S.source === 'bundled' ? S.base?.snapshot : null,
  };
}

/**
 * The files an event can play, flattened. Some vanilla entries point at
 * another event rather than a file (`"type": "event"`); those are followed, so
 * a note block imitating a creeper lists the creeper's own files.
 */
export function resolveEntries(ev, depth = 0, seen = new Set()) {
  const out = [];
  if (!ev || seen.has(ev.id)) return out;
  seen.add(ev.id);
  for (const e of ev.s || []) {
    const entry = typeof e === 'string' ? { name: e } : { ...e };
    if (entry.type === 'event') {
      const ref = getEvent(String(entry.name).replace(/^minecraft:/, ''));
      if (ref && depth < 4) {
        for (const sub of resolveEntries(ref, depth + 1, seen)) out.push({ ...sub, via: ref.id });
      }
      continue;
    }
    entry.name = String(entry.name).replace(/^minecraft:/, '');
    out.push(entry);
  }
  return out;
}

export const variantCount = ev => resolveEntries(ev).length;

/** Long sounds (music, discs, some ambience) are streamed rather than loaded
 *  whole; a replacement should be too. */
export const isStreamed = ev => resolveEntries(ev).some(e => e.stream);

/**
 * The volume the vanilla files are played at (the median, so one odd entry
 * does not skew it). A new take starts there, so a normalised recording lands
 * at the loudness the game meant for this sound rather than at full scale.
 */
export function typicalVolume(ev) {
  const v = resolveEntries(ev).map(e => e.volume ?? 1).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 1;
}

/** The attenuation distance every vanilla file agrees on, if they agree. */
export function sharedAttenuation(ev) {
  const vals = resolveEntries(ev).map(e => e.attenuation_distance);
  if (!vals.length || vals.some(v => v == null)) return null;
  return vals.every(v => v === vals[0]) ? vals[0] : null;
}

/* ---- Search ------------------------------------------------------------- */
/**
 * @param {string} q
 * @param {object} o { cat, filter(ev) }
 */
export function searchEvents(q, { cat = 'all', filter = null } = {}) {
  const query = q.trim().toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const rows = [];
  for (const ev of S.list) {
    if (cat !== 'all' && ev.cat !== cat) continue;
    if (filter && !filter(ev)) continue;
    if (tokens.length && !tokens.every(t => ev.hay.includes(t))) continue;
    rows.push(ev);
  }
  if (!tokens.length) return rows;
  const score = ev => {
    const label = ev.label.toLowerCase();
    if (ev.id === query) return 1000;
    if (ev.id.startsWith(query)) return 600;
    if (label === query) return 500;
    if (label.startsWith(query)) return 300;
    if (ev.group === tokens[0]) return 200;
    return 10;
  };
  return rows.map(ev => [score(ev), ev]).sort((a, b) => b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1)).map(x => x[1]);
}
