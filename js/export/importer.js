/* ============================================================================
   Importer — zips back into projects.

   A pack exported from here carries .all-the-sounds/project.json and reopens
   exactly. A sound pack made anywhere else is read the two ways such packs
   are made:

     • through assets/minecraft/sounds.json, which names the files each event
       plays — the careful way, and the one this app writes;
     • by dropping .ogg files straight over vanilla paths, e.g.
       assets/minecraft/sounds/mob/cow/say1.ogg — the quick way, which the
       sound list maps back to every event that plays that file.

   An imported take is already processed audio, so it arrives with its trim,
   gain and fades reset — nothing gets applied twice — and with its Ogg kept
   as the encode, so exporting again does not re-compress it.
   ========================================================================= */

import { unzip, jsonOf } from './zip.js';
import { Assets } from '../core/db.js';
import { decodeToBuffer } from '../audio/engine.js';
import { createProject, createTake, projectFromJSON, PROJECT_FILE, TAKE_DEFAULTS } from '../core/project.js';
import { uid } from '../core/util.js';
import { soundList, resolveEntries } from '../core/soundlist.js';
import { signature } from '../audio/takes.js';
import { state } from '../core/store.js';

/** Packs are sometimes zipped with their folder around them. */
function findRoot(files) {
  let best = null;
  for (const p of files.keys()) {
    if (!p.endsWith('pack.mcmeta')) continue;
    const root = p.slice(0, -'pack.mcmeta'.length);
    if (best == null || root.length < best.length) best = root;
  }
  return best ?? '';
}

function oggPath(name) {
  const [ns, path] = name.includes(':') ? name.split(':') : ['minecraft', name];
  return `assets/${ns}/sounds/${path}.ogg`;
}

export async function importPack(file, onProgress = () => {}) {
  onProgress('Opening the zip…', 0.05);
  const files = await unzip(file, { onProgress: p => onProgress('Reading the zip…', 0.05 + p * 0.3) });
  const root = findRoot(files);
  const get = p => files.get(root + p) || null;

  const meta = jsonOf(get(PROJECT_FILE));
  const jobs = [];   // { id, path, take }
  let project;

  if (meta?.project) {
    project = projectFromJSON(meta.project);
    for (const [id, e] of Object.entries(project.sounds)) {
      for (const t of e.takes) jobs.push({ id, path: t.file, take: t });
      e.takes = [];
    }
  } else {
    const name = file.name.replace(/\.zip$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported sounds';
    project = createProject({ name, mcVersion: state.project?.mcVersion });

    // 1 — sounds.json
    const sj = jsonOf(get('assets/minecraft/sounds.json')) || {};
    for (const [id, def] of Object.entries(sj)) {
      const found = [];
      for (const e of def?.sounds || []) {
        const o = typeof e === 'string' ? { name: e } : e;
        if (!o?.name || o.type === 'event') continue;
        const path = oggPath(o.name);
        if (!get(path)) continue;
        found.push({ id, path, take: { name: o.name.split('/').pop(), weight: o.weight ?? 1, volume: o.volume ?? 1, pitch: o.pitch ?? 1 } });
      }
      if (found.length) {
        project.sounds[id] = { mode: def.replace ? 'replace' : 'mix', takes: [] };
        jobs.push(...found);
      }
    }

    // 2 — files dropped over vanilla paths that sounds.json did not claim
    const claimed = new Set(jobs.map(j => j.path));
    const byFile = new Map();
    for (const ev of soundList()) {
      for (const e of resolveEntries(ev)) {
        if (e.via) continue;
        if (!byFile.has(e.name)) byFile.set(e.name, []);
        byFile.get(e.name).push(ev.id);
      }
    }
    const overwritten = new Map();   // event id -> count of its files replaced
    for (const key of files.keys()) {
      const rel = key.slice(root.length);
      const m = rel.match(/^assets\/minecraft\/sounds\/(.+)\.ogg$/);
      if (!m || claimed.has(rel)) continue;
      for (const id of byFile.get(m[1]) || []) {
        if (!project.sounds[id]) project.sounds[id] = { mode: 'mix', takes: [] };
        overwritten.set(id, (overwritten.get(id) || 0) + 1);
        jobs.push({ id, path: rel, take: { name: m[1].split('/').pop() } });
      }
    }
    // Where every one of an event's files was replaced, nothing vanilla is
    // left in its pool — so it is a replacement, not a mix.
    for (const [id, n] of overwritten) {
      const ev = soundList().find(e => e.id === id);
      if (ev && n >= resolveEntries(ev).filter(e => !e.via).length) project.sounds[id].mode = 'replace';
    }
  }

  project.id = uid('prj');
  project.createdAt = Date.now();

  // Decode and store each file once, however many events share it.
  const quality = state.prefs.quality ?? 4;
  const byPath = new Map();
  let missing = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    onProgress(`Reading ${job.path.split('/').pop()}…`, 0.35 + (i / Math.max(1, jobs.length)) * 0.6);
    let asset = byPath.get(job.path);
    if (!asset) {
      const bytes = get(job.path);
      if (!bytes) { missing++; continue; }
      const blob = new Blob([bytes], { type: 'audio/ogg' });
      let buffer;
      try { buffer = await decodeToBuffer(blob); } catch { missing++; continue; }
      const id = uid('ast');
      await Assets.put({
        id, projectId: project.id, kind: 'audio', blob,
        mime: blob.type, size: blob.size, name: job.path.split('/').pop(), meta: { imported: true }, at: Date.now(),
      });
      asset = { id, size: blob.size, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
      byPath.set(job.path, asset);
    }
    const t = createTake({
      ...job.take,
      // Already processed: start from neutral so nothing is applied twice.
      trimStart: 0, trimEnd: 0, gain: 1, normalize: false, fadeIn: 0, fadeOut: 0,
      mono: asset.channels === 1 ? true : (job.take.mono ?? TAKE_DEFAULTS.mono),
      key: uid('tk'),
      assetId: asset.id, source: 'import',
      durationSec: asset.duration, sampleRate: asset.sampleRate, channels: asset.channels,
    });
    delete t.file;
    t.encoded = { assetId: asset.id, size: asset.size, sig: signature(t, quality) };
    project.sounds[job.id] = project.sounds[job.id] || { mode: 'replace', takes: [] };
    project.sounds[job.id].takes.push(t);
  }
  for (const [id, e] of Object.entries(project.sounds)) if (!e.takes.length) delete project.sounds[id];

  const events = Object.keys(project.sounds).length;
  const takes = Object.values(project.sounds).reduce((n, e) => n + e.takes.length, 0);
  if (!takes) throw new Error('No sounds were found in that zip. It needs .ogg files under assets/…/sounds, named by its sounds.json or sitting over vanilla paths.');
  onProgress('Done', 1);
  return { project, stats: { events, takes, missing, source: meta ? 'project' : 'reverse' } };
}
