/* ============================================================================
   UI kit — the shared vocabulary every screen is built from.
   ========================================================================= */

import { h, raw, on, $$, trapFocus, clear, drag, add } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { clamp, uid, hexToRgba, rgbaToHex, keyLabel, copyText, rgbToHsv, hsvToRgb } from '../core/util.js';
import { sfx } from './sfx.js';

/* ========================================================================= */
/* TOASTS                                                                    */
/* ========================================================================= */

let toastHost = null;
function ensureToastHost() {
  if (!toastHost) {
    toastHost = h('.toast-host', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

const TOAST_ICON = { ok: 'checkCirc', error: 'xCirc', warn: 'warning', info: 'info' };

export function toast(opts) {
  const o = typeof opts === 'string' ? { title: opts } : opts;
  const kind = o.kind || 'ok';
  const dur = o.duration ?? (kind === 'error' ? 7000 : 3600);

  const life = h('.t-life');
  const el = h('.toast', { dataset: { kind } },
    h('.t-bar'),
    dur ? life : null,
    h('span.t-icon', raw(icon(TOAST_ICON[kind] || 'info', 17))),
    h('.t-body',
      h('.t-title', { text: o.title || '' }),
      o.message ? h('.t-msg', { text: o.message }) : null,
    ),
    o.action ? h('button.btn.btn-sm.btn-ghost', {
      text: o.action.label,
      onclick: () => { o.action.run(); dismiss(); },
    }) : null,
    h('button.btn.btn-sm.btn-ghost.btn-icon', {
      'aria-label': 'Dismiss', onclick: () => dismiss(),
    }, raw(icon('x', 13))),
  );

  let timer;
  function dismiss() {
    clearTimeout(timer);
    if (el.dataset.leaving) return;
    el.dataset.leaving = 'true';
    setTimeout(() => el.remove(), 240);
  }
  /* Hovering holds the toast open — and visibly pauses the countdown, so it is
     obvious the toast is waiting for you rather than about to vanish. */
  const hold = () => { clearTimeout(timer); el.dataset.held = 'true'; };
  const release = () => {
    el.dataset.held = 'false';
    if (dur) { life.style.transition = 'none'; life.style.transform = 'scaleX(1)'; timer = setTimeout(dismiss, 1600);
      requestAnimationFrame(() => { life.style.transition = ''; life.style.setProperty('--life', '1600ms'); life.style.transform = 'scaleX(0)'; }); }
  };
  el.addEventListener('mouseenter', hold);
  el.addEventListener('mouseleave', release);
  el.addEventListener('focusin', hold);

  // The toast is the outcome; the press already clicked.
  if (kind === 'error') sfx('error');
  else if (kind === 'ok' && o.chime !== false) sfx('ok');

  ensureToastHost().appendChild(el);
  const hosts = $$('.toast', toastHost);
  if (hosts.length > 4) hosts[0].remove();
  if (dur) {
    timer = setTimeout(dismiss, dur);
    life.style.setProperty('--life', `${dur}ms`);
    requestAnimationFrame(() => { life.style.transform = 'scaleX(0)'; });
  }
  return { dismiss, el };
}

export const toastOk    = (t, m) => toast({ title: t, message: m, kind: 'ok' });
export const toastError = (t, m) => toast({ title: t, message: m, kind: 'error' });
export const toastWarn  = (t, m) => toast({ title: t, message: m, kind: 'warn' });
export const toastInfo  = (t, m) => toast({ title: t, message: m, kind: 'info' });

/* ========================================================================= */
/* MODAL                                                                     */
/* ========================================================================= */

const modalStack = [];

export function modal(opts) {
  const {
    title, subtitle, body, footer, actions, width = 'normal',
    icon: iconName, dismissable = true, onClose, flush = false,
  } = opts;

  const content = h(`.modal${width === 'wide' ? '.modal-wide' : width === 'xwide' ? '.modal-xwide' : ''}`,
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });

  if (title || subtitle) {
    content.appendChild(h('.modal-head',
      iconName ? h('.mh-icon', { style: 'color:var(--accent);flex:none;margin-top:2px' }, raw(icon(iconName, 20))) : null,
      h('.mh-text',
        title ? h('h2', { text: title }) : null,
        subtitle ? h('p', { text: subtitle }) : null,
      ),
      dismissable ? h('button.btn.btn-sm.btn-ghost.btn-icon', {
        'aria-label': 'Close', onclick: () => close(),
      }, raw(icon('x', 15))) : null,
    ));
  }

  // `flush` hands the body its own edges — used when the content is itself a
  // full pane (an embedded editor) rather than a stack of form rows.
  const bodyEl = h(flush ? '.modal-body.modal-body-flush' : '.modal-body');
  if (body) bodyEl.appendChild(typeof body === 'function' ? body({ close }) : body);
  content.appendChild(bodyEl);

  if (actions?.length || footer) {
    const foot = h('.modal-foot');
    if (footer) foot.appendChild(footer);
    foot.appendChild(h('.spacer'));
    for (const a of actions || []) {
      foot.appendChild(h(`button.btn${a.primary ? '.btn-primary' : a.danger ? '.btn-danger-solid' : ''}`, {
        text: a.label,
        disabled: a.disabled,
        'data-autofocus': a.primary ? '' : null,
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (a.async) btn.classList.add('btn-loading');
          try { const r = await a.run?.({ close }); if (r !== false && a.closeAfter !== false) close(); }
          finally { btn.classList.remove('btn-loading'); }
        },
      }));
    }
    content.appendChild(foot);
  }

  const overlay = h('.overlay', {
    onclick: e => { if (e.target === overlay && dismissable) close(); },
  }, content);

  const untrap = trapFocus(content);
  const offKey = on(window, 'keydown', e => {
    if (e.key === 'Escape' && dismissable && modalStack[modalStack.length - 1] === api) { e.stopPropagation(); close(); }
  }, true);

  document.body.appendChild(overlay);
  sfx('open');

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    sfx('close');
    overlay.dataset.closing = 'true';
    offKey(); untrap();
    const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
    setTimeout(() => overlay.remove(), 180);
    onClose?.(result);
  }

  const api = { close, el: content, body: bodyEl, overlay };
  modalStack.push(api);
  return api;
}

