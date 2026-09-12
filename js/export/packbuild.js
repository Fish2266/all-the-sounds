/* ============================================================================
   Pack builder — one resource pack.

   A sound pack needs no data pack at all: replacing a sound is purely a
   resource-pack job. What lands in the zip:

     <namespace>_sounds.zip
     ├── pack.mcmeta
     ├── pack.png
     ├── assets/minecraft/sounds.json        one entry per sound you recorded
     ├── assets/<ns>/sounds/entity/cow/ambient/1.ogg
     ├── assets/<ns>/sounds/entity/cow/ambient/2.ogg
     ├── …
     └── .all-the-sounds/project.json        so the zip reopens here exactly

   Each entry in sounds.json is `"replace": true` (or false, to mix with the
   originals) and restates the vanilla subtitle key — because replacing an
   event throws its old registration away, subtitle included, and a pack that
   quietly deletes every subtitle it touches is a pack with a bug in it.
   ========================================================================= */

import { ZipWriter } from './zip.js';
import { formatValue } from '../core/versions.js';
import { packFormats, projectToJSON, PROJECT_FILE, SCHEMA_VERSION, recordedIds, takeLength } from '../core/project.js';
import { eventOrOrphan, isStreamed, sharedAttenuation } from '../core/soundlist.js';
import { encodedBlob, isEncoded } from '../audio/takes.js';
import { estimateOggBytes, loadEncoder } from '../audio/engine.js';
import { drawMark } from '../ui/brandmark.js';

export const packFilename = p => `${p.namespace || 'sounds'}_sounds.zip`;

/* entity.cow.ambient → entity/cow/ambient, so the files sort the way the list does. */
const soundPath = id => id.replace(/\./g, '/');
export const takeFile = (project, id, i) => `assets/${project.namespace}/sounds/${soundPath(id)}/${i + 1}.ogg`;
export const takeName = (project, id, i) => `${project.namespace}:${soundPath(id)}/${i + 1}`;

const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;

/** The sounds.json entry for one event, exactly as it is written. */
export function eventEntry(project, id) {
  const entry = project.sounds[id];
  const ev = eventOrOrphan(id);
  const stream = isStreamed(ev);
  const att = sharedAttenuation(ev);
  const out = {};
  if (entry.mode !== 'mix') out.replace = true;
  if (ev.key) out.subtitle = ev.key;
  out.sounds = entry.takes.map((t, i) => {
    const s = { name: takeName(project, id, i) };
    if ((t.volume ?? 1) !== 1) s.volume = round(t.volume);
    if ((t.pitch ?? 1) !== 1) s.pitch = round(t.pitch);
    if ((t.weight ?? 1) !== 1) s.weight = t.weight;
    // Long sounds stream from disk in vanilla; a replacement should too.
    if (stream) s.stream = true;
    // A ghast is heard from further away than a chicken; keep it that way.
    if (att != null) s.attenuation_distance = att;
    return Object.keys(s).length === 1 ? s.name : s;
  });
  return out;
}

export function soundsJson(project) {
  const out = {};
  for (const id of recordedIds(project)) out[id] = eventEntry(project, id);
  return out;
}

/* ---- pack.mcmeta -------------------------------------------------------- */
export function mcmetaJSON(project) {
  const fmt = packFormats(project);
  const desc = (project.description || '').trim();
  const n = recordedIds(project).length;
  const pack = {
    description: [
      { text: project.name, color: 'white', bold: true },
      { text: '  Sounds\n', color: 'dark_gray', bold: false },
      { text: desc.slice(0, 120) || `${n} ${n === 1 ? 'sound' : 'sounds'} recorded by hand`, color: 'gray' },
    ],
  };
  if (fmt.rangeShape) {
    pack.min_format = formatValue(fmt.resource, { bound: 'min' });
    pack.max_format = formatValue(fmt.declareRange ? fmt.resourceMax : fmt.resource, { bound: 'max' });
  } else {
    const major = Array.isArray(fmt.resource) ? fmt.resource[0] : fmt.resource;
    pack.pack_format = major;
    if (fmt.declareRange) {
      const maxMajor = Array.isArray(fmt.resourceMax) ? fmt.resourceMax[0] : fmt.resourceMax;
      pack.supported_formats = { min_inclusive: major, max_inclusive: Math.max(major, maxMajor) };
    }
  }
  return JSON.stringify({ pack }, null, 2) + '\n';
}

