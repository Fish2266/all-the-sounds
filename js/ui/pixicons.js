/* ============================================================================
   Pixel icons for the navigation rail.

   The rail is the most-looked-at chrome in the app, so it is the place where
   a line icon set most obviously reads as "generic web app". These are drawn
   on a 16×16 grid — an inventory-icon grid — and displayed at exactly 2×, so
   every pixel lands on a device pixel and nothing is ever resampled.

   Drawn with a small rect/px vocabulary rather than typed out as character
   maps: the shapes stay editable, the palette can follow the theme, and there
   is no counting.
   ========================================================================= */

import { overrideArt, blitArt } from './pixelart-overrides.js';

const G = 16;

/* One palette, themed per icon family. `a`/`A` are the accent, so a selected
   rail button can tint its own icon without a second sprite. */
function palette(accent = '#3FD98B', accentLight = '#7FE9B4') {
  return {
    k: '#12151A',   // outline
    d: '#3A424B',   // dark
    m: '#5A646F',   // mid
    l: '#828E9A',   // light
    w: '#C8D2DA',   // highlight
    a: accent,
    A: accentLight,
    o: '#8A6A3C',   // oak dark
    O: '#B99A62',   // oak light
    n: '#6B5533',   // oak shadow
  };
}

function pen(g, scale, P) {
  const px = (x, y, c) => {
    if (x < 0 || y < 0 || x >= G || y >= G || !c) return;
    g.fillStyle = P[c] || c;
    g.fillRect(x * scale, y * scale, scale, scale);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(x, y, c);
  };
  const frame = (x0, y0, x1, y1, c) => {
    for (let x = x0; x <= x1; x++) { px(x, y0, c); px(x, y1, c); }
    for (let y = y0; y <= y1; y++) { px(x0, y, c); px(x1, y, c); }
  };
  const disc = (cx, cy, r, c) => {
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) px(x, y, c);
    }
  };
  return { px, rect, frame, disc };
}

