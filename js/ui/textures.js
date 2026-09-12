/* ============================================================================
   Block textures, generated rather than shipped.

   The app wants Minecraft's material vocabulary without dragging copyrighted
   texture files along, so every surface here is drawn from scratch at 16×16 —
   the same resolution the game uses — with a seeded noise function. They tile
   seamlessly, come out as data URIs, and get installed as CSS variables so any
   stylesheet can reach for --tex-stone the way it reaches for a colour.
   ========================================================================= */

import { clamp, mixRgb, hexToRgba } from '../core/util.js';
import { hasTexture, textureURL as packTextureURL, decodeTexture, textureCanvasSync } from '../core/texturepack.js';

/* Deterministic PRNG — same texture every load, no flicker between renders. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Value noise that wraps at `size`, so the tile has no visible seam. */
function wrapNoise(size, seed, freq = 1) {
  const rnd = mulberry32(seed);
  const n = Math.max(2, Math.round(size / (16 / freq) * 4));
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const at = (x, y) => grid[((y % n) + n) % n * n + ((x % n) + n) % n];
  return (x, y) => {
    const fx = x / size * n, fy = y / size * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

const hex = c => hexToRgba(c).slice(0, 3);

/* ---- Texture recipes ---------------------------------------------------- */
/* Each returns [r,g,b] for a pixel. Size is always 16 unless overridden. */
export const TEXTURES = {
  stone: {
    label: 'Stone',
    draw(x, y, S, n) {
      const base = hex('#7A7A7A'), lo = hex('#6A6A6A'), hi = hex('#8D8D8D');
      const v = n(x, y);
      const t = v < 0.38 ? 0 : v > 0.66 ? 1 : 0.5;
      return t === 0 ? mixRgb(base, lo, 0.85) : t === 1 ? mixRgb(base, hi, 0.8) : base;
    },
  },
  cobble: {
    label: 'Cobblestone',
    draw(x, y, S, n) {
      const v = n(x, y), w = n(x + 7, y + 11);
      const mortar = v < 0.30;
      const base = mortar ? hex('#5A5A5A') : hex('#7F7F7F');
      const shade = w < 0.34 ? -18 : w > 0.7 ? 16 : 0;
      return base.map(c => clamp(c + shade, 0, 255));
    },
  },
  deepslate: {
    label: 'Deepslate',
    draw(x, y, S, n) {
      const v = n(x, y);
      const base = hex('#4B4B51');
      const streak = Math.sin((x * 0.7 + v * 5)) * 0.5 + 0.5;
      const shade = (v - 0.5) * 34 + (streak - 0.5) * 10;
      return base.map(c => clamp(c + shade, 0, 255));
    },
  },
  dirt: {
    label: 'Dirt',
    draw(x, y, S, n) {
      const v = n(x, y), w = n(x + 3, y + 9);
      const base = hex('#8B6A47');
      const shade = (v - 0.5) * 44 + (w > 0.82 ? -22 : 0);
      return base.map(c => clamp(c + shade, 0, 255));
    },
  },
  oak: {
    label: 'Oak planks',
    draw(x, y, S, n) {
      const plankH = S / 4;
      const row = Math.floor(y / plankH);
      const inRow = y - row * plankH;
      const base = hex('#9C7F4E');
      let shade = (n(x + row * 31, y) - 0.5) * 26;
      if (inRow < 1) shade -= 34;                       // plank seam
      if (inRow > plankH - 1.2) shade -= 12;
      // Staggered vertical joints
      const joint = (x + row * 5) % S;
      if (joint < 1) shade -= 30;
      return base.map(c => clamp(c + shade, 0, 255));
    },
  },
  darkOak: {
    label: 'Dark oak planks',
    draw(x, y, S, n) {
      const c = TEXTURES.oak.draw(x, y, S, n);
      return mixRgb(c, hex('#3E2A18'), 0.62);
    },
  },
  spruce: {
    label: 'Spruce planks',
    draw(x, y, S, n) {
      const c = TEXTURES.oak.draw(x, y, S, n);
      return mixRgb(c, hex('#6B4B2C'), 0.5);
    },
  },
  grass: {
    label: 'Grass block top',
    draw(x, y, S, n) {
      const v = n(x, y), w = n(x + 5, y + 13);
      const base = hex('#79A64B');
      const shade = (v - 0.5) * 40 + (w > 0.78 ? 14 : w < 0.22 ? -16 : 0);
      return base.map(c => clamp(c + shade, 0, 255));
    },
  },
  copperOx: {
    label: 'Oxidised copper',
    draw(x, y, S, n) {
      const v = n(x, y), w = n(x + 11, y + 4);
      const green = hex('#4FA487'), copper = hex('#C1683F');
      const c = mixRgb(green, copper, clamp(w * 1.4 - 0.25, 0, 1) * 0.35);
      return c.map(ch => clamp(ch + (v - 0.5) * 26, 0, 255));
    },
  },
  paper: {
    label: 'Paper',
    draw(x, y, S, n) {
      const v = n(x, y);
      const base = hex('#E8E2D2');
      return base.map(c => clamp(c + (v - 0.5) * 12, 0, 255));
    },
  },
};

/* ---- Rendering ---------------------------------------------------------- */
const cache = new Map();

/**
 * Render a texture tile.
 * @param {string} name key of TEXTURES
 * @param {object} o { size, seed, scale, tint, tintAmount, alpha }
 * @returns {HTMLCanvasElement}
 */
export function textureCanvas(name, o = {}) {
  const { size = 16, seed = 1337, scale = 1, tint = null, tintAmount = 0, alpha = 1 } = o;
  const key = `${name}|${size}|${seed}|${scale}|${tint}|${tintAmount}|${alpha}`;
  if (cache.has(key)) return cache.get(key);

  const recipe = TEXTURES[name] || TEXTURES.stone;
  const n = wrapNoise(size, seed);
  const base = document.createElement('canvas');
  base.width = size; base.height = size;
  const img = new ImageData(size, size);
  const tintRGB = tint ? hex(tint) : null;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = recipe.draw(x, y, size, n);
      if (tintRGB && tintAmount) c = mixRgb(c, tintRGB, tintAmount);
      const i = (y * size + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
      img.data[i + 3] = Math.round(alpha * 255);
    }
  }
  base.getContext('2d').putImageData(img, 0, 0);

  let out = base;
  if (scale !== 1) {
    out = document.createElement('canvas');
    out.width = size * scale; out.height = size * scale;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0, out.width, out.height);
  }
  cache.set(key, out);
  return out;
}

