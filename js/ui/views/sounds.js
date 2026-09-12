/* ============================================================================
   The sound board.

   Every sound in the game down the middle, grouped the way the game names
   them; categories and progress on the left; the chosen sound on the right
   with its originals, your takes and the record button.

   It is built for doing hundreds in a sitting, so the keyboard does it all:
   R records and R again keeps it, N jumps to the next sound you have not
   done, Space plays it back. The list is virtual — two thousand rows, a few
   dozen in the page at a time.
   ========================================================================= */

import { h, raw, clear, on, observeResize } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { clamp, plural, copyText, debounce } from '../../core/util.js';
import { state, bus, markDirty, selectEvent, selectTake, gcAssets } from '../../core/store.js';
import {
  soundList, getEvent, eventOrOrphan, searchEvents, resolveEntries, CATEGORIES,
  categoryLabel, listMeta, isStreamed, typicalVolume,
} from '../../core/soundlist.js';
import { soundEntry, takesFor, takeLength, takeEnd } from '../../core/project.js';
import { originalsState, hasOriginal } from '../../core/gamelink.js';
import { Capture, canCapture, toDb } from '../../audio/capture.js';
import {
  makeTake, takeFromFile, sourceBuffer, takePeaks, findSound, toggleTake,
  playOriginal, stopAudition, auditionId,
} from '../../audio/takes.js';
import {
  section, iconButton, note, badge, toast, segmented, switchRow, slider, stepper,
  field, emptyState, codeBlock,
} from '../kit.js';
import { trimEditor, drawPeaks, cssColor, formatClock } from '../waveform.js';
import { linkCard, openGameLinkDialog } from '../gamelinkui.js';
import { eventEntry } from '../../export/packbuild.js';

const ROW = 46, GROUP = 30, OVERSCAN = 360;
const IDLE_DISARM = 120000;

const done = id => (state.project?.sounds?.[id]?.takes?.length || 0) > 0;

function pickWeighted(entries) {
  const total = entries.reduce((n, e) => n + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const e of entries) { r -= e.weight ?? 1; if (r <= 0) return e; }
  return entries[entries.length - 1];
}

/* ---- Play buttons --------------------------------------------------------
   One sound plays at a time app-wide (audio/takes.js), and every button that
   can start one carries its id, so all of them can show which one is live. */
function syncPlay(el) {
  const playing = auditionId() === el.dataset.playId;
  if ((el.dataset.playing === 'true') === playing) return;
  el.dataset.playing = String(playing);
  const svg = el.querySelector('svg');
  if (svg) svg.replaceWith(raw(icon(playing ? 'stop' : 'play', +el.dataset.iconSize || 14)));
}

function playButton(id, run, { tip = 'Play', size = 14, cls = 'btn-ghost btn-sm', pos = 'top' } = {}) {
  const b = iconButton('play', { tip, size, cls, pos, onClick: e => { e.stopPropagation(); run(); } });
  b.dataset.playId = id;
  b.dataset.iconSize = String(size);
  b.dataset.quiet = '';          // a click sound on top of the sound it starts
  syncPlay(b);
  return b;
}

const kb = (k, label) => h('span', h('kbd', { text: k }), label);

