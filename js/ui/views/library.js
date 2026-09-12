/* ============================================================================
   Library — every sound pack you have made, and the front door for new ones.
   ========================================================================= */

import { h, raw, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { relTime, plural, slugifyNamespace, fuzzyScore } from '../../core/util.js';
import {
  state, bus, refreshLibrary, openProject, newProject, deleteProject,
  duplicateProject, setRoute, adoptProject,
} from '../../core/store.js';
import { availableVersions, DEFAULT_VERSION, getVersion, getLinkedVersion } from '../../core/versions.js';
import { NAMESPACE_RE } from '../../core/project.js';
import { soundList } from '../../core/soundlist.js';
import { packArt, categoryProgress, progressTip } from '../packart.js';
import {
  modal, toast, confirmDialog, contextMenu, field, textInput, selectInput,
  emptyState, note, dropzone, progressBar,
} from '../kit.js';
import { importPack } from '../../export/importer.js';
import { openGameLinkDialog } from '../gamelinkui.js';

export function buildLibraryView() {
  const grid = h('.lib-grid.stagger');
  const search = h('input.input.lib-search', { type: 'search', placeholder: 'Search packs…', oninput: () => render() });
  const searchWrap = h('.input-group', h('span.input-icon', raw(icon('search', 14))), search);
  const sortSel = h('select.select', { style: 'width:150px', onchange: () => render() },
    h('option', { value: 'updated' }, 'Last edited'),
    h('option', { value: 'created' }, 'Date created'),
    h('option', { value: 'name' }, 'Name'),
    h('option', { value: 'size' }, 'Most recorded'),
  );
  const count = h('.caption.muted');

  const view = h('.view', { dataset: { view: 'library' } },
    h('.view-header',
      h('.vh-text',
        h('h1', { text: 'Your sound packs' }),
        h('p', { text: 'Every pack exports as one resource pack that replaces the sounds you recorded and leaves the rest alone. Drop an exported zip back in to keep working on it.' }),
      ),
      h('.row.g-2',
        h('button.btn.btn-lg', { onclick: () => openImportFlow() }, raw(icon('upload', 15)), h('span', { text: 'Import pack' })),
        h('button.btn.btn-lg.btn-primary', { onclick: () => openNewProjectDialog() }, raw(icon('plus', 15)), h('span', { text: 'New pack' })),
      ),
    ),
    h('.lib-toolbar', searchWrap, sortSel, h('.spacer'), count),
    h('.view-body', grid),
    h('.lib-footer',
      h('span.caption.muted', { text: 'Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.' }),
    ),
  );

  function render() {
    const q = search.value.trim();
    const sort = sortSel.value;
    let rows = [...state.library];
    if (q) {
      rows = rows.map(r => ({ r, s: Math.max(fuzzyScore(q, r.name), fuzzyScore(q, r.namespace)) }))
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.r);
    } else {
      rows.sort((a, b) =>
        sort === 'name' ? a.name.localeCompare(b.name)
        : sort === 'created' ? (b.createdAt || 0) - (a.createdAt || 0)
        : sort === 'size' ? (b.events || 0) - (a.events || 0)
        : (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    clear(grid);
    count.textContent = rows.length ? plural(rows.length, 'pack') : '';

    if (!state.library.length) {
      grid.style.display = 'block';
      grid.appendChild(firstRunPanel());
      return;
    }
    grid.style.display = '';
    if (!rows.length) {
      grid.style.display = 'block';
      grid.appendChild(emptyState({
        iconName: 'search', title: 'Nothing matches',
        message: `No pack is called “${q}”.`,
        action: h('button.btn', { text: 'Clear search', onclick: () => { search.value = ''; render(); } }),
      }));
      return;
    }

    grid.appendChild(h('button.proj-card.proj-card-new', { onclick: () => openNewProjectDialog() },
      raw(icon('plus', 24)),
      h('.strong', { text: 'New pack' }),
      h('.caption', { text: `${soundList().length.toLocaleString()} sounds to choose from` }),
    ));
    for (const rec of rows) grid.appendChild(projectCard(rec));
  }

  bus.on('library', render);
  bus.on('sounds:list', render);
  // The card art is drawn in the theme's own colours, so it redraws with it.
  bus.on('prefs', key => { if (key === 'theme') render(); });
  render();
  view.refresh = render;
  return view;
}

/* ---- Card --------------------------------------------------------------- */

function projectCard(rec) {
  const v = getVersion(rec.mcVersion);
  const total = soundList().length || 1;
  const pct = ((rec.events || 0) / total) * 100;
  const pctLabel = !rec.events ? 'Nothing yet' : pct < 1 ? '<1% done' : `${Math.floor(pct)}% done`;
  const rows = categoryProgress(rec.byCat);
  const art = packArt(rows);
  art.classList.add('pc-eq');
  const card = h('button.proj-card', {
    onclick: () => open(rec.id),
    oncontextmenu: e => { e.preventDefault(); cardMenu(rec, { x: e.clientX, y: e.clientY }); },
  },
    h('.pc-art', { 'data-tip': `${rec.name} · Minecraft ${v.label}\n\n${progressTip(rows)}`, 'data-tip-pos': 'bottom' }, art),
    h('.pc-body',
      h('.pc-name.truncate', { text: rec.name }),
      h('.pc-ns.truncate', { text: rec.namespace }),
      h('.pc-stats',
        h('span.stat-mini', { 'data-tip': 'Sounds recorded' }, raw(icon('volume', 12)), h('span', { text: (rec.events || 0).toLocaleString() })),
        h('span.stat-mini', { 'data-tip': 'Takes' }, raw(icon('mic', 12)), h('span', { text: (rec.takes || 0).toLocaleString() })),
        h('span.stat-mini', { text: pctLabel }),
        h('.spacer'),
        h('span.caption', { text: relTime(rec.updatedAt) }),
      ),
    ),
    h('span.btn.btn-sm.btn-icon.pc-menu', {
      'aria-label': 'More',
      onclick: e => { e.stopPropagation(); cardMenu(rec, e.currentTarget); },
    }, raw(icon('more', 14))),
  );
  return card;
}

function cardMenu(rec, at) {
  contextMenu([
    { label: 'Open', icon: 'chevRight', run: () => open(rec.id) },
    { label: 'Duplicate', icon: 'duplicate', run: async () => {
        await duplicateProject(rec.id);
        toast({ title: 'Duplicated', message: `“${rec.name} copy” is in your library.`, kind: 'ok' });
      } },
    '-',
    { label: 'Delete…', icon: 'trash', destructive: true, run: async () => {
        const ok = await confirmDialog({
          title: `Delete “${rec.name}”?`,
          message: 'The pack and every take in it are removed from this browser. Any zip you already exported is untouched.',
          confirmLabel: 'Delete pack', danger: true,
        });
        if (!ok) return;
        await deleteProject(rec.id);
        toast({ title: 'Pack deleted', kind: 'ok' });
      } },
  ], at);
}

async function open(id) {
  try {
    await openProject(id);
    setRoute('sounds', { force: true });
  } catch (e) {
    toast({ title: 'Could not open that pack', message: e.message, kind: 'error' });
    await refreshLibrary();
  }
}

/* ---- First run ---------------------------------------------------------- */
function firstRunPanel() {
  const step = (n, title, body) => h('.install-step',
    h('.is-num', { text: String(n) }),
    h('.is-body', h('strong', { text: title }), h('div', { style: 'margin-top:2px' }, body)),
  );
  return h('.col.g-6', { style: 'max-width:760px;margin:24px auto 0' },
    h('.card.card-pad.col.g-4',
      h('.col.g-1',
        h('h2.title', { text: 'Make every sound yours' }),
        h('p.body', { text: `All ${soundList().length.toLocaleString()} sounds in the game are listed here, from a cow’s moo to the click of a button. Record your own for as many as you like, and export them as a resource pack that swaps yours in for the game’s.` }),
      ),
      h('.divider'),
      h('div',
        step(1, 'Make a pack', 'A name, and the version you play. That is all it needs.'),
        step(2, 'Record', 'Pick a sound, press R, make the noise, press R again. The silence either side is trimmed for you; N jumps to the next one you have not done.'),
        step(3, 'Export', 'One zip. Put it in your resourcepacks folder and turn it on.'),
      ),
      h('.row.g-2.wrap',
        h('button.btn.btn-xl.btn-primary', { onclick: () => openNewProjectDialog() }, raw(icon('plus', 16)), h('span', { text: 'New pack' })),
        h('button.btn.btn-xl', { onclick: () => openImportFlow() }, raw(icon('upload', 16)), h('span', { text: 'Import a pack' })),
        h('button.btn.btn-xl', { onclick: () => openGameLinkDialog() }, raw(icon('cube', 16)), h('span', { text: 'Link your game' })),
      ),
    ),
    note('Linking your game is optional. It lets you hear each original before you record over it — this app ships none of Mojang’s audio, so they play from your own install.', 'info'),
  );
}

/* ---- New pack ----------------------------------------------------------- */
export function openNewProjectDialog() {
  let name = 'My sounds';
  let ns = slugifyNamespace(name, 'sounds');
  let nsTouched = false;
  let ver = getLinkedVersion() ? 'linked' : DEFAULT_VERSION;

  const nsInput = textInput({
    value: ns, mono: true,
    onInput: v => { nsTouched = true; ns = v.toLowerCase().replace(/[^a-z0-9_.-]/g, '_'); },
  });
  const nameInput = textInput({
    value: name, 'data-autofocus': '',
    onInput: v => { name = v; if (!nsTouched) { ns = slugifyNamespace(v, 'sounds'); nsInput.value = ns; } },
  });
  const verSel = selectInput({
    options: availableVersions().map(v => ({ value: v.id, label: v.label + (v.recommended ? ' — recommended' : '') })),
    value: ver, onChange: v => { ver = v; },
  });

  modal({
    title: 'New sound pack',
    subtitle: 'One pack holds any number of replaced sounds. All of this can change later.',
    icon: 'package',
    body: h('.col.g-4',
      field('Name', nameInput),
      field('Namespace', nsInput, 'The folder your recordings live in inside the pack: assets/<namespace>/sounds.'),
      field('Minecraft version', verSel, 'Decides the pack format number. Every version from 1.21 on reads the same sounds.json.'),
    ),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Create pack', primary: true,
        run: async () => {
          if (!name.trim()) { toast({ title: 'Give it a name', kind: 'warn' }); return false; }
          if (!NAMESPACE_RE.test(ns) || ns === 'minecraft') {
            toast({ title: 'Pick another namespace', message: 'a–z, 0–9, _ . and - only, and not “minecraft”.', kind: 'warn' });
            return false;
          }
          await newProject({ name: name.trim(), namespace: ns, mcVersion: ver });
          setRoute('sounds', { force: true });
        },
      },
    ],
  });
  queueMicrotask(() => nameInput.select());
}

/* ---- Import ------------------------------------------------------------- */
export function openImportFlow(file) {
  if (file) { doImport(file); return; }
  modal({
    title: 'Import a pack',
    subtitle: 'A zip exported from here reopens exactly. A sound pack made anywhere else is read from its sounds.json and its .ogg files.',
    icon: 'upload',
    body: ({ close }) => h('.col.g-3',
      dropzone({
        label: 'Drop a resource pack zip', hint: 'or click to choose one',
        accept: '.zip,application/zip',
        onFiles: fs => { close(); doImport(fs[0]); },
      }),
    ),
    actions: [{ label: 'Cancel' }],
  });
}

async function doImport(file) {
  const prog = progressBar({ label: 'Opening…' });
  const m = modal({ title: 'Importing', subtitle: file.name, icon: 'upload', body: prog, dismissable: false });
  try {
    const { project, stats } = await importPack(file, (msg, pct) => prog.set(pct, msg));
    await adoptProject(project);
    m.close();
    toast({
      title: 'Pack imported',
      message: `${plural(stats.takes, 'take')} across ${plural(stats.events, 'sound')}${stats.missing ? ` · ${stats.missing} unreadable` : ''}.`,
      kind: 'ok',
    });
    setRoute('sounds', { force: true });
  } catch (e) {
    m.close();
    toast({ title: 'Could not import that', message: e.message, kind: 'error' });
  }
}