export function textureURL(name, o) {
  return textureCanvas(name, o).toDataURL('image/png');
}

/* Which generated texture stands in for which real block, so a linked jar can
   swap the genuine article into exactly the same slots. */
export const TEXTURE_MAP = {
  '--tex-stone':     { gen: 'stone',     game: 'block/stone' },
  '--tex-cobble':    { gen: 'cobble',    game: 'block/cobblestone' },
  '--tex-deepslate': { gen: 'deepslate', game: 'block/deepslate' },
  '--tex-dirt':      { gen: 'dirt',      game: 'block/dirt' },
  '--tex-oak':       { gen: 'oak',       game: 'block/oak_planks' },
  '--tex-darkoak':   { gen: 'darkOak',   game: 'block/dark_oak_planks' },
  '--tex-spruce':    { gen: 'spruce',    game: 'block/spruce_planks' },
  '--tex-grass':     { gen: 'grass',     game: 'block/grass_block_top' },
  '--tex-copper':    { gen: 'copperOx',  game: 'block/oxidized_copper' },
  '--tex-paper':     { gen: 'paper',     game: null },
};

/**
 * Install the texture set as CSS custom properties on :root, so stylesheets can
 * use them like any other token. The bundled Minecraft textures are the source;
 * the generated ones only stand in for a slot the pack does not cover.
 */
export function installTextures() {
  const root = document.documentElement;
  let real = 0;

  for (const [prop, { gen, game }] of Object.entries(TEXTURE_MAP)) {
    let url = null;
    if (game && hasTexture(game)) { url = packTextureURL(game); real++; }
    if (!url) url = textureURL(gen, { seed: SEEDS[gen] ?? 11, scale: 3 });
    root.style.setProperty(prop, `url("${url}")`);
  }

  root.style.setProperty('--tex-chrome',
    `url("${textureURL('stone', { seed: SEEDS.stone, scale: 2 })}")`);
  root.dataset.textures = 'on';
  root.dataset.realTextures = real ? 'on' : 'off';
  return { real, total: Object.keys(TEXTURE_MAP).length };
}

/* Fixed seeds so a given surface looks the same on every load. */
const SEEDS = {
  stone: 11, cobble: 23, deepslate: 7, dirt: 41,
  oak: 5, darkOak: 5, spruce: 9, grass: 19, copperOx: 29, paper: 3,
};

/**
 * A canvas for a block, preferring the real texture. Async because a texture
 * has to be decoded the first time it is asked for.
 */
export async function blockCanvas(genName, gameName, opts = {}) {
  if (gameName && hasTexture(gameName)) {
    const c = await decodeTexture(gameName);
    if (c) return c;
  }
  return textureCanvas(genName, { size: 16, scale: 1, seed: SEEDS[genName] ?? 11, ...opts });
}

/** Synchronous variant for hot paths — the real texture if it is decoded,
 *  otherwise the generated stand-in so nothing ever draws blank. */
export function blockCanvasSync(genName, gameName, opts = {}) {
  if (gameName) {
    const c = textureCanvasSync(gameName);
    if (c) return c;
  }
  return textureCanvas(genName, { size: 16, scale: 1, seed: SEEDS[genName] ?? 11, ...opts });
}

/** Paint a texture into a canvas element, tiled to fill it. */
export function tileInto(canvas, name, o = {}) {
  const tile = textureCanvas(name, o);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  const pat = g.createPattern(tile, 'repeat');
  g.fillStyle = pat;
  g.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Draw a Minecraft-style beveled block face — the three-tone edge that makes
 * every vanilla button and slot read as raised or sunken.
 */
export function drawBevel(g, x, y, w, h, { raised = true, px = 2 } = {}) {
  g.save();
  g.fillStyle = raised ? 'rgba(255,255,255,.42)' : 'rgba(0,0,0,.42)';
  g.fillRect(x, y, w, px);
  g.fillRect(x, y, px, h);
  g.fillStyle = raised ? 'rgba(0,0,0,.42)' : 'rgba(255,255,255,.30)';
  g.fillRect(x, y + h - px, w, px);
  g.fillRect(x + w - px, y, px, h);
  g.restore();
}

export const TEXTURE_NAMES = Object.keys(TEXTURES);