export function confirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, icon: iconName,
} = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title, subtitle: message, icon: iconName || (danger ? 'warning' : 'alert'),
      actions: [
        { label: cancelLabel, run: () => { done = true; resolve(false); } },
        { label: confirmLabel, primary: !danger, danger, run: () => { done = true; resolve(true); } },
      ],
      onClose: () => { if (!done) resolve(false); },
    });
    void m;
  });
}

export function promptDialog({
  title, message, label, value = '', placeholder = '', confirmLabel = 'Save',
  validate, mono = false, hint,
} = {}) {
  return new Promise(resolve => {
    let done = false;
    let input;
    const err = h('.field-error', { hidden: true });

    const check = () => {
      const msg = validate?.(input.value);
      err.hidden = !msg;
      if (msg) err.textContent = msg;
      return !msg;
    };

    const m = modal({
      title, subtitle: message,
      body: h('.field',
        label ? h('label', { text: label }) : null,
        input = h('input.input', {
          class: mono ? 'input-mono' : '', value, placeholder,
          'data-autofocus': '',
          oninput: check,
          onkeydown: e => { if (e.key === 'Enter' && check()) { done = true; resolve(input.value); m.close(); } },
        }),
        hint ? h('.field-hint', { text: hint }) : null,
        err,
      ),
      actions: [
        { label: 'Cancel', run: () => { done = true; resolve(null); } },
        { label: confirmLabel, primary: true, run: () => {
            if (!check()) return false;
            done = true; resolve(input.value);
          } },
      ],
      onClose: () => { if (!done) resolve(null); },
    });
    queueMicrotask(() => input.select());
  });
}

/* ========================================================================= */
/* CONTEXT MENU                                                              */
/* ========================================================================= */

let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }

