/* ============================================================================
   Command palette — one keystroke to anything.
   ========================================================================= */

import { h, raw, clear, on, $$ } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { fuzzyScore, keyLabel, clamp } from '../core/util.js';
;

let host = null;

export function openPalette(commands) {
  if (host) { closePalette(); return; }

  const input = h('input', { placeholder: 'Search sounds and commands…', 'aria-label': 'Command palette' });
  const list = h('.cmdk-list', { role: 'listbox' });
  const panel = h('.cmdk',
    h('.cmdk-input', h('span', { style: 'color:var(--text-4)' }, raw(icon('command', 17))), input),
    list,
    h('.cmdk-foot',
      h('span', h('kbd', '↑'), h('kbd', '↓'), ' navigate'),
      h('span', h('kbd', '↵'), ' run'),
      h('span', h('kbd', 'esc'), ' close'),
    ),
  );
  host = h('.cmdk-host', { onclick: e => { if (e.target === host) closePalette(); } }, panel);
  document.body.appendChild(host);

  let items = [];
  let index = 0;

  function render() {
    const q = input.value.trim();
    const scored = commands
      .map(c => ({ c, s: q ? Math.max(fuzzyScore(q, c.label), c.keywords ? fuzzyScore(q, c.keywords) : -1) : (c.weight || 0) }))
      .filter(x => x.s > 0 || (!q && x.c.always !== false))
      .sort((a, b) => b.s - a.s)
      .slice(0, 40);

    items = scored.map(x => x.c);
    index = clamp(index, 0, Math.max(0, items.length - 1));

    clear(list);
    if (!items.length) {
      list.appendChild(h('.p-6.center.caption.muted', { text: `Nothing matches “${q}”` }));
      return;
    }
    let lastGroup = null;
    items.forEach((c, i) => {
      if (c.group !== lastGroup) { list.appendChild(h('.cmdk-group', { text: c.group || 'Actions' })); lastGroup = c.group; }
      list.appendChild(h('button.cmdk-item', {
        role: 'option', 'aria-selected': String(i === index),
        dataset: { i },
        onmousemove: () => { if (index !== i) { index = i; paintSel(); } },
        onclick: () => run(c),
      },
        h('span.ci-icon', raw(icon(c.icon || 'chevRight', 15))),
        h('span.truncate', { text: c.label }),
        c.hint ? h('span.ci-hint', { text: c.hint }) : c.key ? h('span.ci-hint', { text: keyLabel(c.key) }) : null,
      ));
    });
    paintSel();
  }

  function paintSel() {
    $$('.cmdk-item', list).forEach(el => el.setAttribute('aria-selected', String(+el.dataset.i === index)));
    const sel = list.querySelector('.cmdk-item[aria-selected="true"]');
    sel?.scrollIntoView({ block: 'nearest' });
  }

  function run(c) {
    closePalette();
    setTimeout(() => c.run?.(), 10);
  }

  input.addEventListener('input', () => { index = 0; render(); });
  const offKey = on(window, 'keydown', e => {
    if (!host) return;
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); index = clamp(index + 1, 0, items.length - 1); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = clamp(index - 1, 0, items.length - 1); paintSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[index]) run(items[index]); }
  }, true);

  host._off = offKey;
  render();
  requestAnimationFrame(() => input.focus());
}

export function closePalette() {
  if (!host) return;
  host._off?.();
  host.remove();
  host = null;
}

export const paletteOpen = () => !!host;
