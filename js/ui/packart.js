/* ============================================================================
   Pack art — one bar per category, filled as far as it has been recorded.

   Drawn on a 64 × 40 pixel grid like the rest of the pixel art, so it reads
   as something from the game rather than a chart from a dashboard: each bar
   is a sunken slot with a block-lit fill, and its category's colour sits
   under it as a foot, so an empty pack is still a row of recognisable slots.
   A category that is finished gets its slot outlined in its own colour.

   Any progress at all shows at least one pixel. Two sounds out of eight
   hundred is real work, and a bar that stays empty would say otherwise.

   The slots follow the theme: dark wells on Deepslate, the game's own grey
   inventory slot on Bone, where a black well would sit on the paper like a
   hole punched through it.
   ========================================================================= */

import { CATEGORIES, soundList } from '../core/soundlist.js';
import { hexToRgba, mixRgb } from '../core/util.js';

export const ART_W = 64, ART_H = 40;
const TRACK_TOP = 4, TRACK_BOTTOM = 31;          // outline rows, inclusive
const FILL = TRACK_BOTTOM - TRACK_TOP - 1;       // 26 rows of fill
const BAR = 5, GAP = 1;
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

const SLOTS = {
  dark:  { outline: '#0B0E10', well: '#1B2126', shadow: '#14191D' },
  light: { outline: '#9C9485', well: '#DCD6CB', shadow: '#CBC4B7' },
};

const shade = (hex, toward, t) => {
  const [r, g, b] = mixRgb(hexToRgba(hex).slice(0, 3), toward, t);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
};

/** 'light' on the Bone theme, 'dark' otherwise. */
export const artTheme = () => (document.documentElement.dataset.theme === 'bone' ? 'light' : 'dark');

/**
 * Progress per category for one pack.
 * @param {object} byCat recorded-event counts keyed by the id's first segment,
 *                       as the library index stores them
 */
export function categoryProgress(byCat = {}) {
  const totals = {};
  for (const ev of soundList()) totals[ev.cat] = (totals[ev.cat] || 0) + 1;
  const known = new Set(CATEGORIES.map(c => c.id));
  const done = {};
  for (const [k, n] of Object.entries(byCat)) {
    const cat = known.has(k) ? k : 'other';
    done[cat] = (done[cat] || 0) + n;
  }
  return CATEGORIES.filter(c => totals[c.id]).map(c => ({
    ...c, done: Math.min(done[c.id] || 0, totals[c.id]), total: totals[c.id],
  }));
}

/** One line per category, for the tooltip over the art. */
export const progressTip = rows =>
  rows.map(r => `${r.label}  ${r.done.toLocaleString()} / ${r.total.toLocaleString()}`).join('\n');

/**
 * @param {Array} rows from categoryProgress()
 * @param {object} o { scale: whole pixels per cell, theme: 'dark' | 'light' }
 */
export function packArt(rows, { scale = 1, theme = artTheme() } = {}) {
  const c = document.createElement('canvas');
  c.width = ART_W * scale;
  c.height = ART_H * scale;
  const g = c.getContext('2d');
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x * scale, y * scale, w * scale, h * scale); };
  const slot = SLOTS[theme] || SLOTS.dark;
  const light = theme === 'light';

  const span = rows.length * BAR + (rows.length - 1) * GAP;
  const x0 = Math.floor((ART_W - span) / 2);
  rows.forEach((r, i) => {
    const x = x0 + i * (BAR + GAP);
    const color = light ? r.light || r.color : r.color;
    const pct = r.total ? r.done / r.total : 0;
    const full = r.total > 0 && r.done >= r.total;
    const h = pct > 0 ? Math.max(1, Math.round(pct * FILL)) : 0;

    // The slot: an outline, then a sunken well with its left wall in shadow.
    px(x, TRACK_TOP, BAR, TRACK_BOTTOM - TRACK_TOP + 1, full ? shade(color, light ? BLACK : WHITE, 0.3) : slot.outline);
    px(x + 1, TRACK_TOP + 1, BAR - 2, FILL, slot.well);
    px(x + 1, TRACK_TOP + 1, 1, FILL, slot.shadow);

    // The fill, lit the way the game lights a block: bright top and left,
    // shaded right.
    if (h) {
      const top = TRACK_BOTTOM - h;
      px(x + 1, top, BAR - 2, h, color);
      px(x + 1, top, 1, h, shade(color, WHITE, 0.3));
      px(x + BAR - 2, top, 1, h, shade(color, BLACK, 0.3));
      px(x + 1, top, BAR - 2, 1, shade(color, WHITE, 0.55));
    }

    // The foot: the category's own colour, so an empty slot still says which it is.
    px(x, TRACK_BOTTOM + 2, BAR, 1, color);
    px(x, TRACK_BOTTOM + 3, BAR, 1, shade(color, BLACK, 0.35));
  });
  return c;
}
