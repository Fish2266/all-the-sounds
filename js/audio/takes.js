/* ============================================================================
   Takes — decoding, trimming, rendering, encoding and auditioning.

   What you hear in the app is what ships: a take is played back through the
   same processBuffer() call the exporter uses, so a trim or a fade can never
   sound one way in the browser and another way in the game.
   ========================================================================= */

import {
  audioCtx, decodeToBuffer, processBuffer, computePeaks, encodeOgg, bufferToWav,
} from './engine.js';
import { Assets } from '../core/db.js';
import { bus, getAsset, putAsset } from '../core/store.js';
import { createTake, takeEnd } from '../core/project.js';
import { originalFile } from '../core/gamelink.js';
import { clamp } from '../core/util.js';

/* ---- Small LRU caches --------------------------------------------------- */
function lru(limit) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > limit) m.delete(m.keys().next().value); },
    delete: k => m.delete(k),
  };
}
const sources = lru(64);     // assetId -> decoded source AudioBuffer
const peaks = lru(256);      // assetId -> Float32Array
const originals = lru(64);   // vanilla name -> AudioBuffer

/* ========================================================================= */
/* SOURCES                                                                   */
/* ========================================================================= */

export async function sourceBuffer(take) {
  const hit = sources.get(take.assetId);
  if (hit) return hit;
  const rec = await getAsset(take.assetId);
  if (!rec?.blob) throw new Error('This take’s audio is no longer in this browser.');
  const buf = await decodeToBuffer(rec.blob);
  sources.set(take.assetId, buf);
  return buf;
}

export function takePeaks(take, buffer) {
  let p = peaks.get(take.assetId);
  if (!p && buffer) { p = computePeaks(buffer, 1200); peaks.set(take.assetId, p); }
  return p || null;
}

/**
 * Where the sound actually is. Windowed RMS against a threshold that is
 * either absolute (for a quiet take) or relative to the loudest moment (for a
 * loud one), padded so breaths and tails are not guillotined.
 * Returns { start, end } in seconds; end 0 means "to the end".
 */
export function findSound(buffer, { floorDb = -50, relDb = -34, padStart = 0.03, padEnd = 0.1, win = 0.008 } = {}) {
  const sr = buffer.sampleRate;
  const d = buffer.getChannelData(0);
  const w = Math.max(16, Math.round(sr * win));
  const n = Math.floor(d.length / w);
  if (n < 3) return { start: 0, end: 0 };
  const rms = new Float32Array(n);
  let top = 0;
  for (let b = 0; b < n; b++) {
    let s = 0;
    for (let i = b * w, e = i + w; i < e; i++) s += d[i] * d[i];
    rms[b] = Math.sqrt(s / w);
    if (rms[b] > top) top = rms[b];
  }
  const thr = Math.max(Math.pow(10, floorDb / 20), top * Math.pow(10, relDb / 20));
  let first = -1, last = -1;
  for (let b = 0; b < n; b++) if (rms[b] >= thr) { first = b; break; }
  for (let b = n - 1; b >= 0; b--) if (rms[b] >= thr) { last = b; break; }
  if (first < 0) return { start: 0, end: 0 };
  const dur = buffer.duration;
  const start = clamp(first * win - padStart, 0, dur);
  let end = clamp((last + 1) * win + padEnd, 0, dur);
  if (end - start < 0.04) return { start: 0, end: 0 };
  if (end >= dur - 0.002) end = 0;
  return { start, end };
}

/**
 * Store a new take's source audio and return the take.
 * Microphone captures are kept as 16-bit WAV — lossless, and never compressed
 * twice. Dropped files are kept as they came, which is smaller and just as
 * lossless as they were.
 */
export async function makeTake(buffer, { name, source = 'mic', file = null, autoTrim = true } = {}) {
  const blob = file || bufferToWav(buffer);
  const assetId = await putAsset('audio', blob, { name });
  sources.set(assetId, buffer);
  const t = createTake({
    assetId, name, source,
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
  });
  if (autoTrim) {
    const { start, end } = findSound(buffer);
    t.trimStart = start; t.trimEnd = end;
  }
  return t;
}

export async function takeFromFile(file, opts = {}) {
  const buffer = await decodeToBuffer(file);
  return makeTake(buffer, { name: file.name, source: 'file', file, ...opts });
}

/* ========================================================================= */
/* RENDER & ENCODE                                                           */
/* ========================================================================= */