export function contextMenu(items, anchor) {
  closeMenu();
  const el = h('.menu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-' || it.type === 'sep') { el.appendChild(h('.menu-sep')); continue; }
    if (it.type === 'label') { el.appendChild(h('.menu-label', { text: it.label })); continue; }
    el.appendChild(h(`button.menu-item${it.destructive ? '.destructive' : ''}`, {
      role: 'menuitem', disabled: it.disabled,
      onclick: () => { closeMenu(); it.run?.(); },
    },
      it.icon ? raw(icon(it.icon, 14)) : h('span', { style: 'width:14px' }),
      h('span', { text: it.label }),
      it.key ? h('span.mi-key', { text: keyLabel(it.key) }) : null,
    ));
  }
  document.body.appendChild(el);

  const r = anchor instanceof Element ? anchor.getBoundingClientRect()
    : { left: anchor.x, top: anchor.y, bottom: anchor.y, right: anchor.x, width: 0, height: 0 };
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let x = anchor instanceof Element ? r.left : r.left;
  let y = anchor instanceof Element ? r.bottom + 6 : r.top;
  if (x + mw > innerWidth - 10) x = innerWidth - mw - 10;
  if (y + mh > innerHeight - 10) y = Math.max(10, (anchor instanceof Element ? r.top - mh - 6 : innerHeight - mh - 10));
  el.style.left = Math.max(8, x) + 'px';
  el.style.top = Math.max(8, y) + 'px';

  openMenu = el;
  setTimeout(() => {
    const offDown = on(window, 'pointerdown', e => {
      if (!el.contains(e.target)) { offDown(); offKey(); closeMenu(); }
    }, true);
    const offKey = on(window, 'keydown', e => {
      if (e.key === 'Escape') { offDown(); offKey(); closeMenu(); }
    }, true);
  }, 0);
  return el;
}

/* ========================================================================= */
/* FORM CONTROLS                                                             */
/* ========================================================================= */

export function field(label, control, hint) {
  return h('.field',
    label ? h('label', { text: label }) : null,
    control,
    hint ? h('.field-hint', { text: hint }) : null,
  );
}

export function textInput({ value = '', placeholder = '', mono = false, onInput, onChange, maxlength, ...rest } = {}) {
  return h(`input.input${mono ? '.input-mono' : ''}`, {
    value, placeholder, maxlength,
    oninput: e => onInput?.(e.target.value, e),
    onchange: e => onChange?.(e.target.value, e),
    ...rest,
  });
}

export function textArea({ value = '', placeholder = '', rows = 3, onInput } = {}) {
  return h('textarea.textarea', {
    placeholder, rows, oninput: e => onInput?.(e.target.value, e),
  }, value);
}

export function selectInput({ options, value, onChange, ...rest } = {}) {
  const el = h('select.select', {
    onchange: e => onChange?.(e.target.value, e), ...rest,
  }, ...options.map(o => h('option', {
    value: o.value ?? o.id, selected: (o.value ?? o.id) === value,
  }, o.label ?? o.name)));
  el.value = value;
  return el;
}

export function switchRow({ title, desc, checked, onChange, disabled }) {
  return h('.switch-row',
    h('.sr-text',
      h('.sr-title', { text: title }),
      desc ? h('.sr-desc', { text: desc }) : null,
    ),
    h('label.switch',
      h('input', { type: 'checkbox', checked, disabled, onchange: e => onChange?.(e.target.checked) }),
      h('.track', h('.thumb')),
    ),
  );
}

export function checkbox({ label, checked, onChange, disabled }) {
  return h('label.check',
    h('input', { type: 'checkbox', checked, disabled, onchange: e => onChange?.(e.target.checked) }),
    h('span.box', raw(icon('check', 11, { stroke: 2.6 }))),
    h('span', { text: label }),
  );
}

