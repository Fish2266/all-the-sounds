/* ============================================================================
   All The Sounds — entry point.
   ========================================================================= */

import { $, h, raw, on } from './core/dom.js';
import { sleep } from './core/util.js';
import { icon } from './core/icons.js';
import { state, loadPrefs, refreshLibrary, setRoute, openProject, saveProject, bus } from './core/store.js';
import { Prefs, openDB } from './core/db.js';
import { installTextures } from './ui/textures.js';
import { loadSoundList, listMeta } from './core/soundlist.js';
import { restoreGameLink } from './core/gamelink.js';
import { installFavicon, drawMark } from './ui/brandmark.js';
import { buildShell } from './ui/shell.js';
import { buildLibraryView } from './ui/views/library.js';
import { buildSoundsView } from './ui/views/sounds.js';
import { buildExportView } from './ui/views/export.js';
import { toast } from './ui/kit.js';
import { installSfx } from './ui/sfx.js';
import { installTooltips } from './ui/tooltip.js';
import { loadEncoder, encoderStatus } from './audio/engine.js';

const BOOT_BLOCKS = 12;

async function boot() {
  const startedAt = performance.now();
  const bootEl = $('#boot');
  const bootTag = $('#boot-tag');
  const bootBar = $('#boot-bar');

  const markEl = $('#boot-mark');
  if (markEl) drawMark(markEl, 128);

  const blocks = [];
  if (bootBar) {
    for (let i = 0; i < BOOT_BLOCKS; i++) {
      const b = document.createElement('i');
      bootBar.appendChild(b);
      blocks.push(b);
    }
  }
  let filled = 0;
  const say = (text, progress) => {
    if (bootTag) bootTag.textContent = text;
    if (progress == null) return;
    const target = Math.round(progress * BOOT_BLOCKS);
    for (; filled < target; filled++) blocks[filled]?.setAttribute('data-on', 'true');
  };

  try {
    say('Opening storage', 0.1);
    await openDB();

    say('Reading your preferences', 0.2);
    await loadPrefs();
    installTextures();
    installFavicon();

    say('Listing every sound', 0.36);
    await loadSoundList();

    // The linked game's own list replaces the bundled one, so it has to be in
    // place before anything draws a row.
    say('Looking for your game', 0.5);
    await restoreGameLink();

    say('Counting your packs', 0.62);
    await refreshLibrary();

    say('Assembling the studio', 0.74);
    const views = {
      library: buildLibraryView(),
      sounds: buildSoundsView(),
      export: buildExportView(),
    };
    const app = buildShell(views);
    document.body.insertBefore(app, bootEl);
    installSfx();
    installTooltips();

    say('Opening where you left off', 0.88);
    const last = await Prefs.get('lastProject', null);
    if (last) {
      try {
        await openProject(last);
        setRoute(await Prefs.get('lastRoute', 'sounds'), { force: true });
      } catch { setRoute('library', { force: true }); }
    } else {
      setRoute('library', { force: true });
    }
    bus.on('route', r => { if (r !== 'library') Prefs.set('lastRoute', r); });

    state.ready = true;
    say('Ready', 1);
    const held = Math.max(0, 420 - (performance.now() - startedAt));
    if (held) await sleep(held);
    // A frame normally ends the splash; the timer covers a tab opened in the
    // background, where frames do not run until it is looked at.
    const finish = () => {
      if (bootEl.dataset.done) return;
      bootEl.dataset.done = 'true';
      const drop = () => bootEl.remove();
      bootEl.addEventListener('transitionend', drop, { once: true });
      setTimeout(drop, 1200);
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 250);

    /* Warm the Ogg encoder in the background so the first build is instant. */
    const warm = () => loadEncoder().catch(() => {});
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2500);

    on(document, 'visibilitychange', () => {
      if (document.hidden && state.projectDirty) saveProject({ silent: true }).catch(() => {});
    });
    on(window, 'pagehide', () => { if (state.projectDirty) saveProject({ silent: true }).catch(() => {}); });

    const m = listMeta();
    console.info('%cAll The Sounds', 'font-weight:700;font-size:13px', `— ready. ${m.count} sounds from ${m.source === 'game' ? 'your game' : 'the bundled list'} (${m.version}).`, encoderStatus.state);
  } catch (e) {
    console.error(e);
    bootEl.innerHTML = '';
    bootEl.appendChild(h('.col.g-4.center.boot-error',
      h('span', { style: 'color:var(--danger)' }, raw(icon('alert', 34))),
      h('h1.title', { text: 'All The Sounds could not start' }),
      h('p.body', { text: e.message }),
      h('p.caption.muted', { text: 'This usually means the browser is blocking local storage, or the page was opened directly from the file system. Serve the folder over http and it will work.' }),
      h('button.btn.btn-lg.btn-primary', { onclick: () => location.reload() }, 'Try again'),
    ));
  }
}

on(window, 'error', e => {
  if (!state.ready) return;
  console.error(e.error || e.message);
});
on(window, 'unhandledrejection', e => {
  if (!state.ready) return;
  console.error('Unhandled:', e.reason);
  const msg = e.reason?.message || String(e.reason || '');
  if (msg && !/aborted|cancell?ed/i.test(msg)) {
    toast({ title: 'Something went wrong', message: msg.slice(0, 160), kind: 'error' });
  }
});

boot();