export function settingsFor(take) {
  return {
    trimStart: take.trimStart || 0,
    trimEnd: take.trimEnd || 0,
    mono: take.mono !== false,
    normalize: !!take.normalize,
    gain: take.gain ?? 1,
    fadeIn: take.fadeIn || 0,
    fadeOut: take.fadeOut || 0,
  };
}

export async function renderTake(take) {
  return processBuffer(await sourceBuffer(take), settingsFor(take));
}

export function signature(take, quality) {
  const s = settingsFor(take);
  return [take.assetId, s.trimStart.toFixed(4), s.trimEnd.toFixed(4), +s.mono, +s.normalize,
    s.gain.toFixed(3), s.fadeIn.toFixed(3), s.fadeOut.toFixed(3), quality].join('|');
}

/** Whether a take already has an up-to-date Ogg waiting. */
export const isEncoded = (take, quality = 4) => take.encoded?.sig === signature(take, quality);

/**
 * The Ogg Vorbis bytes for one take, encoding only if the settings changed
 * since the last time. The previous encode is dropped so edits do not pile up.
 */
export async function encodedBlob(take, quality = 4) {
  const sig = signature(take, quality);
  if (take.encoded?.sig === sig) {
    const rec = await getAsset(take.encoded.assetId);
    if (rec?.blob) return rec.blob;
  }
  const blob = await encodeOgg(await renderTake(take), { quality });
  const old = take.encoded?.assetId;
  take.encoded = { assetId: await putAsset('ogg', blob, { name: `${take.name}.ogg`, encoded: true }), size: blob.size, sig };
  if (old) Assets.remove(old).catch(() => {});
  return blob;
}

/* ========================================================================= */
/* AUDITION                                                                  */
/* One sound at a time, app-wide: starting anything stops whatever was       */
/* playing, the way a sound board behaves. Listeners on 'audition' get       */
/* { id, playing, progress } so any button can show that it is the one.     */
/* ========================================================================= */

let current = null;

export function audition(buffer, { id = 'x', rate = 1, gain = 1, onEnd } = {}) {
  stopAudition();
  const ctx = audioCtx();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(ctx.destination);
  const token = { id, src, startedAt: ctx.currentTime, length: buffer.duration / rate, onEnd, raf: 0 };
  src.onended = () => { if (current === token) finish(token); };
  src.start();
  current = token;
  bus.emit('audition', { id, playing: true, progress: 0 });
  const tick = () => {
    if (current !== token) return;
    const p = clamp((ctx.currentTime - token.startedAt) / token.length, 0, 1);
    bus.emit('audition:tick', { id, progress: p });
    token.raf = requestAnimationFrame(tick);
  };
  token.raf = requestAnimationFrame(tick);
  return token;
}

function finish(token) {
  cancelAnimationFrame(token.raf);
  if (current === token) current = null;
  bus.emit('audition', { id: token.id, playing: false, progress: 1 });
  token.onEnd?.();
}

export function stopAudition() {
  if (!current) return;
  const t = current;
  try { t.src.onended = null; t.src.stop(); } catch {}
  finish(t);
}

export const auditionId = () => current?.id || null;

/** Toggle: play if something else (or nothing) is playing, stop if this is. */
export async function toggleTake(take) {
  const id = `take:${take.key}`;
  if (auditionId() === id) { stopAudition(); return; }
  const buf = await renderTake(take);
  audition(buf, { id, rate: take.pitch || 1, gain: take.volume ?? 1 });
}

/** A vanilla file, played the way the game would: its own volume and pitch. */
export async function playOriginal(entry, { id } = {}) {
  const key = id || `orig:${entry.name}`;
  if (auditionId() === key) { stopAudition(); return; }
  let buf = originals.get(entry.name);
  if (!buf) {
    const f = await originalFile(entry.name);
    if (!f) throw new Error(`${entry.name}.ogg is not in your game folder.`);
    buf = await decodeToBuffer(f);
    originals.set(entry.name, buf);
  }
  audition(buf, { id: key, rate: entry.pitch || 1, gain: Math.min(1, entry.volume ?? 1) });
}

/** For the waveform of an original. */
export async function originalBuffer(name) {
  let buf = originals.get(name);
  if (!buf) {
    const f = await originalFile(name);
    if (!f) return null;
    buf = await decodeToBuffer(f);
    originals.set(name, buf);
  }
  return buf;
}

export { takeEnd };
