/* ============================================================================
   Tooltips.

   These used to be a `::after` on the element itself, which is lovely until
   the element sits inside anything that scrolls — a tool dock, a stage bar, an
   inspector column — and the tip is clipped away entirely. `overflow: clip`
   with a margin does not rescue it either: next to a scrolling axis the used
   value falls back to `hidden`.

   So there is exactly one bubble, fixed to the viewport, parked at the end of
   <body>. One delegated pointerover finds the nearest `[data-tip]`, measures
   it, and places the bubble beside it — flipping to the opposite side rather
   than hanging off the edge of the window.
   ========================================================================= */

const GAP = 9;         // distance from the element
const MARGIN = 6;      // keep-out from the window edge
const DELAY = 70;      // matches the old CSS transition delay

let bubble = null;
let target = null;
let showTimer = 0;

function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.className = 'tipbubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  document.body.appendChild(bubble);
  return bubble;
}

/** The element under the pointer that actually wants a tooltip, or null. */
function tipTarget(node) {
  const el = node?.closest?.('[data-tip]');
  if (!el) return null;
  const text = el.getAttribute('data-tip');
  if (!text) return null;                       // data-tip="" means "not now"
  if (el.disabled) return null;
  return el;
}

function place(el, text) {
  const b = ensureBubble();
  b.textContent = text;
  b.hidden = false;
  b.dataset.on = 'false';

  const r = el.getBoundingClientRect();
  const w = b.offsetWidth, hgt = b.offsetHeight;
  const pos = el.getAttribute('data-tip-pos') || 'top';

  /* Try the asked-for side; fall back to its opposite when there is no room,
     which is what keeps a tip on a button at the top of the window visible. */
  const fits = {
    top: r.top - GAP - hgt >= MARGIN,
    bottom: r.bottom + GAP + hgt <= window.innerHeight - MARGIN,
    left: r.left - GAP - w >= MARGIN,
    right: r.right + GAP + w <= window.innerWidth - MARGIN,
  };
  const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const side = fits[pos] ? pos : (fits[flip[pos]] ? flip[pos] : pos);

  let x, y;
  if (side === 'top' || side === 'bottom') {
    x = r.left + r.width / 2 - w / 2;
    y = side === 'top' ? r.top - GAP - hgt : r.bottom + GAP;
  } else {
    x = side === 'left' ? r.left - GAP - w : r.right + GAP;
    y = r.top + r.height / 2 - hgt / 2;
  }
  x = Math.max(MARGIN, Math.min(x, window.innerWidth - w - MARGIN));
  y = Math.max(MARGIN, Math.min(y, window.innerHeight - hgt - MARGIN));

  b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  b.dataset.side = side;
  // A frame later, so the entrance transition has a starting state to run from.
  requestAnimationFrame(() => { if (target === el) b.dataset.on = 'true'; });
}

function hide() {
  clearTimeout(showTimer);
  target = null;
  if (bubble) { bubble.dataset.on = 'false'; bubble.hidden = true; }
}

function show(el) {
  if (target === el) return;
  target = el;
  clearTimeout(showTimer);
  const text = el.getAttribute('data-tip');
  showTimer = setTimeout(() => { if (target === el) place(el, text); }, DELAY);
}

/** Wire the one bubble up to the whole document. Safe to call twice. */
export function installTooltips() {
  if (installTooltips.done) return;
  installTooltips.done = true;
  ensureBubble();

  document.addEventListener('pointerover', e => {
    const el = tipTarget(e.target);
    if (el) show(el); else if (target) hide();
  }, true);

  document.addEventListener('pointerout', e => {
    if (target && !target.contains(e.relatedTarget)) hide();
  }, true);

  /* A tip that is still up while the thing under it moves is worse than no
     tip, so anything that could move it takes the bubble down. */
  for (const ev of ['pointerdown', 'wheel', 'keydown']) {
    document.addEventListener(ev, hide, true);
  }
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);

  /* Keyboard users get the same tips, but only from real focus rings. */
  document.addEventListener('focusin', e => {
    const el = tipTarget(e.target);
    if (el && el.matches(':focus-visible')) show(el); else hide();
  });
  document.addEventListener('focusout', hide);
}

/** Take the bubble down — for anything that replaces the element under it. */
export const hideTooltip = hide;
