/* ============================================================================
   DOM — a hyperscript-lite plus the interaction primitives the app leans on.
   ========================================================================= */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon', 'defs', 'linearGradient', 'stop', 'text', 'ellipse']);

/**
 * h('div.card#id', { attrs }, ...children)
 * Attribute conveniences: class/className, style (object or string), dataset,
 * on* handlers, html (innerHTML), text (textContent), ref (callback).
 */
export function h(spec, props, ...children) {
  let tag = 'div', cls = [], id = null;
  if (typeof spec === 'string') {
    const m = spec.match(/^([a-zA-Z][a-zA-Z0-9-]*)?((?:[.#][^.#]+)*)$/);
    if (m) {
      tag = m[1] || 'div';
      for (const tok of (m[2] || '').match(/[.#][^.#]+/g) || []) {
        if (tok[0] === '.') cls.push(tok.slice(1)); else id = tok.slice(1);
      }
    } else tag = spec;
  }
  const el = SVG_TAGS.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (cls.length) el.setAttribute('class', cls.join(' '));
  if (id) el.id = id;

  if (props && (typeof props !== 'object' || props.nodeType || Array.isArray(props))) {
    children.unshift(props); props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.setAttribute('class', [el.getAttribute('class'), v].filter(Boolean).join(' '));
      } else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText += v;
        else for (const [p, val] of Object.entries(v)) {
          if (p.startsWith('--')) el.style.setProperty(p, val); else el.style[p] = val;
        }
      } else if (k === 'dataset') {
        for (const [p, val] of Object.entries(v)) if (val != null) el.dataset[p] = val;
      } else if (k === 'html') { el.innerHTML = v; }
      else if (k === 'text') { el.textContent = v; }
      else if (k === 'ref') { queueMicrotask(() => v(el)); }
      else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'value' && ('value' in el)) { el.value = v; }
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'multiple') {
        el[k] = !!v;
      } else if (v === true) { el.setAttribute(k, ''); }
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const c of children.flat(6)) {
    if (c == null || c === false || c === true || c === '') continue;
    parent.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export const frag = (...children) => append(document.createDocumentFragment(), children);

/** Raw-HTML fragment builder — used for icon strings and static markup. */
export function raw(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.childNodes.length === 1 ? t.content.firstChild : t.content;
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function setChildren(el, ...children) { clear(el); append(el, children); return el; }

/** Append children, skipping nulls. Native el.append() stringifies them. */
export function add(el, ...children) { append(el, children); return el; }

export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/** Event delegation: on(root,'click','.btn', handler) */
export function delegate(root, type, selector, handler, opts) {
  const fn = e => {
    const t = e.target.closest?.(selector);
    if (t && root.contains(t)) handler(e, t);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

export function toggleClass(el, cls, on) { el.classList.toggle(cls, !!on); return el; }

/** Pointer drag helper — returns a disposer. Handles capture + cleanup. */
export function drag(el, { onStart, onMove, onEnd, cursor, button = 0, buttons = null } = {}) {
  const allowed = buttons || [button];
  const down = e => {
    if (e.pointerType === 'mouse' && !allowed.includes(e.button)) return;
    const startX = e.clientX, startY = e.clientY;
    el.setPointerCapture?.(e.pointerId);
    if (cursor) document.body.style.cursor = cursor;

    const ctx = { startX, startY, dx: 0, dy: 0, event: e, button: e.button, moved: false, cancel: false };
    if (onStart) onStart(ctx, e);
    if (ctx.cancel) { document.body.style.cursor = ''; return; }

    const move = ev => {
      ctx.dx = ev.clientX - startX; ctx.dy = ev.clientY - startY;
      if (Math.abs(ctx.dx) > 2 || Math.abs(ctx.dy) > 2) ctx.moved = true;
      ctx.event = ev;
      onMove?.(ctx, ev);
    };
    const up = ev => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
      ctx.event = ev;
      onEnd?.(ctx, ev);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  el.addEventListener('pointerdown', down);
  return () => el.removeEventListener('pointerdown', down);
}

/** Track a value along a horizontal track (sliders, strips). t in 0..1 */
export function trackDrag(el, cb) {
  const calc = e => {
    const r = el.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
             y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return drag(el, {
    onStart: (c, e) => cb(calc(e), true, false),
    onMove:  (c, e) => cb(calc(e), false, false),
    onEnd:   (c, e) => cb(calc(e), false, true),
  });
}

/** Move focus into a container, trapping Tab. Returns a disposer. */
export function trapFocus(container) {
  const SEL = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const prev = document.activeElement;
  const onKey = e => {
    if (e.key !== 'Tab') return;
    const items = $$(SEL, container).filter(n => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  container.addEventListener('keydown', onKey);
  queueMicrotask(() => {
    const auto = container.querySelector('[data-autofocus]') || container.querySelector(SEL);
    auto?.focus?.();
  });
  return () => { container.removeEventListener('keydown', onKey); prev?.focus?.(); };
}

/** Scroll a child into view inside a scroll container without moving the page. */
export function scrollIntoViewIfNeeded(el, container, pad = 8) {
  if (!el || !container) return;
  const er = el.getBoundingClientRect(), cr = container.getBoundingClientRect();
  if (er.top < cr.top + pad) container.scrollTop -= (cr.top + pad - er.top);
  else if (er.bottom > cr.bottom - pad) container.scrollTop += (er.bottom - cr.bottom + pad);
}

/** Auto-size a textarea to content. */
export function autoGrow(ta, max = 320) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, max) + 'px'; };
  ta.addEventListener('input', fit);
  queueMicrotask(fit);
  return fit;
}

/** Persist a scroll position across re-renders keyed by name. */
const scrollMemo = new Map();
export function rememberScroll(el, key) {
  if (!el) return;
  if (scrollMemo.has(key)) el.scrollTop = scrollMemo.get(key);
  el.addEventListener('scroll', () => scrollMemo.set(key, el.scrollTop), { passive: true });
}

/**
 * Repaint a canvas-backed element whenever its box changes.
 *
 * Canvas scenes are drawn at a fixed pixel size, so a window resize leaves
 * them stretched until something else happens to redraw them. One shared
 * observer keeps every scene honest; the callback is rAF-batched because
 * ResizeObserver can fire several times per frame during a drag.
 */
export function observeResize(el, fn) {
  if (typeof ResizeObserver === 'undefined') return () => {};
  let queued = false, lastW = 0, lastH = 0;
  const ro = new ResizeObserver(entries => {
    const box = entries[0]?.contentRect;
    if (!box) return;
    const w = Math.round(box.width), h = Math.round(box.height);
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (el.isConnected) fn(w, h); });
  });
  ro.observe(el);
  return () => ro.disconnect();
}

/** Measure text width using a shared offscreen canvas (menus, truncation). */
let _measureCtx;
export function measureText(text, font = '13px -apple-system, sans-serif') {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = font;
  return _measureCtx.measureText(text).width;
}
