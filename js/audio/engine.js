/* ============================================================================
   Audio engine — decode, analyse, process, play, and encode to Ogg Vorbis.

   Minecraft only reads Ogg Vorbis, and no browser can encode it natively, so
   the tool ships libvorbis compiled to WebAssembly (@audio/encode-ogg, MIT) in
   vendor/. If that file is ever missing the loader falls back to a one-time
   fetch that gets cached in IndexedDB, and failing that the app still accepts
   .ogg files directly — so the pack pipeline never hard-stops on audio.
   ========================================================================= */

import { Cache } from '../core/db.js';
import { clamp } from '../core/util.js';

const ENCODER_LOCAL = '../../vendor/ogg-encode.js';
const ENCODER_CDN   = 'https://cdn.jsdelivr.net/npm/@audio/encode-ogg@1.2.2/ogg-encode.js';
const ENCODER_CACHE_KEY = 'ogg-encode@1.2.2';

/* ---- Shared AudioContext ------------------------------------------------ */
let _ctx = null;
export function audioCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

/* ========================================================================= */
/* ENCODER LOADING                                                           */
/* ========================================================================= */

export const encoderStatus = { state: 'idle', error: null, source: null };
let _encoderFn = null;
let _loading = null;

export async function loadEncoder({ allowNetwork = true } = {}) {
  if (_encoderFn) return _encoderFn;
  if (_loading) return _loading;

  _loading = (async () => {
    encoderStatus.state = 'loading';
    /* 1 — the bundled copy */
    try {
      const m = await import(/* @vite-ignore */ ENCODER_LOCAL);
      _encoderFn = m.default || m.ogg;
      if (_encoderFn) { encoderStatus.state = 'ready'; encoderStatus.source = 'bundled'; return _encoderFn; }
    } catch (e) { console.info('[audio] bundled encoder unavailable:', e.message); }

    /* 2 — a copy cached from a previous run */
    try {
      const cached = await Cache.get(ENCODER_CACHE_KEY);
      if (cached) {
        const url = URL.createObjectURL(new Blob([cached], { type: 'text/javascript' }));
        const m = await import(/* @vite-ignore */ url);
        URL.revokeObjectURL(url);
        _encoderFn = m.default || m.ogg;
        if (_encoderFn) { encoderStatus.state = 'ready'; encoderStatus.source = 'cached'; return _encoderFn; }
      }
    } catch (e) { console.info('[audio] cached encoder unusable:', e.message); }

    /* 3 — fetch once, then cache */
    if (allowNetwork) {
      try {
        const res = await fetch(ENCODER_CDN, { mode: 'cors' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const src = await res.text();
        await Cache.set(ENCODER_CACHE_KEY, src);
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        const m = await import(/* @vite-ignore */ url);
        URL.revokeObjectURL(url);
        _encoderFn = m.default || m.ogg;
        if (_encoderFn) { encoderStatus.state = 'ready'; encoderStatus.source = 'network'; return _encoderFn; }
      } catch (e) {
        encoderStatus.state = 'error';
        encoderStatus.error = e.message;
        throw new Error(`The Ogg encoder could not be loaded (${e.message}). You can still import .ogg files directly.`);
      }
    }
    encoderStatus.state = 'error';
    encoderStatus.error = 'not available';
    throw new Error('The Ogg encoder is not available.');
  })();

  try { return await _loading; } finally { _loading = null; }
}

export function encoderReady() { return encoderStatus.state === 'ready'; }

/* ========================================================================= */
/* DECODE & ANALYSE                                                          */
/* ========================================================================= */

/** Decode any browser-supported audio file into an AudioBuffer. */
export async function decodeToBuffer(blobOrBuffer) {
  const ab = blobOrBuffer instanceof ArrayBuffer ? blobOrBuffer : await blobOrBuffer.arrayBuffer();
  const ctx = audioCtx();
  return new Promise((res, rej) => {
    // The callback form keeps Safari happy with a detached ArrayBuffer.
    const p = ctx.decodeAudioData(ab.slice(0), res, err => rej(err || new Error('Could not decode that audio file.')));
    if (p?.then) p.then(res, e => rej(e || new Error('Could not decode that audio file.')));
  });
}

/** Peaks for the waveform: interleaved [min,max] pairs per bucket. */
export function computePeaks(buffer, buckets = 2048) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const step = Math.max(1, Math.floor(len / buckets));
  const n = Math.ceil(len / step);
  const out = new Float32Array(n * 2);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));

  for (let b = 0; b < n; b++) {
    const start = b * step, end = Math.min(len, start + step);
    let mn = 1, mx = -1;
    for (let i = start; i < end; i++) {
      let v = 0;
      for (let c = 0; c < ch; c++) v += chans[c][i];
      v /= ch;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn > mx) { mn = 0; mx = 0; }
    out[b * 2] = mn; out[b * 2 + 1] = mx;
  }
  return out;
}

