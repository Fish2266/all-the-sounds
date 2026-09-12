/* ============================================================================
   The mark.

   Drawn on a 16×16 grid, the same as a Minecraft block face, because an app
   that lives next to Frame & Groove should not wear a vector logo. It is a
   note block — the one block whose whole job is sound — with the note
   particle it throws, in emerald, sitting on the grille.

   Computed rather than hand-plotted so it stays exact at any size, and every
   size is an integer multiple of 16 so the pixels never blur.
   ========================================================================= */

const G = 16;

const PAL = {
  woodDark:  '#3E2618',
  woodBase:  '#6A4230',
  woodLight: '#8C5A3E',
  seam:      '#54331F',
  grille:    '#24160F',
  hole:      '#0E0906',
  note:      '#3FD98B',
  noteLight: '#7FE9B4',
  noteDark:  '#1E9B5E',
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} size px; rounded down to a multiple of 16
 */
export function drawMark(canvas, size = 64) {
  const scale = Math.max(1, Math.floor(size / G));
  const px = G * scale;
  canvas.width = px; canvas.height = px;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, px, px);

  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= G || y >= G) return;
    g.fillStyle = c;
    g.fillRect(x * scale, y * scale, scale, scale);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };

  const F = G - 1;

  /* ---- The block ------------------------------------------------------- */
  rect(0, 0, F, F, PAL.woodBase);
  // Plank seams, staggered, so it reads as wood rather than a brown square.
  for (const y of [4, 8, 12]) for (let x = 1; x < F; x++) set(x, y, PAL.seam);
  for (const [x, y0] of [[5, 1], [11, 5], [3, 9], [9, 13]]) for (let y = y0; y < y0 + 3; y++) set(x, y, PAL.seam);
  // Lit top and left, shaded bottom and right — the game's own block bevel.
  for (let i = 0; i <= F; i++) { set(i, 0, PAL.woodLight); set(0, i, PAL.woodLight); }
  for (let i = 0; i <= F; i++) { set(i, F, PAL.woodDark); set(F, i, PAL.woodDark); }

  /* ---- The grille ------------------------------------------------------ */
  rect(3, 3, 12, 12, PAL.grille);
  for (let i = 3; i <= 12; i++) { set(i, 3, PAL.hole); set(3, i, PAL.hole); }
  for (let y = 5; y <= 11; y += 2) for (let x = 5; x <= 11; x += 2) set(x, y, PAL.hole);

  /* ---- The note -------------------------------------------------------- */
  // Head, stem and flag of an eighth note, lit from the upper left.
  rect(5, 9, 7, 11, PAL.note);
  set(5, 9, PAL.noteLight); set(6, 9, PAL.noteLight);
  set(7, 11, PAL.noteDark);
  rect(7, 4, 7, 10, PAL.note);
  set(7, 4, PAL.noteLight);
  rect(8, 4, 9, 4, PAL.note);
  rect(9, 5, 10, 5, PAL.note);
  set(10, 6, PAL.noteDark);

  return canvas;
}

/** A standalone canvas element at the given size. */
export function markCanvas(size = 64) {
  const c = document.createElement('canvas');
  c.style.width = size + 'px';
  c.style.height = size + 'px';
  drawMark(c, size * Math.min(2, window.devicePixelRatio || 1));
  return c;
}

/** A data URI, for the favicon and pack.png. */
export function markDataURL(size = 64) {
  const c = document.createElement('canvas');
  drawMark(c, size);
  return c.toDataURL('image/png');
}

/** Swap the page favicon to the real mark, at a couple of useful sizes. */
export function installFavicon() {
  for (const link of document.querySelectorAll('link[rel~="icon"]')) link.remove();
  for (const size of [32, 64, 128]) {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.sizes = `${size}x${size}`;
    link.href = markDataURL(size);
    document.head.appendChild(link);
  }
  const apple = document.createElement('link');
  apple.rel = 'apple-touch-icon';
  apple.href = markDataURL(160);
  document.head.appendChild(apple);
}
