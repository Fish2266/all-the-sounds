/* ============================================================================
   Interface sound.

   Minecraft's menus click. It is a small thing that does a lot of work — it
   makes a button feel like an object rather than a rectangle — and an app that
   already carries a synthesiser has no excuse for being silent.

   Everything here is generated: short envelopes over oscillators and filtered
   noise, a few hundred bytes of code instead of a folder of samples. Nothing
   is loaded, nothing is fetched, and the whole set costs about a millisecond
   to play.

   Rules it follows, because UI audio is very easy to get wrong:
     • Nothing plays until the user has interacted with the page. Browsers
       forbid it, and it would be rude anyway.
     • Nothing plays for things the user did not cause. No sound on autosave,
       none on a background render finishing.
     • Repeated triggers inside a few milliseconds collapse into one, so a
       drag across twenty swatches is not twenty clicks.
     • It is quiet by default and switchable off in one place.
   ========================================================================= */

import { audioCtx } from '../audio/engine.js';
import { state } from '../core/store.js';

let unlocked = false;
let lastAt = 0;
let lastName = '';

/** Browsers only allow audio after a real gesture; wait for the first one. */
export function armSfx() {
  const unlock = () => {
    unlocked = true;
    try { audioCtx().resume(); } catch { /* no context yet is fine */ }
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

const enabled = () => unlocked && state.prefs.sound !== false;
const volume = () => (state.prefs.soundVolume ?? 55) / 100;

/* ---- Primitives ---------------------------------------------------------- */

/** A pitched blip: one oscillator, one exponential fall. */
function tone(ctx, out, { freq, type = 'square', at = 0, dur = 0.05, gain = 0.2, glide = 0 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime + at);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), ctx.currentTime + at + dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), ctx.currentTime + at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
  osc.connect(g).connect(out);
  osc.start(ctx.currentTime + at);
  osc.stop(ctx.currentTime + at + dur + 0.02);
}

/** A percussive tick: filtered noise, very short. This is the wooden part of
 *  the click, and what stops it sounding like a synthesiser beep. */
function tick(ctx, out, { at = 0, dur = 0.04, freq = 1400, q = 1.2, gain = 0.25 }) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Decaying noise, deterministic enough that every click sounds like a sibling.
  let seed = 1337;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    d[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / n, 3);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(out);
  src.start(ctx.currentTime + at);
}

/* ---- The set ------------------------------------------------------------- */
const VOICES = {
  /* A button. Wooden tick plus a short body, the way a menu button lands. */
  click: (ctx, out) => {
    tick(ctx, out, { freq: 1500, q: 0.9, gain: 0.30, dur: 0.035 });
    tone(ctx, out, { freq: 620, type: 'square', dur: 0.035, gain: 0.055, glide: 0.7 });
  },
  /* Picking a tool or a tab — lighter, higher, no body. */
  select: (ctx, out) => {
    tick(ctx, out, { freq: 2400, q: 1.6, gain: 0.16, dur: 0.022 });
    tone(ctx, out, { freq: 1180, type: 'square', dur: 0.028, gain: 0.035 });
  },
  /* A switch going on, then off — same shape, opposite direction. */
  on:  (ctx, out) => { tone(ctx, out, { freq: 660, dur: 0.05, gain: 0.06 }); tone(ctx, out, { freq: 990, at: 0.045, dur: 0.06, gain: 0.06 }); },
  off: (ctx, out) => { tone(ctx, out, { freq: 880, dur: 0.05, gain: 0.055 }); tone(ctx, out, { freq: 560, at: 0.045, dur: 0.06, gain: 0.055 }); },
  /* Something appeared. */
  open: (ctx, out) => { tone(ctx, out, { freq: 520, type: 'triangle', dur: 0.06, gain: 0.07 }); tone(ctx, out, { freq: 780, type: 'triangle', at: 0.05, dur: 0.08, gain: 0.06 }); },
  close: (ctx, out) => { tone(ctx, out, { freq: 700, type: 'triangle', dur: 0.05, gain: 0.06 }); tone(ctx, out, { freq: 440, type: 'triangle', at: 0.04, dur: 0.07, gain: 0.05 }); },
  /* Something was made — a block being placed. */
  place: (ctx, out) => {
    tick(ctx, out, { freq: 700, q: 0.7, gain: 0.34, dur: 0.06 });
    tone(ctx, out, { freq: 180, type: 'sine', dur: 0.08, gain: 0.10, glide: 0.55 });
  },
  /* It worked. Three notes up, short enough not to become annoying. */
  ok: (ctx, out) => {
    tone(ctx, out, { freq: 784, type: 'triangle', dur: 0.07, gain: 0.06 });
    tone(ctx, out, { freq: 988, type: 'triangle', at: 0.06, dur: 0.07, gain: 0.06 });
    tone(ctx, out, { freq: 1319, type: 'triangle', at: 0.12, dur: 0.12, gain: 0.055 });
  },
  /* It did not. Low and flat, no drama. */
  error: (ctx, out) => {
    tone(ctx, out, { freq: 200, type: 'square', dur: 0.10, gain: 0.07 });
    tone(ctx, out, { freq: 150, type: 'square', at: 0.09, dur: 0.14, gain: 0.06 });
  },
  /* Something was removed. */
  remove: (ctx, out) => {
    tick(ctx, out, { freq: 900, q: 0.8, gain: 0.22, dur: 0.05 });
    tone(ctx, out, { freq: 320, type: 'square', dur: 0.09, gain: 0.05, glide: 0.45 });
  },
};

