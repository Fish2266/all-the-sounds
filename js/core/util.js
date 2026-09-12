/* ============================================================================
   Utilities — small, dependency-free, hot-path friendly.
   ========================================================================= */

export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
export const lerp  = (a, b, t) => a + (b - a) * t;
export const round = (v, p = 0) => { const m = 10 ** p; return Math.round(v * m) / m; };
export const mod   = (n, m) => ((n % m) + m) % m;

let _idc = 0;
export function uid(prefix = 'id') {
  _idc = (_idc + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${_idc.toString(36).padStart(3, '0')}${Math.random().toString(36).slice(2, 6)}`;
}

/** Minecraft resource-location safe: [a-z0-9_.-] */
export function slugifyId(s, fallback = 'untitled') {
  const out = String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, '')
    .replace(/[^a-z0-9_.\-\s]/g, ' ')
    .trim()
    .replace(/[\s\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  return out || fallback;
}

/** Namespaces are stricter in practice — keep to [a-z0-9_.-] and never empty. */
export function slugifyNamespace(s, fallback = 'custom') {
  const out = slugifyId(s, fallback).replace(/\./g, '_');
  return out.slice(0, 48) || fallback;
}

export function titleCase(s) {
  return String(s || '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

export function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/* ---- Timing ------------------------------------------------------------- */
export function debounce(fn, ms = 220) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  return wrapped;
}
export function throttle(fn, ms = 60) {
  let last = 0, pending = null, timer = null;
  return (...a) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else {
      pending = a;
      if (!timer) timer = setTimeout(() => {
        timer = null; last = performance.now();
        if (pending) { fn(...pending); pending = null; }
      }, ms - (now - last));
    }
  };
}
export const raf  = () => new Promise(r => requestAnimationFrame(r));
export const idle = () => new Promise(r => ('requestIdleCallback' in window ? requestIdleCallback(r, { timeout: 200 }) : setTimeout(r, 1)));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Coalesce many calls into one per animation frame. */
export function rafBatch(fn) {
  let queued = false, lastArgs;
  return (...a) => {
    lastArgs = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...lastArgs); });
  };
}

/* ---- Formatting --------------------------------------------------------- */
export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
}
export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function formatTimeMs(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
export function relTime(ts) {
  const d = Date.now() - ts;
  if (d < 45e3) return 'just now';
  if (d < 90e3) return 'a minute ago';
  const mins = Math.round(d / 6e4);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || one + 's')}`; }

/* ---- Colour ------------------------------------------------------------- */
/** Pack r,g,b,a (0-255) into a little-endian ABGR uint32 matching ImageData. */
export const packRGBA = (r, g, b, a) => (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
export const unpackRGBA = px => [px & 255, (px >>> 8) & 255, (px >>> 16) & 255, (px >>> 24) & 255];

export function hexToRgba(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 4) h = h.split('').map(c => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8 || /[^0-9a-fA-F]/.test(h)) return [0, 0, 0, 255];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16)];
}
export function rgbaToHex(r, g, b, a = 255) {
  const h = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return a >= 255 ? `#${h(r)}${h(g)}${h(b)}` : `#${h(r)}${h(g)}${h(b)}${h(a)}`;
}
export function rgbaCss(r, g, b, a = 255) { return `rgba(${r|0},${g|0},${b|0},${(a / 255).toFixed(3)})`; }

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx ? d / mx : 0, mx];
}
export function hsvToRgb(h, s, v) {
  h = mod(h, 360); s = clamp(s, 0, 1); v = clamp(v, 0, 1);
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else              [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, s, l];
}
/** Perceptual luminance 0..1 (sRGB-weighted, gamma-naive but fast & stable). */
export const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Squared distance in a cheap perceptual space — good enough for palettes. */
export function colorDist2(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) * 0.5;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (((512 + rm) * dr * dr) >> 8) + 4 * dg * dg + (((767 - rm) * db * db) >> 8);
}

/** Shift a colour's HSV — the workhorse for procedural sprite recolouring. */
export function shiftHsv(rgb, dh = 0, ds = 1, dv = 1) {
  const [h, s, v] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  return hsvToRgb(h + dh, clamp(s * ds, 0, 1), clamp(v * dv, 0, 1));
}
export function mixRgb(a, b, t) {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

/* ---- Data --------------------------------------------------------------- */
export function deepClone(o) {
  if (typeof structuredClone === 'function') { try { return structuredClone(o); } catch { /* fall through */ } }
  return JSON.parse(JSON.stringify(o));
}
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a == null || b == null) return false;
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => deepEqual(a[k], b[k]));
}
export function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }

export function fuzzyScore(needle, hay) {
  if (!needle) return 1;
  const n = needle.toLowerCase(), h = String(hay || '').toLowerCase();
  const idx = h.indexOf(n);
  if (idx === 0) return 1000 - h.length;
  if (idx > 0) return 600 - idx - h.length * 0.1;
  // subsequence
  let i = 0, score = 0, streak = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) { i++; streak++; score += 8 + streak * 2; }
    else streak = 0;
  }
  return i === n.length ? score : -1;
}

/* ---- Files -------------------------------------------------------------- */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function pickFile({ accept = '*/*', multiple = false } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
    inp.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(inp);
    let done = false;
    const finish = v => { if (done) return; done = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', () => finish(multiple ? [...inp.files] : (inp.files[0] || null)));
    window.addEventListener('focus', () => setTimeout(() => finish(multiple ? [] : null), 500), { once: true });
    inp.click();
  });
}
export function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(file);
  });
}
export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image failed to decode'));
    img.src = src;
  });
}
export async function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}

/* ---- Canvas ------------------------------------------------------------- */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export function ctx2d(canvas, opts = {}) {
  const c = canvas.getContext('2d', { willReadFrequently: true, ...opts });
  c.imageSmoothingEnabled = false;
  return c;
}
export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise(res => canvas.toBlob(res, type, quality));
}

/* ---- Platform ----------------------------------------------------------- */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const hasMod = e => IS_MAC ? e.metaKey : e.ctrlKey;

export function keyLabel(combo) {
  return combo
    .replace(/\bmod\b/gi, MOD_KEY)
    .replace(/\bshift\b/gi, IS_MAC ? '⇧' : 'Shift')
    .replace(/\balt\b/gi, IS_MAC ? '⌥' : 'Alt')
    .replace(/\+/g, IS_MAC ? '' : '+');
}

/* ---- Errors ------------------------------------------------------------- */
export class AppError extends Error {
  constructor(message, { detail, cause } = {}) { super(message); this.name = 'AppError'; this.detail = detail; this.cause = cause; }
}