export function slider({ min = 0, max = 100, step = 1, value = 0, onInput, onChange, format, disabled }) {
  const out = h('span.slider-value');
  const input = h('input.slider', {
    type: 'range', min, max, step, value, disabled,
    oninput: e => { paint(); onInput?.(parseFloat(e.target.value)); },
    onchange: e => onChange?.(parseFloat(e.target.value)),
  });
  function paint() {
    const v = parseFloat(input.value);
    const pct = ((v - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
    out.textContent = format ? format(v) : String(v);
  }
  queueMicrotask(paint);
  const row = h('.slider-row', input, out);
  row.set = v => { input.value = v; paint(); };
  row.input = input;
  return row;
}

export function segmented({ options, value, onChange, block = false, large = false, tipPos = 'bottom' }) {
  const el = h(`.segmented${block ? '.seg-block' : ''}${large ? '.seg-lg' : ''}`, { role: 'group' });
  const paint = v => $$('button', el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  for (const o of options) {
    el.appendChild(h('button', {
      dataset: { v: o.value ?? o.id }, 'aria-pressed': 'false',
      /* `tip` gets the app's own tooltip; `hint` stays the native one, which
         is what the icon-only segments in the disc studio already use. */
      'data-tip': o.tip || '', 'data-tip-pos': tipPos,
      'aria-label': o.tip || o.label || String(o.value ?? o.id),
      title: o.hint || '',
      onclick: () => { paint(o.value ?? o.id); onChange?.(o.value ?? o.id); },
    }, o.icon ? raw(icon(o.icon, 13)) : null, o.label ? h('span', { text: o.label }) : null));
  }
  paint(value);
  el.set = paint;
  return el;
}

export function stepper({ value = 0, min = -Infinity, max = Infinity, step = 1, onChange, width }) {
  let v = value;
  const input = h('input', {
    type: 'number', value: v, style: width ? `width:${width}px` : '',
    onchange: e => set(parseFloat(e.target.value)),
  });
  function set(n) {
    if (!isFinite(n)) n = min === -Infinity ? 0 : min;
    v = clamp(n, min, max);
    input.value = v;
    onChange?.(v);
  }
  const el = h('.stepper',
    h('button', { 'aria-label': 'Decrease', onclick: () => set(v - step) }, raw(icon('minus', 12))),
    input,
    h('button', { 'aria-label': 'Increase', onclick: () => set(v + step) }, raw(icon('plus', 12))),
  );
  el.set = n => { v = clamp(n, min, max); input.value = v; };
  return el;
}

/** Namespaced-id input with a fixed prefix chip. */
export function idInput({ prefix, value, onChange, placeholder = 'id' }) {
  const input = h('input.input.input-mono', {
    value, placeholder,
    oninput: e => {
      const cleaned = e.target.value.toLowerCase().replace(/[^a-z0-9_.\-]/g, '_');
      if (cleaned !== e.target.value) {
        const pos = e.target.selectionStart;
        e.target.value = cleaned;
        e.target.setSelectionRange(pos, pos);
      }
      onChange?.(cleaned);
    },
  });
  const el = h('.input-affix', h('.prefix', { text: prefix }), input);
  el.input = input;
  return el;
}

/* ---- Colour swatch button ---------------------------------------------- */
export function colorButton({ value, onChange, label, alpha = false }) {
  const sw = h('.swatch', { style: { background: value, width: '26px', height: '26px' }, title: label || value });
  sw.addEventListener('click', e => {
    e.stopPropagation();
    openColorPopover(sw, value, v => { value = v; sw.style.background = v; onChange?.(v); }, alpha);
  });
  sw.set = v => { value = v; sw.style.background = v; };
  return sw;
}

/** A compact colour picker in a popover — HSV square, hue, optional alpha. */
export function openColorPopover(anchor, initial, onChange, withAlpha = false) {
  closeMenu();
  const [r0, g0, b0, a0] = hexToRgba(initial);
  let rgb = [r0, g0, b0], alpha = a0;

  const pop = h('.menu', { style: 'padding:12px;min-width:212px' });
  const sv = h('.sv-area', { style: 'aspect-ratio:1.5/1' });
  const svCanvas = h('canvas', { width: 160, height: 106 });
  const svCur = h('.sv-cursor');
  sv.append(svCanvas, svCur);

  const hue = h('.hue-strip', { style: 'margin-top:10px' }, h('.strip-knob'));
  const alphaStrip = withAlpha ? h('.alpha-strip.checker.checker-sm', { style: 'margin-top:8px' },
    h('.a-grad'), h('.strip-knob')) : null;
  const hex = h('input.input.input-sm.input-mono', { style: 'margin-top:10px;text-transform:uppercase' });

  add(pop, sv, hue, alphaStrip, hex);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - pop.offsetWidth - 10, r.left) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 10, r.bottom + 6) + 'px';
  openMenu = pop;

  const toHsv = rgbToHsv, toRgb = hsvToRgb;

  let [H, S, V] = toHsv(rgb[0], rgb[1], rgb[2]);

  function paint() {
    const g = svCanvas.getContext('2d');
    const w = svCanvas.width, hgt = svCanvas.height;
    const base = toRgb(H, 1, 1);
    const gx = g.createLinearGradient(0, 0, w, 0);
    gx.addColorStop(0, '#fff'); gx.addColorStop(1, `rgb(${base[0]},${base[1]},${base[2]})`);
    g.fillStyle = gx; g.fillRect(0, 0, w, hgt);
    const gy = g.createLinearGradient(0, 0, 0, hgt);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, '#000');
    g.fillStyle = gy; g.fillRect(0, 0, w, hgt);

    svCur.style.left = (S * 100) + '%';
    svCur.style.top = ((1 - V) * 100) + '%';
    hue.querySelector('.strip-knob').style.left = (H / 360 * 100) + '%';
    rgb = toRgb(H, S, V);
    const hx = rgbaToHex(rgb[0], rgb[1], rgb[2], withAlpha ? alpha : 255);
    hex.value = hx.toUpperCase();
    svCur.style.background = hx;
    if (alphaStrip) {
      alphaStrip.querySelector('.a-grad').style.background =
        `linear-gradient(90deg, rgba(${rgb[0]},${rgb[1]},${rgb[2]},0), rgb(${rgb[0]},${rgb[1]},${rgb[2]}))`;
      alphaStrip.querySelector('.strip-knob').style.left = (alpha / 255 * 100) + '%';
    }
    onChange?.(hx);
  }

  const trackXY = (el, cb) => drag(el, {
    onStart: (c, e) => cb(pos(el, e)), onMove: (c, e) => cb(pos(el, e)),
  });
  const pos = (el, e) => {
    const b = el.getBoundingClientRect();
    return { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) };
  };
  trackXY(sv, p => { S = p.x; V = 1 - p.y; paint(); });
  trackXY(hue, p => { H = p.x * 360; paint(); });
  if (alphaStrip) trackXY(alphaStrip, p => { alpha = Math.round(p.x * 255); paint(); });
  hex.addEventListener('input', () => {
    const v = hex.value.trim();
    if (/^#?[0-9a-fA-F]{3,8}$/.test(v)) {
      const [rr, gg, bb, aa] = hexToRgba(v);
      [H, S, V] = toHsv(rr, gg, bb); alpha = aa; paint();
    }
  });

  paint();
  setTimeout(() => {
    const off = on(window, 'pointerdown', e => { if (!pop.contains(e.target) && e.target !== anchor) { off(); closeMenu(); } }, true);
  }, 0);
  return pop;
}