async function packIcon() {
  const c = document.createElement('canvas');
  drawMark(c, 128);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

/** The editable project, with each take pointing at its file in the zip. */
function projectFile(project) {
  const doc = projectToJSON(project);
  for (const [id, e] of Object.entries(doc.sounds)) {
    if (!e.takes?.length) { delete doc.sounds[id]; continue; }
    e.takes = e.takes.map((t, i) => {
      const { assetId, encoded, ...rest } = t;
      return { ...rest, file: takeFile(project, id, i) };
    });
  }
  return { app: 'All The Sounds', format: SCHEMA_VERSION, exportedAt: new Date().toISOString(), project: doc };
}

/* ---- Preview ------------------------------------------------------------ */
/**
 * Every file the zip will hold, with sizes: exact where a take has already
 * been encoded at this quality, estimated where it has not. Vorbis carries a
 * few kilobytes of codebooks in every file, which is most of a short sound.
 */
export function packPlan(project, { quality = 4 } = {}) {
  const sj = JSON.stringify(soundsJson(project), null, 2);
  const rows = [
    { path: 'pack.mcmeta', size: mcmetaJSON(project).length },
    { path: 'pack.png', size: 900 },
    { path: 'assets/minecraft/sounds.json', size: sj.length + 1 },
  ];
  let bytes = 0, takes = 0;
  const ids = recordedIds(project);
  for (const id of ids) {
    project.sounds[id].takes.forEach((t, i) => {
      const exact = isEncoded(t, quality);
      const size = exact ? t.encoded.size
        : 3800 + estimateOggBytes(takeLength(t), t.mono === false ? 2 : 1, quality);
      rows.push({ path: takeFile(project, id, i), size, estimated: !exact });
      bytes += size;
      takes++;
    });
  }
  rows.push({ path: PROJECT_FILE, size: JSON.stringify(projectFile(project)).length });
  return { rows, bytes, takes, events: ids.length };
}

/* ---- Build -------------------------------------------------------------- */
/**
 * @returns {Promise<{ blob, filename, takes, encoded }>}
 *   `encoded` counts the takes that needed a fresh Vorbis pass; the rest were
 *   remembered from an earlier build.
 */
export async function buildPack(project, { quality = 4, onProgress = () => {} } = {}) {
  const ids = recordedIds(project);
  const total = ids.reduce((n, id) => n + project.sounds[id].takes.length, 0);
  if (!total) throw new Error('Nothing is recorded yet.');

  onProgress(0.02, 'Loading the Ogg encoder…');
  await loadEncoder();

  const zip = new ZipWriter({ comment: `${project.name} — made with All The Sounds` });
  zip.file('pack.mcmeta', mcmetaJSON(project));
  zip.file('pack.png', await packIcon());
  zip.json('assets/minecraft/sounds.json', soundsJson(project));

  let done = 0, encoded = 0;
  for (const id of ids) {
    const takes = project.sounds[id].takes;
    for (let i = 0; i < takes.length; i++) {
      const t = takes[i];
      if (!isEncoded(t, quality)) encoded++;
      onProgress(0.05 + (done / total) * 0.83, `Encoding ${id}${takes.length > 1 ? ` · take ${i + 1}` : ''}`);
      const blob = await encodedBlob(t, quality);
      // Vorbis is already compressed; deflating it again only costs time.
      zip.file(takeFile(project, id, i), blob, { store: true });
      done++;
    }
  }
  zip.json(PROJECT_FILE, projectFile(project));

  zip.onProgress = (d, n) => onProgress(0.9 + (d / n) * 0.1, 'Writing the zip…');
  const blob = await zip.blob();
  onProgress(1, 'Done');
  return { blob, filename: packFilename(project), takes: total, encoded };
}