/** Everything the disc record needs to know about a source file. */
export async function analyseAudio(blob) {
  const buffer = await decodeToBuffer(blob);
  return {
    buffer,
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    peaks: computePeaks(buffer),
  };
}

/* ========================================================================= */
/* PROCESSING                                                                */
/* ========================================================================= */

/**
 * Apply the disc's audio settings and return a new AudioBuffer.
 * Order matters: trim, then mono fold, then normalise, then gain, then fades —
 * so a fade always lands on the final level rather than being scaled after.
 */
export function processBuffer(buffer, settings = {}) {
  const {
    trimStart = 0, trimEnd = 0, mono = true, normalize = false,
    gain = 1, fadeIn = 0, fadeOut = 0,
  } = settings;

  const sr = buffer.sampleRate;
  const startS = clamp(Math.floor(trimStart * sr), 0, buffer.length);
  const endS = clamp(trimEnd > 0 ? Math.floor(trimEnd * sr) : buffer.length, startS + 1, buffer.length);
  const len = endS - startS;
  const outCh = mono ? 1 : buffer.numberOfChannels;

  const ctx = audioCtx();
  const out = ctx.createBuffer(outCh, len, sr);

  if (mono && buffer.numberOfChannels > 1) {
    const dst = out.getChannelData(0);
    const srcs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) srcs.push(buffer.getChannelData(c));
    const inv = 1 / buffer.numberOfChannels;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let c = 0; c < srcs.length; c++) v += srcs[c][startS + i];
      dst[i] = v * inv;
    }
  } else {
    for (let c = 0; c < outCh; c++) {
      out.getChannelData(c).set(buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1)).subarray(startS, endS));
    }
  }

  /* Normalise to -1 dBFS across all channels. */
  let scale = gain;
  if (normalize) {
    let peak = 0;
    for (let c = 0; c < outCh; c++) {
      const d = out.getChannelData(c);
      for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    }
    if (peak > 0.0001) scale *= (0.891 / peak);   // -1 dBFS
  }

  const fadeInS = clamp(Math.floor(fadeIn * sr), 0, len);
  const fadeOutS = clamp(Math.floor(fadeOut * sr), 0, len - fadeInS);

  for (let c = 0; c < outCh; c++) {
    const d = out.getChannelData(c);
    if (scale !== 1) for (let i = 0; i < len; i++) d[i] *= scale;
    for (let i = 0; i < fadeInS; i++) d[i] *= (i / fadeInS);
    for (let i = 0; i < fadeOutS; i++) {
      const idx = len - 1 - i;
      if (idx >= 0) d[idx] *= (i / fadeOutS);
    }
    // Hard clip guard so an aggressive gain never wraps.
    for (let i = 0; i < len; i++) { if (d[i] > 1) d[i] = 1; else if (d[i] < -1) d[i] = -1; }
  }
  return out;
}

/* ========================================================================= */
/* ENCODE                                                                    */
/* ========================================================================= */

/**
 * AudioBuffer -> Ogg Vorbis Blob.
 * @param {AudioBuffer} buffer
 * @param {object} opts { quality (-1..10), onProgress(0..1) }
 */