/* ========================================================================= */
/* SECTIONS & MISC                                                           */
/* ========================================================================= */

const sectionState = new Map();

export function section(title, children, { open = true, key, count, actions } = {}) {
  const id = key || title;
  const isOpen = sectionState.has(id) ? sectionState.get(id) : open;
  /* The animated collapse needs exactly one child to measure, so the real
     content lives in an inner box and the outer one does the squeezing. */
  const inner = h('.section-inner', ...[].concat(children).filter(Boolean));
  const body = h('.section-body', inner);
  /* Tooltips are pseudo-elements that reach outside their host, so the inner
     box cannot simply stay clipped: it is clipped while closed, and while the
     row is animating, so the content does not spill out ahead of the sweep. */
  let animTimer = 0;
  const head = h('button.section-head', {
    'aria-expanded': String(isOpen),
    dataset: { sfx: isOpen ? 'close' : 'open' },
    onclick: () => {
      const next = el.dataset.open !== 'true';
      el.dataset.open = String(next);
      head.setAttribute('aria-expanded', String(next));
      head.dataset.sfx = next ? 'close' : 'open';
      sectionState.set(id, next);
      el.dataset.anim = '1';
      clearTimeout(animTimer);
      animTimer = setTimeout(() => { delete el.dataset.anim; }, 420);
    },
  },
    h('span.chev', raw(icon('chevDown', 12))),
    h('span', { text: title }),
    count != null ? h('span.badge-count', { text: String(count) }) : null,
  );
  const el = h('.section', { dataset: { open: String(isOpen) } }, head, body);
  body.addEventListener('transitionend', e => {
    if (e.target === body && e.propertyName === 'grid-template-rows') {
      clearTimeout(animTimer);
      delete el.dataset.anim;
    }
  });
  if (actions) {
    head.appendChild(h('span', { style: 'margin-left:auto;display:flex;gap:2px' }, actions));
  }
  el.body = inner;
  return el;
}

