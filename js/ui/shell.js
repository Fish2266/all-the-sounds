/* ============================================================================
   Shell — chrome, routing, global shortcuts, and the app-wide drop target.
   Frame & Groove's shell with three places instead of seven.
   ========================================================================= */

import { h, raw, clear, on } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { hasMod, keyLabel, plural, debounce } from '../core/util.js';
import { state, bus, setRoute, saveProject, closeProject, setPref, selectEvent } from '../core/store.js';
import { getVersion } from '../core/versions.js';
import { validateProject, projectStats } from '../core/project.js';
import { soundList } from '../core/soundlist.js';
import { openPalette, paletteOpen } from './cmdk.js';
import { modal, toast, switchRow, badge, iconButton, field, segmented, slider } from './kit.js';
import { sfxPreview } from './sfx.js';
import { markCanvas } from './brandmark.js';
import { pixIcon } from './pixicons.js';
import { linkCard, openGameLinkDialog } from './gamelinkui.js';
import { QUALITY_STEPS } from '../audio/engine.js';

/* The rail wears Frame & Groove's own icons — ui/pixicons.js and the
   hand-drawn ui/pixelart-overrides.js are straight copies — with the same
   accents that app gives them. Sounds borrows its Music record. */
const ROUTES = [
  { id: 'library', label: 'Packs',  pix: 'packs',  accent: '#B99A62', needsProject: false },
  { id: 'sounds',  label: 'Sounds', pix: 'music',  accent: '#B084F5', needsProject: true },
  { id: 'export',  label: 'Export', pix: 'export', accent: '#3FD98B', needsProject: true },
];

/* The way back to the landing page. The same link, in the same place, in all
   three tools. */
export const homeLink = () => h('a.home-link.no-drag', {
  href: 'https://fish2266.github.io/mctools/',
  'data-tip': 'All three tools', 'data-tip-pos': 'bottom', 'aria-label': 'Fish’s MC Tools',
}, raw(icon('chevLeft', 14)), h('span', { text: 'MC Tools' }));

