/* ============================================================================
   Waveforms — the trim editor, and the little strips in each take row.

   The trim editor is the disc studio's, cut down to what a sound needs: two
   handles, a playhead, and a ruler that says exactly where the cut is. It
   always shows the whole source, dimmed outside the trim, so a cut that was
   too eager can be pulled back out.
   ========================================================================= */

import { h, drag, observeResize } from '../core/dom.js';
import { clamp, rafBatch } from '../core/util.js';

export const cssColor = (name, el = document.documentElement) =>
  getComputedStyle(el).getPropertyValue(name).trim() || '#3FD98B';

/**
 * Draw min/max peak pairs into a canvas.
 * @param {object} o { duration, view:[t0,t1], sel:[t0,t1], on, off, fit, gain }
 *   view  the stretch of time the canvas spans
 *   sel   the stretch drawn in the `on` colour; the rest is `off`
 *   fit   scale so the loudest moment in view fills the height
 */
export function drawPeaks(canvas, peaks, o = {}) {
  const { duration = 1, view = [0, duration], sel = [-Infinity, Infinity], on = '#3FD98B', off = '#525E66', fit = false, gain = 1 } = o;
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (!peaks?.length || duration <= 0) return;
  const n = peaks.length / 2;
  const [v0, v1] = view;
  const span = Math.max(1e-6, v1 - v0);
  const bucketAt = t => clamp(Math.floor((t / duration) * n), 0, n - 1);

  let scale = gain;
  if (fit) {
    let top = 0;
    for (let b = bucketAt(v0), e = bucketAt(v1); b <= e; b++) {
      top = Math.max(top, Math.abs(peaks[b * 2]), Math.abs(peaks[b * 2 + 1]));
    }
    if (top > 1e-4) scale = 0.95 / top;
  }

  const mid = H / 2;
  for (let x = 0; x < W; x++) {
    const t0 = v0 + (x / W) * span, t1 = v0 + ((x + 1) / W) * span;
    const b0 = bucketAt(t0), b1 = Math.max(b0, bucketAt(t1));
    let mn = 1, mx = -1;
    for (let b = b0; b <= b1; b++) {
      const lo = peaks[b * 2], hi = peaks[b * 2 + 1];
      if (lo < mn) mn = lo;
      if (hi > mx) mx = hi;
    }
    if (mn > mx) continue;
    const t = (t0 + t1) / 2;
    g.fillStyle = t >= sel[0] && t <= sel[1] ? on : off;
    const y0 = mid - clamp(mx * scale, -1, 1) * (mid - 1);
    const y1 = mid - clamp(mn * scale, -1, 1) * (mid - 1);
    g.fillRect(x, Math.floor(y0), 1, Math.max(1, Math.ceil(y1 - y0)));
  }
}

/** m:ss.cc — sound effects live in hundredths. */
export function formatClock(s) {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
}

/**
 * @param {object} o
 *   duration  source length in seconds
 *   peaks     from computePeaks()
 *   start/end the current trim, in seconds (end is a real time, never 0)
 *   onChange(start, end, final)  final is true when a drag lets go
 *   onSeek(t) a click on the waveform itself
 */
export function trimEditor({ duration, peaks, start = 0, end = duration, onChange, onSeek }) {
  const cvs = h('canvas');
  const maskA = h('.w-mask'), maskB = h('.w-mask'), region = h('.w-region');
  const hA = h('.wave-handle', { 'aria-label': 'Trim start', 'data-tip': 'Drag to move the start', 'data-tip-pos': 'top' });
  const hB = h('.wave-handle', { 'aria-label': 'Trim end', 'data-tip': 'Drag to move the end', 'data-tip-pos': 'top' });
  const head = h('.w-playhead');
  const shell = h('.wave-shell', cvs, maskA, maskB, region, hA, hB, head);
  const ruler = h('.wave-ruler');
  const el = h('.col.g-1', shell, ruler);
  const MIN = 0.02;
  const pct = t => (t / duration) * 100;

  function layout() {
    const p0 = pct(start), p1 = pct(end);
    maskA.style.cssText = `left:0;width:${p0}%`;
    maskB.style.cssText = `left:${p1}%;right:0`;
    region.style.cssText = `left:${p0}%;width:${Math.max(0.3, p1 - p0)}%`;
    hA.style.left = `calc(${p0}% - 7px)`;
    hB.style.left = `calc(${p1}% - 7px)`;
    ruler.replaceChildren(
      h('span', { text: formatClock(0) }),
      h('span.wr-sel', { text: `${formatClock(start)} → ${formatClock(end)} · ${(end - start).toFixed(2)} s` }),
      h('span', { text: formatClock(duration) }),
    );
  }

  const paint = rafBatch(() => {
    const r = shell.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.round(r.width * dpr);
    cvs.height = Math.round(r.height * dpr);
    drawPeaks(cvs, peaks, { duration, sel: [start, end], on: cssColor('--mine', shell), off: cssColor('--text-4', shell) });
  });

  const timeAt = e => {
    const r = shell.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width, 0, 1) * duration;
  };
  const bind = (handle, which) => {
    // The waveform under the handle seeks on press; a handle must not.
    handle.addEventListener('pointerdown', e => e.stopPropagation());
    drag(handle, {
      onMove: (c, e) => {
        const t = timeAt(e);
        if (which === 'a') start = clamp(t, 0, end - MIN);
        else end = clamp(t, start + MIN, duration);
        layout(); paint();
        onChange?.(start, end, false);
      },
      onEnd: () => onChange?.(start, end, true),
    });
  };
  bind(hA, 'a');
  bind(hB, 'b');
  shell.addEventListener('pointerdown', e => { if (e.button === 0) onSeek?.(timeAt(e)); });
  observeResize(shell, () => paint());
  layout();
  queueMicrotask(paint);

  el.set = (s, e) => { start = s; end = e; layout(); paint(); };
  el.setPlayhead = t => { head.style.left = `${pct(t)}%`; };
  el.setPlaying = b => { shell.dataset.playing = String(!!b); };
  return el;
}