export async function encodeOgg(buffer, opts = {}) {
  const ogg = await loadEncoder();
  const quality = clamp(opts.quality ?? 4, -1, 10);
  const enc = await ogg({
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    quality,
  });

  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));

  /* Big chunks keep the WASM call count down; yielding on a fixed wall-clock
     budget rather than a fixed chunk count keeps the UI responsive on slow
     machines without throttling fast ones. */
  const CHUNK = 32768;
  const parts = [];
  let lastYield = performance.now();
  for (let off = 0; off < buffer.length; off += CHUNK) {
    const n = Math.min(CHUNK, buffer.length - off);
    const slice = chans.map(ch => ch.subarray(off, off + n));
    const bytes = enc.encode(slice);
    if (bytes?.length) parts.push(bytes.slice());
    const now = performance.now();
    if (now - lastYield > 40) {
      lastYield = now;
      opts.onProgress?.(off / buffer.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  const tail = enc.flush();
  if (tail?.length) parts.push(tail.slice());
  enc.free?.();
  opts.onProgress?.(1);

  return new Blob(parts, { type: 'audio/ogg' });
}

/** Rough size prediction so the UI can show a number before encoding. */
export function estimateOggBytes(seconds, channels, quality) {
  const kbps = [45, 60, 70, 80, 96, 112, 128, 160, 192, 224, 256, 320][clamp(Math.round(quality) + 1, 0, 11)];
  return Math.round((kbps * 1000 / 8) * seconds * (channels > 1 ? 1.0 : 0.62));
}

export const QUALITY_STEPS = [
  { q: 0,  label: 'Small',    hint: '~64 kbps mono — fine for loops and ambience' },
  { q: 2,  label: 'Light',    hint: '~80 kbps mono' },
  { q: 4,  label: 'Standard', hint: '~96 kbps mono — the sweet spot for discs' },
  { q: 6,  label: 'High',     hint: '~128 kbps' },
  { q: 8,  label: 'Very high',hint: '~192 kbps — noticeably larger files' },
];

/* ========================================================================= */
/* PLAYBACK                                                                  */
/* ========================================================================= */

export class Player {
  constructor() {
    this.buffer = null; this.source = null; this.gainNode = null;
    this.startedAt = 0; this.offset = 0; this.playing = false;
    this.loop = false; this.onEnd = null; this.onTick = null;
    this._raf = null; this.region = null;   // [start, end] seconds
  }
  load(buffer) { this.stop(); this.buffer = buffer; this.offset = 0; return this; }

  play(from = null) {
    if (!this.buffer) return;
    const ctx = audioCtx();
    this.stop(true);
    const [rs, re] = this.region || [0, this.buffer.duration];
    let off = from != null ? from : this.offset;
    if (off < rs || off >= re) off = rs;

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g).connect(ctx.destination);

    src.onended = () => {
      if (!this.playing) return;
      if (this.loop) { this.offset = rs; this.play(rs); }
      else { this.playing = false; this.offset = rs; this._stopTick(); this.onEnd?.(); }
    };
    src.start(0, off, Math.max(0.01, re - off));
    this.source = src; this.gainNode = g;
    this.startedAt = ctx.currentTime - (off - rs);
    this.offset = off;
    this.playing = true;
    this._startTick();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.currentTime;
    this.stop(true);
  }
  toggle() { this.playing ? this.pause() : this.play(); }

  stop(keepOffset = false) {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch {}
      this.source.disconnect(); this.source = null;
    }
    this.playing = false;
    this._stopTick();
    if (!keepOffset) this.offset = this.region ? this.region[0] : 0;
  }

  seek(t) {
    const [rs, re] = this.region || [0, this.buffer?.duration || 0];
    const clamped = clamp(t, rs, Math.max(rs, re - 0.01));
    if (this.playing) this.play(clamped);
    else { this.offset = clamped; this.onTick?.(clamped); }
  }

  get currentTime() {
    if (!this.playing) return this.offset;
    const [rs] = this.region || [0, 0];
    return rs + (audioCtx().currentTime - this.startedAt);
  }
  setVolume(v) { if (this.gainNode) this.gainNode.gain.value = clamp(v, 0, 2); }

  _startTick() {
    const tick = () => {
      if (!this.playing) return;
      this.onTick?.(this.currentTime);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }
  _stopTick() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; }
  dispose() { this.stop(); this.buffer = null; }
}

/* ========================================================================= */
/* WAV                                                                       */
/* ========================================================================= */

/**
 * AudioBuffer -> 16-bit PCM WAV Blob.
 *
 * Generated tracks need a *source* file the way an uploaded one does, so trim,
 * gain and fades keep working after the fact. WAV is the honest choice for
 * that: lossless, decodes everywhere, and never re-compresses before the one
 * Vorbis pass that actually ships.
 */
export function bufferToWav(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const bytes = 44 + len * ch * 2;
  const ab = new ArrayBuffer(bytes);
  const v = new DataView(ab);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);            // PCM chunk size
  v.setUint16(20, 1, true);             // format: PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true);   // byte rate
  v.setUint16(32, ch * 2, true);        // block align
  v.setUint16(34, 16, true);            // bits per sample
  str(36, 'data');
  v.setUint32(40, len * ch * 2, true);

  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}