/* ---- The icons ----------------------------------------------------------- */
const ICONS = {
  /** Packs — a chest. Big lid, hard seam, one bright latch: the three things
   *  that make a chest read at this size. */
  packs(d) {
    // Body first, then the lid over it, so the seam is a real edge.
    d.rect(2, 8, 13, 13, 'o');
    d.rect(3, 9, 12, 12, 'O');
    d.rect(2, 3, 13, 7, 'O');
    d.rect(3, 4, 12, 5, 'w');          // lit top of the lid
    d.frame(2, 3, 13, 7, 'k');
    d.frame(2, 8, 13, 13, 'k');
    d.rect(6, 6, 9, 10, 'd');          // latch plate, spanning the seam
    d.frame(6, 6, 9, 10, 'k');
    d.rect(7, 8, 8, 9, 'w');           // keyhole
  },

  /** Pack — a single block, drawn the way the game draws one in your hand.
   *  A diamond top and two walls, lit top-left; the most Minecraft shape
   *  there is, and it separates cleanly from the chest beside it. */
  pack(d) {
    // Top face: a diamond, widest across the middle.
    const halfAt = y => [1, 3, 5, 7][y] ?? 0;          // rows 1..4 widen
    const topRows = [];
    for (let i = 0; i < 4; i++) topRows.push({ y: 1 + i, half: halfAt(i) });
    for (let i = 0; i < 3; i++) topRows.push({ y: 5 + i, half: halfAt(2 - i) });
    for (const { y, half } of topRows) {
      for (let x = 8 - half; x < 8 + half; x++) d.px(x, y, 'A');
    }

    // Walls hang from the diamond's lower edges. Left in shadow, right lit.
    const wallH = 4;
    for (let x = 1; x <= 7; x++) {
      const top = 4 + Math.floor((x - 1) / 2);
      for (let y = top; y < top + wallH; y++) d.px(x, y + 1, 'a');
    }
    for (let x = 8; x <= 14; x++) {
      const top = 4 + Math.floor((14 - x) / 2);
      for (let y = top; y < top + wallH; y++) d.px(x, y + 1, 'm');
    }

    // Silhouette: trace the diamond's edges and the bottom of each wall.
    for (const { y, half } of topRows) {
      d.px(8 - half, y, 'k');
      d.px(7 + half, y, 'k');
    }
    for (let x = 1; x <= 7; x++) {
      const top = 4 + Math.floor((x - 1) / 2);
      d.px(x, top + wallH, 'k');
    }
    for (let x = 8; x <= 14; x++) {
      const top = 4 + Math.floor((14 - x) / 2);
      d.px(x, top + wallH, 'k');
    }
    for (let y = 5; y <= 8; y++) { d.px(1, y, 'k'); d.px(14, y, 'k'); }
    // The front vertical edge, where the two walls meet.
    for (let y = 8; y <= 11; y++) { d.px(7, y, 'k'); }
  },

  /** Art — a framed painting with a horizon in it. */
  /** Mobs — a cow's head straight on: muzzle, two horns, one visible eye.
   *  A whole animal is unreadable at 16px, so this is the head only, which is
   *  how the game's own spawn eggs solve the same problem. */
  mobs(d) {
    // Horns first, so the head's outline cuts across them cleanly.
    d.rect(1, 3, 2, 4, 'w');
    d.rect(13, 3, 14, 4, 'w');
    d.px(1, 2, 'k'); d.px(2, 2, 'k'); d.px(13, 2, 'k'); d.px(14, 2, 'k');

    // Head
    d.rect(3, 3, 12, 12, 'a');
    d.frame(3, 3, 12, 12, 'k');
    // Forehead blaze — the light patch a cow reads by.
    d.rect(6, 4, 9, 6, 'A');

    // Muzzle
    d.rect(5, 9, 10, 12, 'w');
    d.frame(5, 9, 10, 12, 'k');
    d.px(6, 10, 'k'); d.px(9, 10, 'k');      // nostrils

    // Eyes
    d.rect(4, 6, 5, 7, 'k');
    d.rect(10, 6, 11, 7, 'k');
    d.px(5, 6, 'w'); d.px(11, 6, 'w');       // catchlights
  },

  art(d) {
    d.rect(1, 2, 14, 13, 'O');
    d.frame(1, 2, 14, 13, 'k');
    d.rect(2, 3, 13, 3, 'O');
    d.rect(2, 12, 13, 12, 'n');
    d.frame(3, 4, 12, 11, 'n');
    d.rect(4, 5, 11, 10, 'd');         // the canvas well
    d.rect(4, 5, 11, 7, '#3B4E86');    // sky
    d.rect(4, 8, 11, 10, '#2C6BA6');   // water
    d.rect(4, 8, 11, 8, '#E0894F');    // horizon glow
    d.px(9, 6, '#FFE2A0'); d.px(10, 6, '#FFE2A0');   // sun
    d.px(9, 7, '#FFE2A0');
  },

  /** Music — a record, with a groove and a label. */
  music(d) {
    d.disc(8, 8, 6.6, 'k');
    d.disc(8, 8, 5.9, '#1E1E26');
    d.disc(8, 8, 4.4, '#33333E');      // groove ring
    d.disc(8, 8, 3.8, '#1E1E26');
    d.disc(8, 8, 2.3, 'a');
    d.disc(8, 8, 0.9, 'k');
    d.px(5, 5, '#4A4A57');             // sheen
    d.px(6, 4, '#4A4A57');
  },

  /** Items — a name tag. The feature is "call it something and it changes",
   *  and a tag with a string and two lines of writing on it says that in
   *  sixteen pixels better than an item ever could. */
  sprites(d) {
    // The string, running off the top-left corner to the tag's hole.
    d.px(1, 2, 'l'); d.px(2, 3, 'l'); d.px(3, 4, 'l'); d.px(4, 5, 'l');

    // The tag itself: parchment, with the corner nearest the string cut off.
    d.rect(4, 5, 14, 11, '#C9B78E');
    d.rect(5, 6, 13, 8, '#DCCCA6');       // lit upper half
    d.rect(5, 10, 13, 10, '#A08F6B');
    d.frame(4, 5, 14, 11, 'k');
    d.px(4, 5, 'k'); d.px(4, 11, 'k');

    // Hole, punched where the string lands.
    d.px(6, 8, 'k'); d.px(6, 7, '#8A7A57'); d.px(7, 8, '#8A7A57');

    // Two lines of writing, in the section's own colour.
    d.rect(8, 7, 12, 7, 'a');
    d.rect(8, 9, 11, 9, 'A');
  },

  /** Export — an arrow dropping into an open tray. The head has to be wide or
   *  it reads as a bare line at sixteen pixels. */
  export(d) {
    d.rect(6, 1, 9, 5, 'a');           // a thick shaft, not a hairline
    d.rect(3, 6, 12, 6, 'a');          // full-width shoulders
    d.rect(4, 7, 11, 7, 'a');
    d.rect(5, 8, 10, 8, 'a');
    d.rect(6, 9, 9, 9, 'a');
    d.rect(7, 10, 8, 10, 'a');         // the point
    d.px(6, 1, 'A'); d.px(7, 1, 'A');  // a little light down the shaft
    d.rect(1, 12, 14, 14, 'm');        // tray
    d.rect(2, 13, 13, 13, 'd');
    d.frame(1, 12, 14, 14, 'k');
    d.px(1, 12, 'k'); d.px(14, 12, 'k');
  },
};

export const PIXICON_NAMES = Object.keys(ICONS);

/**
 * Draw one into a canvas.
 * @param {string} name
 * @param {number} scale integer pixels per grid cell
 * @param {object} o { accent, accentLight }
 */
export function pixIcon(name, scale = 2, o = {}) {
  const c = document.createElement('canvas');
  c.width = G * scale; c.height = G * scale;
  c.style.width = (G * scale) + 'px';
  c.style.height = (G * scale) + 'px';
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  /* A hand-drawn version wins over the code. It carries its own colours, so
     the accent no longer applies — see pixelart-overrides.js. */
  const hand = overrideArt(`icon:${name}`);
  if (hand) { blitArt(g, hand, scale); return c; }
  const P = palette(o.accent, o.accentLight);
  const fn = ICONS[name];
  if (fn) fn(pen(g, scale, P));
  return c;
}

/** The rail's own icons, at the size the rail shows them. */
export function railIcon(name, accent) {
  return pixIcon(name, 2, { accent, accentLight: accent });
}