export function buildShell(views) {
  /* ---- Top bar ---- */
  const crumbs = h('.crumbs');
  const saveChip = h('.save-chip', { dataset: { state: 'idle' } }, h('.dot'), h('span', { text: '' }));
  const micChip = h('button.mic-chip.no-drag', {
    hidden: true,
    'data-tip': 'The microphone is on — click to turn it off', 'data-tip-pos': 'bottom',
    onclick: () => bus.emit('mic:off'),
  }, h('span.dot'), h('span', { text: 'Mic live' }));

  const topbar = h('.topbar',
    homeLink(),
    h('.divider-v', { style: 'height:20px;margin:0 2px 0 4px' }),
    h('.logo.no-drag',
      h('.logo-mark', markCanvas(28)),
      h('.col', h('.logo-word', 'All ', h('em', 'The'), ' Sounds')),
    ),
    h('.divider-v', { style: 'height:20px;margin:0 4px' }),
    crumbs,
    h('.spacer'),
    micChip,
    saveChip,
    h('button.btn.btn-sm.btn-ghost.no-drag', {
      'data-tip': `Command palette  ${keyLabel('mod+K')}`, 'data-tip-pos': 'bottom',
      onclick: () => palette(),
    }, raw(icon('search', 14)), h('span.caption', { text: keyLabel('mod+K') })),
    iconButton('keyboard', { tip: 'Keyboard shortcuts  ?', pos: 'bottom', cls: 'btn-ghost btn-sm no-drag', onClick: () => showShortcuts() }),
    iconButton('sliders', { tip: 'Preferences', pos: 'left', cls: 'btn-ghost btn-sm no-drag', onClick: () => showPreferences() }),
  );
  bus.on('mic', live => { micChip.hidden = !live; });

  /* ---- Rail ---- */
  const rail = h('.rail');
  const railBtns = new Map();
  for (const r of ROUTES) {
    if (r.id === 'sounds') rail.appendChild(h('.rail-sep'));
    const b = h('button.rail-btn', {
      'aria-current': 'false',
      dataset: { route: r.id },
      'data-tip': r.label, 'data-tip-pos': 'right',
      onclick: () => setRoute(r.id),
    }, h('span.rb-icon', pixIcon(r.pix, 2, { accent: r.accent, accentLight: r.accent })),
       h('span.rb-label', { text: r.label }));
    railBtns.set(r.id, b);
    rail.appendChild(b);
  }
  rail.appendChild(h('.spacer'));
  const themeBtn = h('button.rail-btn', {
    'data-tip-pos': 'right',
    onclick: () => setPref('theme', state.prefs.theme === 'bone' ? 'deepslate' : 'bone'),
  });
  const syncThemeBtn = () => {
    const goingDark = state.prefs.theme === 'bone';
    themeBtn.innerHTML = icon(goingDark ? 'moon' : 'sun', 19);
    themeBtn.appendChild(h('span.rb-label', { text: goingDark ? 'Dark' : 'Light' }));
    themeBtn.dataset.tip = goingDark ? 'Switch to dark' : 'Switch to light';
  };
  syncThemeBtn();
  bus.on('prefs', key => { if (key === 'theme') syncThemeBtn(); });
  rail.appendChild(themeBtn);

  /* ---- View host ---- */
  const viewhost = h('.viewhost');
  for (const [id, el] of Object.entries(views)) { el.hidden = true; el.dataset.route = id; viewhost.appendChild(el); }

  const shell = h('.shell', rail, viewhost);
  const app = h('#app', topbar, shell);

  /* ---- Routing ---- */
  function applyRoute(route) {
    const hasProject = !!state.project;
    if (ROUTES.find(r => r.id === route)?.needsProject && !hasProject) route = state.route = 'library';
    for (const r of ROUTES) {
      const b = railBtns.get(r.id);
      b.setAttribute('aria-current', String(r.id === route));
      b.disabled = r.needsProject && !hasProject;
    }
    for (const [id, el] of Object.entries(views)) el.hidden = id !== route;
    views[route]?.refresh?.();
    renderCrumbs(route);
    document.documentElement.dataset.route = route;
  }

  function renderCrumbs(route) {
    clear(crumbs);
    const p = state.project;
    if (!p) { crumbs.appendChild(h('span.crumb.current', { text: 'Library' })); return; }
    crumbs.append(
      h('button.crumb', { text: 'Library', onclick: () => setRoute('library') }),
      h('span.sep', raw(icon('chevRight', 12))),
      h('button.crumb', { text: p.name || 'Untitled', onclick: () => setRoute('sounds') }),
    );
    const cur = ROUTES.find(r => r.id === route);
    if (route !== 'library') {
      crumbs.append(h('span.sep', raw(icon('chevRight', 12))), h('span.crumb.current', { text: cur.label }));
    }
    const s = projectStats(p);
    crumbs.append(
      h('span', { style: 'margin-left:8px' }, badge(getVersion(p.mcVersion).label)),
      h('span', { style: 'margin-left:4px' }, badge(`${s.events.toLocaleString()} / ${soundList().length.toLocaleString()}`, s.events ? 'accent' : '')),
    );
  }

  /* A quiet dot on Export when the pack will not build. */
  const syncFlags = debounce(() => {
    const btn = railBtns.get('export');
    btn.querySelector('.rb-flag')?.remove();
    btn.dataset.tip = 'Export';
    if (!state.project) return;
    const { errors } = validateProject(state.project);
    if (!errors.length) return;
    btn.appendChild(h('span.rb-flag', { dataset: { kind: 'error' } }));
    btn.dataset.tip = `Export — ${plural(errors.length, 'problem')}`;
  }, 400);
  const syncCrumbs = debounce(() => renderCrumbs(state.route), 250);

  bus.on('route', applyRoute);
  bus.on('project:open', () => { applyRoute(state.route); syncFlags(); });
  bus.on('project:close', () => { applyRoute('library'); });
  bus.on('project:dirty', () => { syncFlags(); syncCrumbs(); });
  bus.on('project:saved', syncFlags);
  bus.on('sounds:list', syncCrumbs);

  /* ---- Save indicator ---- */
  let saveTimer;
  const setSave = (mode, text) => {
    saveChip.dataset.state = mode;
    saveChip.querySelector('span').textContent = text;
  };
  bus.on('project:dirty', () => setSave('dirty', 'Unsaved'));
  bus.on('save:state', (s, err) => {
    clearTimeout(saveTimer);
    if (s === 'saving') setSave('saving', 'Saving…');
    else if (s === 'saved') { setSave('saved', 'Saved'); saveTimer = setTimeout(() => setSave('idle', ''), 2600); }
    else setSave('error', 'Save failed');
    if (s === 'error') toast({ title: 'Could not save', message: err?.message, kind: 'error' });
  });

  /* ---- Global keys ---- */
  on(window, 'keydown', e => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (hasMod(e) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); return; }
    if (hasMod(e) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveProject().then(() => toast({ title: 'Saved', kind: 'ok', duration: 1400 }));
      return;
    }
    if (typing || paletteOpen() || document.querySelector('.overlay')) return;
    if (e.key === '?') { e.preventDefault(); showShortcuts(); return; }
    if (hasMod(e) && e.key >= '1' && e.key <= String(ROUTES.length)) {
      e.preventDefault();
      const r = ROUTES[+e.key - 1];
      if (r && !(r.needsProject && !state.project)) setRoute(r.id);
    }
  });

  /* ---- Global drop ---- */
  let dropOverlay = null;
  let dragDepth = 0;
  const showDrop = () => {
    if (dropOverlay) return;
    dropOverlay = h('.global-drop',
      h('.gd-card',
        h('span', { style: 'color:var(--accent)' }, raw(icon('volume', 34))),
        h('.title-sm', { text: 'Drop to add' }),
        h('.caption', { text: 'Audio files become takes for the sound you have open · a pack zip opens as a pack' }),
      ));
    document.body.appendChild(dropOverlay);
  };
  const hideDrop = () => { dropOverlay?.remove(); dropOverlay = null; dragDepth = 0; };

  on(window, 'dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; showDrop(); } });
  on(window, 'dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  on(window, 'dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) hideDrop(); });
  on(window, 'drop', async e => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    hideDrop();
    const files = [...e.dataTransfer.files];
    const zip = files.find(f => f.name.toLowerCase().endsWith('.zip'));
    const audio = files.filter(f => f.type.startsWith('audio/') || /\.(ogg|wav|mp3|m4a|flac|aac|webm)$/i.test(f.name));
    if (zip) {
      const { openImportFlow } = await import('./views/library.js');
      setRoute('library');
      openImportFlow(zip);
    } else if (audio.length) {
      if (!state.project) { toast({ title: 'Open a pack first', message: 'A take needs a sound to belong to.', kind: 'warn' }); return; }
      setRoute('sounds');
      bus.emit('drop:audio', audio);
    } else {
      toast({ title: 'Not something this app reads', message: files[0].name, kind: 'warn' });
    }
  });

  on(window, 'beforeunload', e => {
    if (state.projectDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  applyRoute(state.route);
  return app;
}

/* ========================================================================= */
/* PALETTE                                                                   */
/* ========================================================================= */

function palette() {
  const cmds = [];
  const p = state.project;
  cmds.push({ group: 'Go', label: 'Library', icon: 'library', key: 'mod+1', weight: 10, run: () => setRoute('library') });
  if (p) {
    cmds.push(
      { group: 'Go', label: 'Sounds', icon: 'volume', key: 'mod+2', weight: 10, run: () => setRoute('sounds') },
      { group: 'Go', label: 'Export', icon: 'download', key: 'mod+3', weight: 9, run: () => setRoute('export') },
      { group: 'Record', label: 'Next sound to do', icon: 'skipFwd', key: 'N', weight: 9, keywords: 'todo next unrecorded', run: () => { setRoute('sounds'); setTimeout(() => bus.emit('cmd:next-todo'), 40); } },
      { group: 'Pack', label: 'Save now', icon: 'save', key: 'mod+S', weight: 6, run: () => saveProject().then(() => toast({ title: 'Saved', kind: 'ok', duration: 1400 })) },
      { group: 'Pack', label: 'Close pack', icon: 'x', weight: 5, run: async () => { await closeProject(); setRoute('library'); } },
    );
    for (const ev of soundList()) {
      const n = p.sounds[ev.id]?.takes?.length || 0;
      cmds.push({
        group: 'Sounds', label: ev.label, icon: n ? 'checkCirc' : 'volume', hint: ev.id,
        keywords: `${ev.id} ${ev.groupLabel}`, weight: 0,
        run: () => { setRoute('sounds'); selectEvent(ev.id); },
      });
    }
  }
  cmds.push(
    { group: 'Create', label: 'New pack', icon: 'package', weight: 7, run: async () => { const m = await import('./views/library.js'); m.openNewProjectDialog(); } },
    { group: 'Create', label: 'Import a pack', icon: 'upload', weight: 6, run: async () => { const m = await import('./views/library.js'); setRoute('library'); m.openImportFlow(); } },
    { group: 'App', label: state.prefs.theme === 'bone' ? 'Switch to dark' : 'Switch to light', icon: state.prefs.theme === 'bone' ? 'moon' : 'sun', weight: 3, run: () => setPref('theme', state.prefs.theme === 'bone' ? 'deepslate' : 'bone') },
    { group: 'App', label: 'Preferences', icon: 'sliders', weight: 3, run: () => showPreferences() },
    { group: 'App', label: 'Link your Minecraft', icon: 'cube', weight: 3, keywords: 'game folder originals jar assets', run: () => openGameLinkDialog() },
    { group: 'App', label: 'Keyboard shortcuts', icon: 'keyboard', key: '?', weight: 2, run: () => showShortcuts() },
  );
  openPalette(cmds);
}

/* ========================================================================= */
/* PREFERENCES                                                               */
/* ========================================================================= */

export function showPreferences() {
  const devSel = h('select.select', {
    onchange: e => { setPref('inputDevice', e.target.value || null); bus.emit('mic:off'); },
  }, h('option', { value: '' }, 'System default'));
  navigator.mediaDevices?.enumerateDevices?.().then(list => {
    list.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default').forEach((d, i) => {
      devSel.appendChild(h('option', { value: d.deviceId, selected: d.deviceId === state.prefs.inputDevice }, d.label || `Microphone ${i + 1}`));
    });
  }).catch(() => {});

  // Browser voice processing is tuned for calls; on a sound effect it pumps
  // and smears. Changing any of it re-opens the microphone next time.
  const micSwitch = (key, title, desc) => switchRow({
    title, desc, checked: !!state.prefs[key],
    onChange: v => { setPref(key, v); bus.emit('mic:off'); },
  });

  modal({
    title: 'Preferences',
    icon: 'sliders',
    body: h('.col.g-2',
      field('Game', linkCard(), 'Optional. Plays the originals from your own install, and keeps the sound list and the pack format exact for your version.'),
      h('.divider'),
      h('.eyebrow', { text: 'Recording', style: 'margin-top:6px' }),
      field('Microphone', devSel, 'Device names show once the browser has been allowed to use the microphone.'),
      switchRow({
        title: 'Trim the silence',
        desc: 'Cut the quiet either side of every new take. The trim stays editable.',
        checked: state.prefs.autoTrim !== false, onChange: v => setPref('autoTrim', v),
      }),
      switchRow({
        title: 'Play each take back',
        desc: 'Hear it the moment you stop recording.',
        checked: state.prefs.autoPlay !== false, onChange: v => setPref('autoPlay', v),
      }),
      switchRow({
        title: 'Move on after each take',
        desc: 'Jump to the next sound you have not done, so R, R, R works through a whole category.',
        checked: !!state.prefs.advanceAfterTake, onChange: v => setPref('advanceAfterTake', v),
      }),
      micSwitch('noiseSuppression', 'Noise suppression', 'Off by default. It is built for calls and eats the tails of sound effects.'),
      micSwitch('echoCancellation', 'Echo cancellation', 'Off by default, for the same reason.'),
      micSwitch('autoGainControl', 'Automatic gain', 'Off by default. Normalising each take does the job without pumping.'),
      field('Ogg quality', segmented({
        options: QUALITY_STEPS.map(s => ({ value: s.q, label: s.label, hint: s.hint })),
        value: state.prefs.quality ?? 4, block: true,
        onChange: v => setPref('quality', v),
      }), 'Short sounds barely differ in size between the steps. Standard is what vanilla sounds like.'),
      h('.divider'),
      field('Theme', segmented({
        options: [
          { value: 'deepslate', label: 'Deepslate', icon: 'moon' },
          { value: 'bone', label: 'Bone', icon: 'sun' },
        ],
        value: state.prefs.theme, block: true, large: true,
        onChange: v => setPref('theme', v),
      })),
      switchRow({
        title: 'Block textures',
        desc: 'Generated stone and deepslate under the chrome. Off gives a flat, plain surface.',
        checked: state.prefs.textures !== false,
        onChange: v => setPref('textures', v),
      }),
      switchRow({
        title: 'Stone grain',
        desc: 'A very fine noise over the whole app.',
        checked: state.prefs.grain, onChange: v => setPref('grain', v),
      }),
      h('.divider'),
      switchRow({
        title: 'Interface sounds',
        desc: 'Frame & Groove’s synthesised clicks. They stay quiet on the record panel, so they never end up in a take.',
        checked: state.prefs.sound !== false,
        onChange: v => { setPref('sound', v); if (v) sfxPreview('ok'); },
      }),
      field('Volume', h('.row.g-2',
        h('.grow', slider({
          min: 0, max: 100, value: state.prefs.soundVolume ?? 55,
          onInput: v => { state.prefs.soundVolume = v; },
          onChange: v => { setPref('soundVolume', v); sfxPreview('click'); },
          format: v => `${v}%`,
        })),
        h('button.btn.btn-sm', { dataset: { quiet: '' }, onclick: () => sfxPreview('place') },
          raw(icon('volume', 13)), h('span', { text: 'Test' })),
      )),
      switchRow({
        title: 'Reduce motion',
        desc: 'Cuts transitions and animation for a calmer interface.',
        checked: state.prefs.reduceMotion, onChange: v => setPref('reduceMotion', v),
      }),
      h('.divider'),
      h('.caption.muted', { text: 'Everything you record is stored in this browser and never leaves your machine. There are no accounts, no analytics and no servers. The microphone is only open while the red “Mic live” light in the top bar is on — click it to close it, and it closes itself after two idle minutes.' }),
      h('.divider'),
      h('.caption.muted', { text: 'All The Sounds is a free, unofficial fan tool, offered as is with no warranty. Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.' }),
    ),
    actions: [{ label: 'Done', primary: true }],
  });
}

