/* ============================================================================
   Game link — the card in the sidebar and the dialog behind it.
   ========================================================================= */

import { h, raw, clear } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { IS_MAC, copyText, formatBytes } from '../core/util.js';
import { state, bindLive, setPref } from '../core/store.js';
import { formatLabel } from '../core/versions.js';
import {
  gameLink, originalsState, linkWithPicker, linkWithFiles, reconnect, unlinkGame,
  switchVersion, canRememberFolder, FOLDER_PATHS,
  canKeepCopy, keepCopy, dropCopy, copyStatus,
} from '../core/gamelink.js';
import { modal, toast, note, progressBar, field, selectInput, switchRow } from './kit.js';

const platform = () => (/Win/i.test(navigator.platform || navigator.userAgent) ? 'win' : IS_MAC ? 'mac' : 'linux');
const eventCount = d => Object.keys(d?.events || {}).length;
const keeping = () => canKeepCopy() && state.prefs.keepOriginals !== false;

/** After any successful link: keep a copy, or make sure none is left behind. */
function afterLink() {
  if (keeping()) {
    keepCopy().then(ok => {
      const c = copyStatus();
      if (ok) toast({ title: 'Originals kept', message: `${c.total.toLocaleString()} sound files are in this browser now — no folder to pick next time.`, kind: 'ok' });
      else if (c.state === 'nospace') toast({ title: 'Not enough room to keep a copy', message: 'The originals still play this visit. Free some disk space and link again to keep them.', kind: 'warn' });
      else if (c.state === 'partial') toast({ title: 'Some originals could not be copied', message: 'Those still play while the folder is linked; link again to fill the gaps.', kind: 'warn' });
    });
  } else {
    dropCopy();
  }
}

/** The compact status card: one line that says whether the originals can play. */
export function linkCard() {
  const el = h('button.link-card', { onclick: () => click() });
  const paint = () => {
    const s = originalsState();
    const d = gameLink.data;
    const c = copyStatus();
    el.dataset.state = s;
    let [title, sub] = {
      unlinked:  ['Link your game', 'Hear every original before you replace it'],
      ready:     [`Originals from ${d?.version}`, `${(d?.files || 0).toLocaleString()} sound files · ${d?.folder || ''}`],
      reconnect: ['Reconnect your game', 'The browser wants your OK to read it again'],
      relink:    ['Pick your game folder again', 'Needed once a visit to hear the originals'],
    }[s];
    if (c.state === 'copying') {
      title = 'Keeping the originals…';
      sub = `${c.done.toLocaleString()} of ${c.total.toLocaleString()} files · ${Math.floor((c.done / Math.max(1, c.total)) * 100)}%`;
    } else if (s === 'ready' && c.kept?.complete) {
      sub = `Kept in this browser · ${formatBytes(c.kept.bytes)}`;
    }
    el.replaceChildren(
      h('span.engine-dot'),
      h('.lc-main', h('span.lc-title.truncate', { text: title }), h('span.lc-sub.truncate', { text: sub })),
      raw(icon('chevRight', 13)),
    );
  };
  async function click() {
    if (originalsState() === 'reconnect') {
      try {
        if (await reconnect()) { toast({ title: 'Reconnected', message: 'The originals can play again.', kind: 'ok', duration: 1800 }); return; }
      } catch { /* fall through to the dialog */ }
    }
    openGameLinkDialog();
  }
  paint();
  bindLive(el, 'game:changed', paint);
  bindLive(el, 'game:permission', paint);
  bindLive(el, 'game:copy', paint);
  return el;
}