export function buildSoundsView() {
  /* ======================================================================= */
  /* LAYOUT                                                                  */
  /* ======================================================================= */
  const catList = h('.snd-cats-list');
  const totalN = h('span.n'), totalOf = h('span.of'), totalBar = h('i');
  const listCaption = h('.caption.muted');
  const cats = h('aside.snd-cats',
    h('.snd-cats-head', h('.eyebrow', { text: 'Recorded' }), h('.snd-total', totalN, totalOf), h('.snd-bar', totalBar), listCaption),
    catList,
    h('.snd-cats-foot', linkCard()),
  );

  const search = h('input.input', {
    type: 'search', 'aria-label': 'Search sounds',
    oninput: debounce(() => { state.filter.q = search.value; rebuildRows(true); }, 70),
    onkeydown: e => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (events[0]) pick(events[0].id);
        search.blur();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        if (search.value) { search.value = ''; state.filter.q = ''; rebuildRows(true); } else search.blur();
      }
    },
  });
  const statusSeg = segmented({
    options: [{ value: 'all', label: 'All' }, { value: 'todo', label: 'To do' }, { value: 'done', label: 'Done' }],
    value: state.filter.status,
    onChange: v => { state.filter.status = v; rebuildRows(true); },
  });
  const catSel = h('select.select.snd-cat-select', {
    'aria-label': 'Category',
    onchange: e => { state.filter.cat = e.target.value; renderCats(); rebuildRows(true); },
  });
  const count = h('span.caption.muted.tnum');
  const spacer = h('.snd-spacer');
  const scroll = h('.snd-scroll', { role: 'listbox', 'aria-label': 'Sounds' }, spacer);
  const listEl = h('section.snd-list',
    h('.snd-list-head',
      h('.input-group', h('span.input-icon', raw(icon('search', 14))), search),
      catSel, statusSeg, count),
    scroll,
  );

  const inspScroll = h('.insp-scroll');
  const insp = h('aside.snd-insp', inspScroll);
  const view = h('.view', { dataset: { view: 'sounds' } }, h('.snd-layout', cats, listEl, insp));

  /* ======================================================================= */
  /* CATEGORIES                                                              */
  /* ======================================================================= */
  function renderCats() {
    const totals = {}, dones = {};
    let all = 0, allDone = 0;
    for (const ev of soundList()) {
      totals[ev.cat] = (totals[ev.cat] || 0) + 1; all++;
      if (done(ev.id)) { dones[ev.cat] = (dones[ev.cat] || 0) + 1; allDone++; }
    }
    const row = (id, label, d, n, cat) => h('button.cat-row', {
      'aria-current': String(state.filter.cat === id),
      dataset: { sfx: 'select' },
      onclick: () => { state.filter.cat = id; renderCats(); rebuildRows(true); },
    },
      h('span.cat-name.truncate', { text: label }),
      h('span.cat-count', { text: `${d.toLocaleString()}/${n.toLocaleString()}` }),
      // Both shades go in as properties; the stylesheet picks one per theme.
      h('.cat-bar', h('i', { style: `width:${n ? (d / n) * 100 : 0}%${cat ? `;--cat:${cat.color};--cat-light:${cat.light}` : ''}` })),
    );
    catList.replaceChildren(
      row('all', 'Every sound', allDone, all),
      h('.cat-sep'),
      ...CATEGORIES.filter(c => totals[c.id]).map(c => row(c.id, c.label, dones[c.id] || 0, totals[c.id], c)),
    );
    totalN.textContent = allDone.toLocaleString();
    totalOf.textContent = `of ${all.toLocaleString()}`;
    totalBar.style.width = `${all ? (allDone / all) * 100 : 0}%`;
    const m = listMeta();
    listCaption.textContent = m.source === 'game'
      ? `List read from your game · ${m.version}`
      : `List from ${m.version}${m.snapshot ? `, plus the ${m.snapshot.split('-')[0]} snapshot` : ''}`;
    search.placeholder = `Search ${all.toLocaleString()} sounds…`;
    catSel.replaceChildren(
      h('option', { value: 'all' }, `Every sound · ${allDone}/${all}`),
      ...CATEGORIES.filter(c => totals[c.id]).map(c => h('option', { value: c.id }, `${c.label} · ${dones[c.id] || 0}/${totals[c.id]}`)),
    );
    catSel.value = state.filter.cat;
  }

  /* ======================================================================= */
  /* THE LIST                                                                */
  /* ======================================================================= */
  let events = [];
  let rows = [];
  let evIndex = new Map();      // event id -> index into rows
  const cache = new Map();      // row key -> element in the page
  let emptyEl = null;

  function rebuildRows(resetScroll = false) {
    const f = state.filter;
    const q = f.q.trim();
    const filter = f.status === 'done' ? ev => done(ev.id) : f.status === 'todo' ? ev => !done(ev.id) : null;
    events = searchEvents(q, { cat: f.cat, filter });
    // Takes for an event the current list does not know are never hidden.
    if (!q && f.status !== 'todo' && state.project) {
      const orphans = Object.keys(state.project.sounds)
        .filter(id => !getEvent(id) && done(id)).map(eventOrOrphan)
        .filter(ev => f.cat === 'all' || ev.cat === f.cat);
      events = events.concat(orphans);
    }

    rows = []; evIndex = new Map();
    let y = 6, last = null;
    const counts = new Map();
    if (!q) {
      for (const ev of events) {
        const k = `${ev.cat}|${ev.group}|${!!ev.orphan}`;
        const c = counts.get(k) || { n: 0, d: 0 };
        c.n++; if (done(ev.id)) c.d++;
        counts.set(k, c);
      }
    }
    for (const ev of events) {
      if (!q) {
        const k = `${ev.cat}|${ev.group}|${!!ev.orphan}`;
        if (k !== last) {
          rows.push({ type: 'group', key: k, label: ev.orphan ? `${ev.groupLabel} · not in this version` : ev.groupLabel, count: counts.get(k), top: y });
          y += GROUP; last = k;
        }
      }
      evIndex.set(ev.id, rows.length);
      rows.push({ type: 'ev', ev, top: y });
      y += ROW;
    }
    spacer.style.height = `${y + 24}px`;
    for (const el of cache.values()) el.remove();
    cache.clear();
    emptyEl?.remove(); emptyEl = null;
    if (!events.length) {
      const [title, message] = q ? ['Nothing called that', `No sound matches “${q}”.`]
        : f.status === 'todo' ? ['All done here', 'Every sound in this category has a take.']
        : ['Nothing recorded here yet', 'Pick a sound and press R.'];
      emptyEl = h('.snd-empty', emptyState({ iconName: q ? 'search' : 'checkCirc', title, message }));
      scroll.appendChild(emptyEl);
    }
    count.textContent = plural(events.length, 'sound');
    if (resetScroll) scroll.scrollTop = 0;
    renderWindow();
  }

  function renderWindow() {
    const top = scroll.scrollTop, bottom = top + scroll.clientHeight;
    const from = top - OVERSCAN;
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].top + ROW < from) lo = mid + 1; else hi = mid; }
    const keep = new Set();
    for (let i = lo; i < rows.length && rows[i].top < bottom + OVERSCAN; i++) {
      const r = rows[i];
      const key = r.type === 'ev' ? r.ev.id : `g:${r.key}`;
      keep.add(key);
      if (cache.has(key)) continue;
      const el = r.type === 'ev' ? evRow(r.ev) : groupRow(r);
      el.style.transform = `translateY(${r.top}px)`;
      cache.set(key, el);
      spacer.appendChild(el);
    }
    for (const [k, el] of cache) if (!keep.has(k)) { el.remove(); cache.delete(k); }
  }
  let rafQueued = false;
  on(scroll, 'scroll', () => {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => { rafQueued = false; renderWindow(); });
  }, { passive: true });
  observeResize(scroll, () => renderWindow());

  const groupRow = r => h('.ev-group',
    h('span.truncate', { text: r.label }),
    r.count ? h('span.eg-count', { dataset: { full: String(r.count.d === r.count.n) }, text: `${r.count.d}/${r.count.n}` }) : null,
  );

  function evRow(ev) {
    const n = takesFor(state.project, ev.id).length;
    const variants = resolveEntries(ev).length;
    return h('.ev-row', {
      role: 'option', 'aria-selected': String(state.selEvent === ev.id),
      dataset: { id: ev.id, done: String(n > 0), sfx: 'select' },
      onclick: () => pick(ev.id),
    },
      h('span.ev-slot'),
      h('.ev-main', h('span.ev-title.truncate', { text: ev.label }), h('span.ev-id.truncate', { text: ev.id })),
      h('.ev-meta',
        ev.since ? h('span.ev-chip.snap', { text: ev.since, 'data-tip': `New in the ${ev.since} snapshot`, 'data-tip-pos': 'left' }) : null,
        n ? h('span.ev-chip.mine', { 'data-tip': `${plural(n, 'take')} of yours`, 'data-tip-pos': 'left' }, raw(icon('mic', 10)), h('span', { text: String(n) })) : null,
        variants ? h('span.ev-chip.orig', { 'data-tip': `${plural(variants, 'original')} in the game`, 'data-tip-pos': 'left' }, raw(icon('waveform', 10)), h('span', { text: String(variants) })) : null,
        variants ? playButton(`ev:${ev.id}`, () => playRandomOriginal(ev), { tip: 'Hear an original  O', size: 13, cls: 'btn-ghost btn-sm ev-play', pos: 'left' }) : null,
      ),
    );
  }

  function pick(id) { selectEvent(id); }

  function ensureVisible(id) {
    const i = evIndex.get(id);
    if (i == null) return;
    const top = rows[i].top, bot = top + ROW, pad = 36;
    if (top < scroll.scrollTop + pad) scroll.scrollTop = Math.max(0, top - pad - GROUP);
    else if (bot > scroll.scrollTop + scroll.clientHeight - pad) scroll.scrollTop = bot - scroll.clientHeight + pad;
    renderWindow();
  }

  function move(delta) {
    if (!events.length) return;
    const i = events.findIndex(e => e.id === state.selEvent);
    const next = events[clamp(i < 0 ? 0 : i + delta, 0, events.length - 1)];
    if (next) pick(next.id);
  }

  /** The next sound in list order that has no take, ignoring the Done/To do
   *  filter so it still works when the current sound just dropped out of it. */
  function nextTodo() {
    const order = searchEvents(state.filter.q, { cat: state.filter.cat });
    if (!order.length) return;
    const i = order.findIndex(e => e.id === state.selEvent);
    for (let k = 1; k <= order.length; k++) {
      const ev = order[(i + k + order.length) % order.length];
      if (!done(ev.id)) { pick(ev.id); return; }
    }
    toast({
      title: 'Nothing left to do here',
      message: state.filter.cat === 'all' ? 'Every sound in the game has a take. That is all of them.' : `Every sound in ${categoryLabel(state.filter.cat)} has a take.`,
      kind: 'ok',
    });
  }

  /* ======================================================================= */
  /* INSPECTOR                                                               */
  /* ======================================================================= */
  let recUI = null;     // the record panel's live parts
  let edUI = null;      // the open take editor
  let packUI = null;    // the sounds.json preview
  let inspected = null;

  function renderInspector() {
    recUI = null; edUI = null; packUI = null;
    const p = state.project, id = state.selEvent;
    if (!p || !id) {
      inspScroll.replaceChildren(emptyState({
        iconName: 'volume', title: 'Pick a sound',
        message: 'Choose one from the list to hear the original and record your own — or press N for the first one you have not done.',
      }));
      inspected = null;
      return;
    }
    const ev = eventOrOrphan(id);
    const keep = inspected === id ? inspScroll.scrollTop : 0;
    inspScroll.replaceChildren(headBlock(ev), originalsSection(ev), recordSection(ev), takesSection(ev), packSection(ev));
    inspScroll.scrollTop = keep;
    inspected = id;
  }

  function headBlock(ev) {
    return h('.insp-head',
      h('.eyebrow', { text: `${categoryLabel(ev.cat)} · ${ev.groupLabel}` }),
      h('h2.insp-title', { text: ev.label }),
      h('.insp-id',
        h('span.truncate', { text: ev.id }),
        h('button', {
          'aria-label': 'Copy the id', 'data-tip': 'Copy the id', 'data-tip-pos': 'top',
          onclick: async () => {
            const ok = await copyText(ev.id);
            toast({ title: ok ? 'Copied' : 'Could not copy', message: ev.id, kind: ok ? 'ok' : 'error', duration: 1400 });
          },
        }, raw(icon('copy', 12))),
      ),
      h('.insp-badges',
        ev.orphan ? badge('Not in this version', 'warn') : null,
        ev.since ? badge(`New in ${ev.since}`, 'warn') : null,
        isStreamed(ev) ? badge('Streamed', 'info') : null,
        done(ev.id) ? badge(soundEntry(state.project, ev.id).mode === 'mix' ? 'Mixed with vanilla' : 'Replaced', 'accent') : null,
      ),
    );
  }

  /* ---- Originals ---- */
  function originalsSection(ev) {
    const entries = resolveEntries(ev);
    const body = h('.col.g-2');
    const st = originalsState();
    if (!entries.length) {
      body.appendChild(h('.caption.muted', { text: 'This sound has no files of its own — the game plays nothing for it unless a pack adds some.' }));
    } else if (st === 'unlinked' || st === 'relink') {
      body.append(
        h('.caption.muted', { text: `${plural(entries.length, 'file')} in the game. ${st === 'relink' ? 'Pick your game folder again' : 'Link your game folder'} to hear them — this app ships none of Mojang’s audio.` }),
        h('.row', h('button.btn.btn-sm', { onclick: () => openGameLinkDialog() }, raw(icon('link', 13)), h('span', { text: st === 'relink' ? 'Pick the folder' : 'Link your game' }))),
      );
    } else {
      body.appendChild(h('.orig-grid', ...entries.map((e, i) => {
        const id = `orig:${ev.id}:${i}`;
        const tip = [
          `${e.name}.ogg`,
          e.volume != null && e.volume !== 1 ? `volume ${e.volume}` : null,
          e.pitch != null && e.pitch !== 1 ? `pitch ${e.pitch}` : null,
          e.weight != null && e.weight !== 1 ? `weight ${e.weight}` : null,
          e.stream ? 'streamed' : null,
        ].filter(Boolean).join('\n');
        const chip = h('button.orig-chip', {
          disabled: !hasOriginal(e.name),
          'data-tip': hasOriginal(e.name) ? tip : `${e.name}.ogg is not in your game folder`,
          dataset: { playId: id, iconSize: '11', quiet: '' },
          onclick: () => playOriginal(e, { id }).catch(err => toast({ title: 'Could not play that', message: err.message, kind: 'warn' })),
        }, raw(icon('play', 11)), h('span', { text: e.name.split('/').pop() }));
        syncPlay(chip);
        return chip;
      })));
      const via = [...new Set(entries.filter(e => e.via).map(e => e.via))];
      if (via.length) body.appendChild(h('.caption.muted', { text: `Borrowed from ${via.join(', ')}. Replacing that sound changes this one too — unless you record this one as well.` }));
      if (st === 'reconnect') body.appendChild(h('.caption.muted', { text: 'Your browser will ask to read the game folder again the first time one plays.' }));
    }
    return section('Originals', [body], { key: 'insp-orig', count: entries.length || null });
  }

  /* ---- Record ---- */
  function recordSection() {
    if (!canCapture()) {
      return section('Record', [note('This browser cannot record audio. Drop audio files anywhere on the page to add them as takes instead.', 'warn')], { key: 'insp-rec' });
    }
    const bars = h('.mic-bars');
    for (let i = 0; i < 28; i++) bars.appendChild(h('i'));
    const fill = h('.lm-fill');
    const time = h('span.rec-time', { text: formatClock(0) });
    const db = h('span.caption.mono', { text: '−∞ dB' });
    const orb = h('button.rec-orb', { 'aria-label': 'Record', 'data-tip': 'Record  R', 'data-tip-pos': 'top', onclick: () => toggleRecord() }, raw(icon('mic', 24)));
    const hint = h('.caption');
    // data-quiet: the interface clicks must never end up inside a take.
    const panel = h('.rec-panel', { dataset: { quiet: '' } },
      h('.row.g-3.items-center', orb, h('.col.g-2.grow', h('.row.between.items-center', time, db), h('.level-meter', fill), bars)),
      hint,
      h('.kbd-row', kb('R', 'record · keep'), kb('Esc', 'discard'), kb('Space', 'play'), kb('N', 'next to do')),
    );
    recUI = { panel, orb, time, db, fill, bars, hint };
    paintRec();
    return section('Record', [panel], { key: 'insp-rec' });
  }

  function paintRec() {
    if (!recUI) return;
    const s = cap?.state || 'idle';
    const recording = s === 'recording';
    recUI.panel.dataset.state = s;
    recUI.orb.dataset.armed = String(recording);
    recUI.orb.replaceChildren(raw(icon(recording ? 'stop' : 'mic', recording ? 22 : 24)));
    recUI.orb.setAttribute('aria-label', recording ? 'Stop and keep' : 'Record');
    const elsewhere = recording && recTarget && recTarget !== state.selEvent ? eventOrOrphan(recTarget).label : null;
    recUI.hint.textContent = recording
      ? `Recording${elsewhere ? ` for “${elsewhere}”` : ''} — R keeps it, Esc throws it away.`
      : s === 'ready' ? 'Mic is live. Press R and make the sound — the quiet either side gets trimmed off.'
      : 'Press R or the button. The first press asks to use your microphone.';
  }

  function paintLevel(peak, bands) {
    if (!recUI?.panel.isConnected) return;
    recUI.fill.style.width = `${clamp(peak * 100, 0, 100)}%`;
    recUI.db.textContent = peak > 0.0002 ? `${toDb(peak).toFixed(1)} dB` : '−∞ dB';
    const kids = recUI.bars.children;
    for (let i = 0; i < kids.length; i++) kids[i].style.height = `${Math.max(8, bands[i] * 100)}%`;
  }

  /* ---- Takes ---- */
  function takesSection(ev) {
    const takes = takesFor(state.project, ev.id);
    const body = h('.col.g-3');
    if (!takes.length) {
      body.appendChild(h('.caption.muted', { text: 'Nothing recorded yet. Record as many takes as you like — the game picks one at random each time it plays this sound, the same way it picks among the originals.' }));
    } else {
      body.appendChild(h('.take-list', ...takes.map((t, i) => takeRow(ev, t, i))));
      const sel = takes.find(t => t.key === state.selTake);
      body.appendChild(sel ? takeEditor(ev, sel) : h('.caption.muted', { text: 'Select a take to trim it, or to change how it sits in the game.' }));
    }
    body.appendChild(h('.caption.muted', { text: 'Drop audio files anywhere on the page to add them as takes here.' }));
    return section('Your takes', [body], { key: 'insp-takes', count: takes.length || null });
  }

  function takeRow(ev, t, i) {
    const cvs = h('canvas.tk-wave', { width: 360, height: 56 });
    const len = h('span.tk-len');
    const row = h('.take-row', {
      role: 'button', tabindex: 0,
      'aria-selected': String(state.selTake === t.key),
      dataset: { sfx: 'select', take: t.key },
      onclick: () => { selectTake(state.selTake === t.key ? null : t.key); renderInspector(); },
    },
      h('span.tk-num', { text: String(i + 1) }),
      cvs,
      h('.tk-side', len,
        playButton(`take:${t.key}`, () => toggleTake(t).catch(e => toast({ title: 'Could not play that', message: e.message, kind: 'warn' }))),
        iconButton('trash', { tip: 'Delete take', pos: 'left', cls: 'btn-ghost btn-sm btn-danger', onClick: e => { e.stopPropagation(); deleteTake(ev.id, t); } }),
      ),
    );
    row._paint = () => {
      len.textContent = `${takeLength(t).toFixed(2)}s`;
      sourceBuffer(t).then(buf => {
        drawPeaks(cvs, takePeaks(t, buf), { duration: t.durationSec, view: [t.trimStart || 0, takeEnd(t)], on: cssColor('--mine'), fit: true });
      }).catch(() => {});
    };
    row._paint();
    return row;
  }

  const repaintTakeRow = t => inspScroll.querySelector(`.take-row[data-take="${t.key}"]`)?._paint?.();

  function takeEditor(ev, t) {
    const host = h('div', h('.wave-shell', h('.wave-empty', { text: 'Loading…' })));
    let te = null, buf = null;
    const changed = (final = true) => {
      repaintTakeRow(t);
      if (final) { markDirty('take'); paintPack(); }
    };
    sourceBuffer(t).then(b => {
      buf = b;
      te = trimEditor({
        duration: t.durationSec, peaks: takePeaks(t, b),
        start: t.trimStart || 0, end: takeEnd(t),
        onChange: (s, e, final) => { t.trimStart = s; t.trimEnd = e >= t.durationSec - 0.002 ? 0 : e; changed(final); },
        onSeek: () => toggleTake(t).catch(() => {}),
      });
      host.replaceChildren(te);
      edUI = { key: t.key, te, take: t };
    }).catch(e => host.replaceChildren(note(e.message, 'danger')));

    const gainDb = t.gain > 0 ? Math.round(20 * Math.log10(t.gain) * 2) / 2 : 0;
    return h('.tk-editor',
      host,
      h('.row.g-2.wrap',
        h('button.btn.btn-sm', {
          onclick: () => {
            if (!buf) return;
            const { start, end } = findSound(buf);
            t.trimStart = start; t.trimEnd = end;
            te?.set(start, end || t.durationSec);
            changed();
          },
        }, raw(icon('scissors', 13)), h('span', { text: 'Trim the silence' })),
        h('button.btn.btn-sm.btn-ghost', {
          onclick: () => { t.trimStart = 0; t.trimEnd = 0; te?.set(0, t.durationSec); changed(); },
        }, h('span', { text: 'Use all of it' })),
        h('.spacer'),
        playButton(`take:${t.key}`, () => toggleTake(t).catch(() => {}), { tip: 'Play  Space', cls: 'btn-sm' }),
      ),
      h('.col.g-1',
        switchRow({
          title: 'Normalise', desc: 'Bring the loudest moment to −1 dB, so every take sits at the same level.',
          checked: !!t.normalize, onChange: v => { t.normalize = v; changed(); },
        }),
        field('Gain', slider({
          min: -18, max: 12, step: 0.5, value: gainDb,
          format: v => `${v > 0 ? '+' : ''}${v} dB`,
          onChange: v => { t.gain = Math.pow(10, v / 20); changed(); },
        })),
        h('.tk-controls',
          field('Fade in', slider({ min: 0, max: 200, step: 1, value: Math.round((t.fadeIn || 0) * 1000), format: v => `${v} ms`, onChange: v => { t.fadeIn = v / 1000; changed(); } })),
          field('Fade out', slider({ min: 0, max: 500, step: 5, value: Math.round((t.fadeOut || 0) * 1000), format: v => `${v} ms`, onChange: v => { t.fadeOut = v / 1000; changed(); } })),
        ),
        switchRow({
          title: 'Mono', desc: 'Minecraft only places mono sounds in the world. A stereo take plays flat, wherever it happens.',
          checked: t.mono !== false, onChange: v => { t.mono = v; changed(); },
        }),
      ),
      h('.col.g-2',
        h('.eyebrow', { text: 'In the game' }),
        h('.tk-controls',
          field('Volume', slider({ min: 5, max: 100, step: 5, value: Math.round((t.volume ?? 1) * 100), format: v => `${v}%`, onChange: v => { t.volume = v / 100; changed(); } })),
          field('Pitch', slider({ min: 50, max: 200, step: 5, value: Math.round((t.pitch ?? 1) * 100), format: v => `${(v / 100).toFixed(2)}×`, onChange: v => { t.pitch = v / 100; changed(); } })),
          h('.span-2', field('Weight', stepper({ value: t.weight ?? 1, min: 1, max: 50, onChange: v => { t.weight = v; changed(); } }), 'How often the game picks this take, compared with the others.')),
        ),
      ),
    );
  }

  /* ---- In the pack ---- */
  function packSection(ev) {
    const body = h('.col.g-3');
    packUI = { body, ev };
    paintPack();
    return section('In the pack', [body], { key: 'insp-pack', open: false });
  }

  function paintPack() {
    if (!packUI) return;
    const { body, ev } = packUI;
    const entry = soundEntry(state.project, ev.id);
    clear(body);
    if (!entry?.takes?.length) {
      body.appendChild(h('.caption.muted', { text: 'Once there is a take, this shows exactly what goes into the pack for it.' }));
      return;
    }
    body.append(
      segmented({
        options: [{ value: 'replace', label: 'Replace vanilla' }, { value: 'mix', label: 'Mix with vanilla' }],
        value: entry.mode, block: true,
        onChange: v => { entry.mode = v; markDirty('mode'); paintPack(); },
      }),
      h('.caption.muted', {
        text: entry.mode === 'mix'
          ? 'Your takes join the originals in the pool, so the game sometimes plays yours and sometimes Mojang’s.'
          : 'Only your takes play. The subtitle is written back in, so it stays the game’s own.',
      }),
      codeBlock(JSON.stringify({ [ev.id]: eventEntry(state.project, ev.id) }, null, 2), { label: 'assets/minecraft/sounds.json' }),
    );
  }

  /* ======================================================================= */
  /* RECORDING                                                               */
  /* ======================================================================= */
  let cap = null;
  let recTarget = null;
  let idleTimer = 0;

  async function ensureArmed() {
    if (cap && cap.state !== 'idle') return true;
    if (!canCapture()) {
      toast({ title: 'Recording is not available here', message: 'This browser cannot capture audio. Drop audio files onto the page instead.', kind: 'warn' });
      return false;
    }
    if (!cap) {
      cap = new Capture();
      cap.onLevel = (rms, peak, bands) => paintLevel(peak, bands);
      cap.onTime = t => { if (recUI?.time.isConnected) recUI.time.textContent = formatClock(t); };
      cap.onState = s => {
        paintRec();
        bus.emit('mic', s !== 'idle');
        // While a take is running, nothing in this view may click.
        view.toggleAttribute('data-quiet', s === 'recording');
      };
    }
    const pr = state.prefs;
    try {
      await cap.arm({
        deviceId: pr.inputDevice, echoCancellation: !!pr.echoCancellation,
        noiseSuppression: !!pr.noiseSuppression, autoGainControl: !!pr.autoGainControl,
      });
      return true;
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      toast({
        title: denied ? 'Microphone blocked' : 'Microphone unavailable',
        message: denied ? 'Allow microphone access for this site in your browser, then press R again.' : e.message,
        kind: 'error',
      });
      return false;
    }
  }

  async function toggleRecord() {
    if (cap?.state === 'recording') return finishRecording();
    return startRecording();
  }

  async function startRecording() {
    if (!state.project || !state.selEvent) { toast({ title: 'Pick a sound first', kind: 'warn', duration: 1800 }); return; }
    stopAudition();
    if (!(await ensureArmed())) return;
    clearTimeout(idleTimer);
    recTarget = state.selEvent;
    cap.start();
  }

  async function finishRecording({ keep = true } = {}) {
    if (cap?.state !== 'recording') return;
    const id = recTarget;
    recTarget = null;
    const res = await cap.stop();
    armIdle();
    if (!keep) { toast({ title: 'Take thrown away', kind: 'info', duration: 1200 }); return; }
    if (!res) {
      toast({ title: 'Nothing came through', message: 'Check that the meter moves when you make a sound — the input may be muted.', kind: 'warn' });
      return;
    }
    // A muted input still delivers samples — all zeros. Keeping that as a
    // take would ship a sound that silently deletes the original.
    const d = res.buffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    if (peak < 0.0015) {
      toast({ title: 'Only silence came through', message: 'Nothing was kept. Check the input in Preferences, and that the meter moves when you make a sound.', kind: 'warn' });
      return;
    }
    const p = state.project;
    if (!p || !id) return;
    const entry = soundEntry(p, id, true);
    const take = await makeTake(res.buffer, { name: `take ${entry.takes.length + 1}`, source: 'mic', autoTrim: state.prefs.autoTrim !== false });
    take.volume = typicalVolume(eventOrOrphan(id));
    entry.takes.push(take);
    markDirty('take');
    if (res.clipped) {
      toast({ title: 'That take clipped', message: 'It hit the top of the meter. Back off the mic a little or turn the input down, then retake.', kind: 'warn' });
    }
    afterTakesChanged(id, take.key);
    if (state.prefs.autoPlay !== false) toggleTake(take).catch(() => {});
    if (state.prefs.advanceAfterTake && state.selEvent === id) nextTodo();
  }

  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (cap?.state === 'ready') cap.disarm(); }, IDLE_DISARM);
  }

  function disarm() {
    clearTimeout(idleTimer);
    if (cap && cap.state !== 'idle') cap.disarm();
  }

  function afterTakesChanged(id, selKey) {
    if (state.selEvent === id) {
      if (selKey !== undefined) state.selTake = selKey;
      renderInspector();
    }
    const keepTop = scroll.scrollTop;
    rebuildRows();
    scroll.scrollTop = keepTop;
    renderWindow();
    renderCats();
  }

  /* ---- Files ---- */
  async function addFiles(files) {
    const id = state.selEvent;
    if (!state.project || !id) { toast({ title: 'Pick a sound first', message: 'Dropped audio becomes takes for the sound you have open.', kind: 'warn' }); return; }
    const t = toast({ title: `Reading ${plural(files.length, 'file')}…`, kind: 'info', duration: 0 });
    let added = 0, failed = 0, last = null;
    const vol = typicalVolume(eventOrOrphan(id));
    for (const f of files) {
      try {
        const take = await takeFromFile(f, { autoTrim: state.prefs.autoTrim !== false });
        take.volume = vol;
        soundEntry(state.project, id, true).takes.push(take);
        last = take; added++;
      } catch { failed++; }
    }
    t.dismiss();
    if (added) {
      markDirty('import');
      afterTakesChanged(id, last.key);
      toast({ title: `${plural(added, 'take')} added`, message: eventOrOrphan(id).label, kind: 'ok' });
    }
    if (failed) toast({ title: `${plural(failed, 'file')} could not be read`, message: 'The browser could not decode it. WAV, MP3, Ogg, FLAC and M4A all work.', kind: 'warn' });
  }

  /* ---- Deleting ---- */
  let pendingUndo = 0;
  function deleteTake(id, t) {
    const p = state.project;
    const entry = soundEntry(p, id);
    const idx = entry?.takes.indexOf(t) ?? -1;
    if (idx < 0) return;
    if (auditionId() === `take:${t.key}`) stopAudition();
    const mode = entry.mode;
    entry.takes.splice(idx, 1);
    if (!entry.takes.length) delete p.sounds[id];
    if (state.selTake === t.key) state.selTake = null;
    markDirty('delete take');
    afterTakesChanged(id);
    let undone = false;
    pendingUndo++;
    toast({
      title: 'Take deleted', message: eventOrOrphan(id).label, kind: 'info', duration: 6000,
      action: {
        label: 'Undo',
        run: () => {
          undone = true;
          const e = soundEntry(p, id, true);
          e.mode = mode;
          e.takes.splice(Math.min(idx, e.takes.length), 0, t);
          markDirty('undo delete');
          afterTakesChanged(id, t.key);
        },
      },
    });
    // The audio is only let go once no undo could still want it.
    setTimeout(() => {
      pendingUndo--;
      if (!pendingUndo && state.project === p) gcAssets().catch(() => {});
    }, 8000);
    void undone;
  }

  /* ---- Playing ---- */
  async function playRandomOriginal(ev) {
    const st = originalsState();
    if (st === 'unlinked' || st === 'relink') { openGameLinkDialog(); return; }
    const entries = resolveEntries(ev).filter(e => hasOriginal(e.name));
    if (!entries.length) { toast({ title: 'No original to play', message: 'Your game folder has none of this sound’s files.', kind: 'info', duration: 2200 }); return; }
    try { await playOriginal(pickWeighted(entries), { id: `ev:${ev.id}` }); }
    catch (e) { toast({ title: 'Could not play the original', message: e.message, kind: 'warn' }); }
  }

  function selectedTake() {
    const takes = takesFor(state.project, state.selEvent);
    return takes.find(x => x.key === state.selTake) || null;
  }

  function playSelected() {
    const takes = takesFor(state.project, state.selEvent);
    const t = selectedTake() || takes[takes.length - 1];
    if (t) { toggleTake(t).catch(e => toast({ title: 'Could not play that', message: e.message, kind: 'warn' })); return; }
    const ev = getEvent(state.selEvent);
    if (ev) playRandomOriginal(ev);
  }

  /* ======================================================================= */
  /* WIRING                                                                  */
  /* ======================================================================= */
  on(window, 'keydown', e => {
    if (state.route !== 'sounds' || !state.project) return;
    if (document.querySelector('.overlay, .cmdk-host')) return;
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); search.focus(); search.select(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'r': case 'R': e.preventDefault(); if (!e.repeat) toggleRecord(); return;
      case 'Escape': if (cap?.state === 'recording') { e.preventDefault(); finishRecording({ keep: false }); } return;
      case ' ': e.preventDefault(); playSelected(); return;
      case 'o': case 'O': { e.preventDefault(); const ev = getEvent(state.selEvent); if (ev) playRandomOriginal(ev); return; }
      case 'ArrowDown': case 'j': case 'J': e.preventDefault(); move(1); return;
      case 'ArrowUp': case 'k': case 'K': e.preventDefault(); move(-1); return;
      case 'n': case 'N': e.preventDefault(); nextTodo(); return;
      case 'Delete': case 'Backspace': { const t = selectedTake(); if (t) { e.preventDefault(); deleteTake(state.selEvent, t); } return; }
      default:
        if (/^[1-9]$/.test(e.key)) {
          const t = takesFor(state.project, state.selEvent)[+e.key - 1];
          if (t) { e.preventDefault(); selectTake(t.key); renderInspector(); toggleTake(t).catch(() => {}); }
        }
    }
  });

  bus.on('select:event', () => {
    for (const [k, el] of cache) if (el.classList.contains('ev-row')) el.setAttribute('aria-selected', String(k === state.selEvent));
    ensureVisible(state.selEvent);
    renderInspector();
  });
  bus.on('audition', ({ id, playing }) => {
    for (const el of view.querySelectorAll('[data-play-id]')) syncPlay(el);
    if (edUI && id === `take:${edUI.key}`) edUI.te.setPlaying(playing);
  });
  bus.on('audition:tick', ({ id, progress }) => {
    if (!edUI || id !== `take:${edUI.key}`) return;
    const t = edUI.take;
    edUI.te.setPlayhead((t.trimStart || 0) + progress * takeLength(t));
  });
  bus.on('drop:audio', files => addFiles(files));
  bus.on('cmd:next-todo', () => nextTodo());
  bus.on('mic:off', () => {
    if (cap?.state === 'recording') finishRecording({ keep: false });
    disarm();
  });
  bus.on('route', r => {
    if (r === 'sounds') return;
    stopAudition();
    if (cap?.state === 'recording') finishRecording({ keep: false });
    disarm();
  });
  bus.on('project:close', () => { disarm(); stopAudition(); });
  bus.on('sounds:list', () => { if (state.route === 'sounds') refresh(); });
  const onGame = () => { if (state.route === 'sounds') { renderInspector(); rebuildRows(); } };
  bus.on('game:changed', onGame);
  bus.on('game:permission', () => { if (state.route === 'sounds') renderInspector(); });
  on(document, 'visibilitychange', () => { if (document.hidden && cap?.state === 'ready') disarm(); });

  function refresh() {
    if (!state.project) return;
    if (search.value !== state.filter.q) search.value = state.filter.q;
    statusSeg.set(state.filter.status);
    renderCats();
    rebuildRows();
    if (!state.selEvent && events.length) state.selEvent = events[0].id;
    renderInspector();
    ensureVisible(state.selEvent);
  }
  view.refresh = refresh;
  return view;
}