export const SFX_NAMES = Object.keys(VOICES);

/**
 * Play one. Safe to call from anywhere: it is a no-op before the first
 * gesture, when sound is off, or when the same cue fired moments ago.
 */
export function sfx(name, { force = false } = {}) {
  if (!enabled()) return;
  const voice = VOICES[name];
  if (!voice) return;

  const now = performance.now();
  // Dragging across a palette should click once, not forty times.
  if (!force && name === lastName && now - lastAt < 45) return;
  lastAt = now; lastName = name;

  try {
    const ctx = audioCtx();
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const out = ctx.createGain();
    out.gain.value = volume() * 0.5;
    out.connect(ctx.destination);
    voice(ctx, out);
    // Let the node graph go once the tail has passed.
    setTimeout(() => { try { out.disconnect(); } catch {} }, 600);
  } catch { /* audio is a nicety; never let it break an interaction */ }
}

/** Play one at full volume regardless of the repeat guard — for previews. */
export const sfxPreview = name => sfx(name, { force: true });

/**
 * Render a cue offline and hand back the samples. Used to check that a voice
 * actually makes a sound — a silent sound effect is a bug you cannot see.
 */
export async function renderSfx(name, seconds = 0.5) {
  const voice = VOICES[name];
  if (!voice) return null;
  const ctx = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(ctx.destination);
  voice(ctx, out);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, rms = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; rms += d[i] * d[i]; }
  return { peak, rms: Math.sqrt(rms / d.length), samples: d.length };
}

/* ========================================================================= */
/* WIRING                                                                    */
/* ========================================================================= */

/**
 * One delegated listener for the whole app, so no component has to remember
 * to make a noise. Anything can opt out with data-quiet, and anything can pick
 * a different cue with data-sfx.
 */
export function installSfx(root = document) {
  armSfx();

  root.addEventListener('pointerdown', e => {
    const el = e.target.closest?.('[data-sfx], button, .swatch, .list-row, .proj-card, .tool-btn, .rail-btn, .check, .switch');
    if (!el || el.closest('[data-quiet]')) return;
    if (el.disabled) return;

    if (el.dataset?.sfx) { sfx(el.dataset.sfx); return; }
    if (el.classList.contains('tool-btn') || el.classList.contains('rail-btn')) return sfx('select');
    if (el.classList.contains('swatch')) return sfx('select');
    if (el.classList.contains('list-row') || el.classList.contains('proj-card')) return sfx('select');
    if (el.classList.contains('switch') || el.classList.contains('check')) return;  // handled on change
    if (el.classList.contains('btn-danger') || el.classList.contains('btn-danger-solid')) return sfx('remove');
    sfx('click');
  }, true);

  /* Switches and checkboxes speak on the state change, not the press, so the
     rising and falling cues actually match what happened. */
  root.addEventListener('change', e => {
    const t = e.target;
    if (t?.type !== 'checkbox' || t.closest('[data-quiet]')) return;
    sfx(t.checked ? 'on' : 'off');
  }, true);
}