export function openGameLinkDialog() {
  const body = h('.col.g-4');
  const prog = progressBar({ label: '' });
  prog.hidden = true;
  const onProgress = (msg, pct) => { prog.hidden = false; prog.set(pct, msg); };

  async function run(fn) {
    try {
      await fn();
      prog.hidden = true;
      render();
      const d = gameLink.data;
      toast({ title: 'Game linked', message: `${d.version} — ${eventCount(d).toLocaleString()} sound events, ${d.files.toLocaleString()} files.`, kind: 'ok' });
      afterLink();
    } catch (e) {
      prog.hidden = true;
      if (e?.name === 'AbortError') return;       // the picker was cancelled
      toast({ title: 'Could not link that folder', message: e.message, kind: 'error' });
    }
  }

  function choose() {
    // Chrome's directory picker refuses ~/Library and AppData outright, so on
    // macOS and Windows the ordinary folder input is the only way in.
    if (canRememberFolder()) return run(() => linkWithPicker(onProgress));
    const inp = h('input', { type: 'file', style: 'position:fixed;left:-9999px' });
    inp.setAttribute('webkitdirectory', '');
    inp.setAttribute('directory', '');
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const files = [...inp.files];
      inp.remove();
      if (files.length) run(() => linkWithFiles(files, onProgress));
    });
    window.addEventListener('focus', () => setTimeout(() => inp.remove(), 800), { once: true });
    inp.click();
  }

  /* The copy's progress, live, without re-rendering the whole dialog. */
  const copyLine = h('.caption.muted');
  const paintCopy = () => {
    const c = copyStatus();
    copyLine.hidden = !(c.state === 'copying' || c.kept);
    copyLine.textContent = c.state === 'copying'
      ? `Copying… ${c.done.toLocaleString()} of ${c.total.toLocaleString()} files`
      : c.kept ? `${c.kept.count.toLocaleString()} files kept in this browser · ${formatBytes(c.kept.bytes)}${c.kept.complete ? '' : ' · some are missing'}` : '';
  };
  bindLive(copyLine, 'game:copy', paintCopy);

  function render() {
    clear(body);
    const d = gameLink.data;
    body.appendChild(h('p.body', {
      text: 'This app ships none of Mojang’s audio. Point it at the Minecraft folder you already have and it plays each original from your own disk, reads the exact sound list for your version, and takes the pack format straight from the game.',
    }));

    if (d) {
      body.appendChild(h('.engine-row',
        h('span.engine-dot', { dataset: { on: 'true' } }),
        h('.col.grow',
          h('.strong', { text: d.version }),
          h('.caption', {
            text: [
              d.folder,
              `asset index ${d.indexId}`,
              `${d.files.toLocaleString()} files`,
              `${eventCount(d).toLocaleString()} events`,
              d.packVersion ? `resource format ${formatLabel(d.packVersion.resource)}` : null,
            ].filter(Boolean).join(' · '),
          }),
        ),
      ));
      if ((d.installs || []).length > 1) {
        body.appendChild(field('Version to read', selectInput({
          options: d.installs.map(v => ({ value: v, label: v })),
          value: d.versionId,
          onChange: v => run(() => switchVersion(v, onProgress)),
        }), 'Every version installed in that folder. The list, the subtitles and the pack format follow whichever you pick.'));
      }
      const st = originalsState();
      if (st === 'reconnect') body.appendChild(note('The browser asks for read access again on each visit. Press Reconnect in the sidebar, or just play an original — it asks then.', 'info'));
      if (st === 'relink') body.appendChild(note('Pick the folder again to hear the originals this visit. The list and the pack format are already remembered.', 'info'));
    }

    if (canKeepCopy()) {
      const size = d?.soundBytes ? formatBytes(d.soundBytes) : 'About 375 MB';
      body.appendChild(h('.col.g-1',
        switchRow({
          title: 'Keep the originals in this browser',
          desc: `So they play on every visit without picking the folder again. ${size} of your game’s sound files, stored on this computer where only this page can read them. Unlinking deletes them.`,
          checked: keeping(),
          onChange: async v => {
            setPref('keepOriginals', v);
            if (!v) { await dropCopy(); toast({ title: 'Copy removed', message: 'The originals now play only while the folder is linked.', kind: 'ok' }); return; }
            if (!gameLink.data) return;
            if (originalsState() === 'ready' && !copyStatus().kept?.complete) afterLink();
            else if (!copyStatus().kept?.complete) toast({ title: 'It copies next time', message: 'Pick the folder once more and the originals are kept from then on.', kind: 'info' });
          },
        }),
        copyLine,
      ));
      paintCopy();
    }

    const p = platform();
    body.append(
      h('.col.g-2',
        h('.eyebrow', { text: 'Where it is' }),
        h('.copy-row',
          h('pre.code', { text: FOLDER_PATHS[p] }),
          h('button.btn.btn-sm', {
            'data-tip': 'Copy', 'data-tip-pos': 'left',
            onclick: async () => { const ok = await copyText(FOLDER_PATHS[p]); toast({ title: ok ? 'Copied' : 'Could not copy', kind: ok ? 'ok' : 'error', duration: 1400 }); },
          }, raw(icon('copy', 13))),
        ),
        h('.caption.muted', {
          text: p === 'mac' ? 'Library is hidden in the folder picker. Press ⌘⇧G inside it and paste the path above.'
            : p === 'win' ? 'Paste the path above into the picker’s address bar.'
            : 'Press Ctrl+H in the picker to show hidden folders.',
        }),
      ),
      note(canRememberFolder()
        ? 'Pick the folder called minecraft itself — the one holding assets and versions. Launch the game once first, so it has downloaded its sounds.'
        : 'Pick the folder called minecraft itself — the one holding assets and versions. Your browser will then ask to “upload” its files: that is only its word for letting this page read them. Nothing leaves your computer.', 'info'),
      prog,
    );
  }

  const m = modal({
    title: 'Link your Minecraft',
    subtitle: 'Optional. Hear the originals, and keep the list and pack format exact for your version.',
    icon: 'cube',
    body,
    actions: [
      gameLink.data ? {
        label: 'Unlink',
        run: async () => { await unlinkGame(); toast({ title: 'Unlinked', message: 'Back to the bundled 26.2 list, and the kept originals are deleted.', kind: 'ok' }); },
      } : null,
      { label: gameLink.data ? 'Choose another folder…' : 'Choose folder…', primary: true, closeAfter: false, run: () => { choose(); return false; } },
    ].filter(Boolean),
  });
  render();
  return m;
}