export function panel(title, children, { actions, pad = true } = {}) {
  return h('.panel',
    title ? h('.panel-head', h('h3', { text: title }), h('.spacer'), actions || null) : null,
    h(pad ? '.panel-body' : '', ...[].concat(children).filter(Boolean)),
  );
}

export function emptyState({ iconName = 'sparkle', scene: sceneName, title, message, action }) {
  let art = null;
  if (sceneName) {
    // Lazily pulled in so the illustration set never loads for a screen
    // that only ever shows a glyph.
    art = h('.e-scene');
    import('./pixelart.js').then(({ scene }) => {
      const c = scene(sceneName, 112);
      if (c) clear(art).appendChild(c);
    }).catch(() => { clear(art).appendChild(h('.e-art', raw(icon(iconName, 34)))); });
  } else {
    art = h('.e-art', raw(icon(iconName, 34)));
  }
  return h('.empty', art,
    h('h3', { text: title }),
    message ? h('p', { text: message }) : null,
    action || null,
  );
}

export function note(message, kind = 'info', iconName) {
  return h(`.note${kind !== 'info' ? '.note-' + kind : ''}`,
    h('span.n-icon', raw(icon(iconName || (kind === 'warn' ? 'warning' : kind === 'danger' ? 'alert' : kind === 'ok' ? 'checkCirc' : 'info'), 15))),
    h('span', typeof message === 'string' ? { text: message } : {}, typeof message === 'string' ? null : message),
  );
}

export function badge(text, kind = '') {
  return h(`span.badge${kind ? '.badge-' + kind : ''}`, { text });
}

export function iconButton(name, { tip, onClick, size = 15, cls = 'btn-ghost btn-sm', pos = 'top', disabled } = {}) {
  return h(`button.btn.btn-icon.${cls.split(' ').join('.')}`, {
    'data-tip': tip || '', 'data-tip-pos': pos, 'aria-label': tip || name,
    disabled, onclick: onClick,
  }, raw(icon(name, size)));
}

/** A code block with a copy button. */
export function codeBlock(text, { label } = {}) {
  const pre = h('pre.code', { text });
  return h('.col.g-2',
    label ? h('.eyebrow', { text: label }) : null,
    h('.copy-row', pre,
      h('button.btn.btn-sm', {
        'data-tip': 'Copy', 'data-tip-pos': 'left',
        onclick: async e => {
          const ok = await copyText(text);
          const b = e.currentTarget;
          b.innerHTML = ok ? icon('check', 13) : icon('x', 13);
          toast({ title: ok ? 'Copied' : 'Could not copy', kind: ok ? 'ok' : 'error', duration: 1600 });
          setTimeout(() => { b.innerHTML = icon('copy', 13); }, 1400);
        },
      }, raw(icon('copy', 13))),
    ),
  );
}