/* ========================================================================= */
/* SHORTCUTS                                                                 */
/* ========================================================================= */

const SHORTCUTS = [
  ['Everywhere', [
    ['mod+K', 'Command palette — and every sound by name'],
    ['mod+S', 'Save now'],
    ['mod+1…3', 'Jump between sections'],
    ['?', 'This sheet'],
  ]],
  ['Recording', [
    ['R', 'Record, and again to stop'],
    ['Esc', 'Throw the take away'],
    ['Space', 'Play the take (or the original)'],
    ['O', 'Play an original'],
    ['N', 'Next sound you have not done'],
  ]],
  ['Moving around', [
    ['↓ / J', 'Next sound'],
    ['↑ / K', 'Previous sound'],
    ['1…9', 'Pick a take and play it'],
    ['Delete', 'Delete the selected take'],
    ['/', 'Search'],
  ]],
];

export function showShortcuts() {
  modal({
    title: 'Keyboard shortcuts',
    icon: 'keyboard', width: 'wide',
    body: h('.col.g-5',
      ...SHORTCUTS.map(([group, rows]) => h('.col.g-2',
        h('.eyebrow', { text: group }),
        h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 20px' },
          ...rows.map(([k, label]) => h('.row.between.g-3',
            h('span.body-sm', { text: label }),
            h('span.row.g-1', ...keyLabel(k).split(/(?<=\S)\s(?=\S)/).map(part => h('kbd', { text: part }))),
          )),
        ),
      )),
    ),
    actions: [{ label: 'Close', primary: true }],
  });
}