/** Progress bar with an optional label; call .set(0..1, text). */
export function progressBar({ label } = {}) {
  const bar = h('.bar', { style: 'width:0%' });
  const txt = h('.caption', { text: label || '' });
  const el = h('.col.g-2', txt, h('.progress', bar));
  el.set = (v, text) => {
    bar.style.width = clamp(v * 100, 0, 100) + '%';
    if (text != null) txt.textContent = text;
  };
  return el;
}

/** Drop target that calls back with a FileList. */
export function dropzone({ label, hint, accept, multiple = false, iconName = 'upload', onFiles }) {
  const el = h('.dropzone', { tabindex: 0, role: 'button' },
    h('.dz-icon', raw(icon(iconName, 26))),
    h('.strong', { text: label }),
    hint ? h('.caption', { text: hint }) : null,
  );
  const openPicker = () => {
    const inp = h('input', { type: 'file', accept, multiple, style: 'position:fixed;left:-9999px' });
    document.body.appendChild(inp);
    let done = false;
    const finish = () => { if (done) return; done = true; inp.remove(); };
    inp.addEventListener('change', () => { if (inp.files.length) onFiles([...inp.files]); finish(); });
    // Cancelling a file dialog fires no event, so clean up when focus returns.
    window.addEventListener('focus', () => setTimeout(finish, 600), { once: true });
    inp.click();
  };
  el.addEventListener('click', openPicker);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  el.addEventListener('dragover', e => { e.preventDefault(); el.dataset.over = 'true'; });
  el.addEventListener('dragleave', () => { el.dataset.over = 'false'; });
  el.addEventListener('drop', e => {
    e.preventDefault(); el.dataset.over = 'false';
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onFiles(multiple ? files : [files[0]]);
  });
  return el;
}

/* ========================================================================= */
/* REORDERABLE LIST                                                          */
/* ========================================================================= */

/**
 * Make a list drag-sortable.
 *
 * Rows carry their index in data-index; the callback gets (from, to) once, on
 * drop. Uses the HTML drag API rather than pointer maths so it inherits the
 * platform's own drag affordances — cursor, autoscroll, escape to cancel.
 *
 * @param {HTMLElement} listEl
 * @param {object} o { selector, onReorder(from,to), handle }
 */
export function makeSortable(listEl, { selector = '[data-index]', onReorder } = {}) {
  let fromIndex = null;

  const clearMarks = () => $$(selector, listEl).forEach(r => {
    delete r.dataset.dropbefore; delete r.dataset.dropafter; delete r.dataset.dragging;
  });

  const rows = () => $$(selector, listEl);

  for (const row of rows()) {
    row.draggable = true;

    row.addEventListener('dragstart', e => {
      fromIndex = Number(row.dataset.index);
      row.dataset.dragging = 'true';
      e.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without payload.
      e.dataTransfer.setData('text/plain', String(fromIndex));
    });

    row.addEventListener('dragend', () => { fromIndex = null; clearMarks(); });

    row.addEventListener('dragover', e => {
      if (fromIndex == null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      clearMarks();
      $$(selector, listEl).forEach(x => { if (Number(x.dataset.index) === fromIndex) x.dataset.dragging = 'true'; });
      row.dataset[before ? 'dropbefore' : 'dropafter'] = 'true';
    });

    row.addEventListener('drop', e => {
      e.preventDefault();
      if (fromIndex == null) return;
      const to = Number(row.dataset.index);
      const r = row.getBoundingClientRect();
      const before = (e.clientY - r.top) < r.height / 2;
      let target = before ? to : to + 1;
      // Removing the dragged row first shifts everything after it down one.
      if (fromIndex < target) target -= 1;
      clearMarks();
      const start = fromIndex;
      fromIndex = null;
      if (target !== start) { sfx('place'); onReorder?.(start, target); }
    });
  }

  listEl.addEventListener('dragleave', e => {
    if (!listEl.contains(e.relatedTarget)) clearMarks();
  });
}

export { uid };
