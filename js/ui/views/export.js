/* ============================================================================
   Export — the pack's settings, what goes in it, and the build.
   ========================================================================= */

import { h, raw, clear } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { plural, formatBytes, downloadBlob, IS_MAC, debounce } from '../../core/util.js';
import { state, bus, markDirty, setPref, saveProject } from '../../core/store.js';
import { availableVersions, getVersion, formatLabel, parseFormat } from '../../core/versions.js';
import { validateProject, packFormats, projectStats, NAMESPACE_RE } from '../../core/project.js';
import { soundList, eventOrOrphan, CATEGORIES } from '../../core/soundlist.js';
import { QUALITY_STEPS } from '../../audio/engine.js';
import { packPlan, buildPack, packFilename } from '../../export/packbuild.js';
import { pathsToTree } from '../../export/zip.js';
import { panel, field, textInput, textArea, selectInput, segmented, note, progressBar, toast } from '../kit.js';

export function buildExportView() {
  const body = h('.view-body');
  const view = h('.view', { dataset: { view: 'export' } },
    h('.view-header',
      h('.vh-text',
        h('h1', { text: 'Export' }),
        h('p', { text: 'One resource pack: your takes as Ogg Vorbis, and the sounds.json that points the game at them. Every sound you recorded replaces the game’s own; every other sound is left alone.' }),
      ),
    ),
    body,
  );

  const live = { contents: h('div'), files: h('div'), target: h('div') };

  function render() {
    clear(body);
    const p = state.project;
    if (!p) return;
    live.contents = h('div'); live.files = h('div'); live.target = h('div');
    body.appendChild(h('.export-grid.export-wrap',
      h('.col.g-5',
        settingsPanel(p),
        panel('What goes in', [live.contents]),
        panel('Files', [live.files], { pad: false }),
      ),
      h('.col.g-5', buildPanel(p), installPanel()),
    ));
    paintDynamic();
  }

  function paintDynamic() {
    const p = state.project;
    if (!p) return;
    paintContents(p);
    paintFiles(p);
    paintTarget(p);
  }
  const later = debounce(paintDynamic, 250);

  /* ---- Settings ---- */
  function settingsPanel(p) {
    const verCard = h('div');
    const customBox = h('div');
    const paintVer = () => {
      const v = getVersion(p.mcVersion);
      const fmt = packFormats(p);
      verCard.replaceChildren(h('.version-card',
        h('.col', h('.vc-num', { text: formatLabel(fmt.resource) }), h('.vc-lbl', { text: 'resource format' })),
        h('.caption.grow', { text: v.note || (fmt.rangeShape ? 'Written as min_format / max_format.' : 'Written as pack_format.') }),
      ));
      clear(customBox);
      if (v.custom) {
        customBox.appendChild(field('Resource format', textInput({
          value: formatLabel(p.advanced?.resourceFormat ?? v.resource), mono: true,
          onChange: val => {
            const f = parseFormat(val);
            if (!f) { toast({ title: 'That is not a format number', message: 'A whole number, or major.minor such as 88.0.', kind: 'warn' }); return; }
            p.advanced = { ...p.advanced, resourceFormat: f };
            markDirty('format'); paintVer(); later();
          },
        }), 'A whole number, or major.minor from 1.21.9 on.'));
      }
    };

    const nsErr = h('.field-error', { hidden: true });
    const el = panel('Pack', [h('.form-grid',
      field('Name', textInput({ value: p.name, onInput: v => { p.name = v; markDirty('name'); later(); } })),
      h('.field',
        h('label', { text: 'Namespace' }),
        textInput({
          value: p.namespace, mono: true,
          onInput: (v, e) => {
            const clean = v.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
            if (clean !== v) e.target.value = clean;
            p.namespace = clean;
            const bad = !NAMESPACE_RE.test(clean) || clean === 'minecraft';
            nsErr.hidden = !bad;
            nsErr.textContent = clean === 'minecraft' ? '“minecraft” belongs to the game — pick your own.' : 'a–z, 0–9, _ . and - only.';
            markDirty('namespace'); later();
          },
        }),
        h('.field-hint', { text: 'Your recordings go in assets/<namespace>/sounds.' }),
        nsErr,
      ),
      h('.span-2', field('Description', textArea({
        value: p.description || '', rows: 2, placeholder: 'Shown under the name in the game’s resource pack list',
        onInput: v => { p.description = v; markDirty('description'); },
      }))),
      h('.span-2', field('Minecraft version', selectInput({
        options: availableVersions().map(v => ({ value: v.id, label: v.label + (v.recommended ? ' — recommended' : '') })),
        value: p.mcVersion,
        onChange: v => { p.mcVersion = v; markDirty('version'); paintVer(); later(); },
      }), 'Every version from 1.21 on reads the same sounds.json; only the number in pack.mcmeta changes.')),
      h('.span-2.col.g-3', verCard, customBox),
    )]);
    paintVer();
    return el;
  }

  /* ---- Contents ---- */
  const stat = (n, label) => h('.col',
    h('span', { style: 'font-size:var(--t-21);font-weight:var(--w-bold);letter-spacing:var(--tr-tighter);font-variant-numeric:tabular-nums', text: n }),
    h('span.caption', { text: label }),
  );

  function paintContents(p) {
    const s = projectStats(p);
    const list = soundList();
    const totals = {};
    for (const ev of list) totals[ev.cat] = (totals[ev.cat] || 0) + 1;
    const doneBy = {};
    for (const [id, e] of Object.entries(p.sounds)) {
      if (!e.takes?.length) continue;
      const cat = eventOrOrphan(id).cat;
      doneBy[cat] = (doneBy[cat] || 0) + 1;
    }
    const mixed = Object.values(p.sounds).filter(e => e.takes?.length && e.mode === 'mix').length;
    const { errors, warnings } = validateProject(p);
    live.contents.replaceChildren(h('.col.g-4',
      h('.row.g-6.wrap.items-start',
        stat(s.events.toLocaleString(), `of ${list.length.toLocaleString()} sounds`),
        stat(s.takes.toLocaleString(), s.takes === 1 ? 'take' : 'takes'),
        stat(`${s.seconds.toFixed(1)} s`, 'of audio'),
        mixed ? stat(String(mixed), 'mixed with vanilla') : null,
      ),
      h('.cat-table', ...CATEGORIES.filter(c => totals[c.id]).flatMap(c => [
        h('span', { text: c.label }),
        h('span.ct-n', { text: `${(doneBy[c.id] || 0).toLocaleString()} / ${totals[c.id].toLocaleString()}` }),
      ])),
      errors.length || warnings.length
        ? h('.check-list',
            ...errors.map(e => note(e.message, 'danger')),
            ...warnings.slice(0, 6).map(w => note(w.message, 'warn')),
            warnings.length > 6 ? h('.caption.muted', { text: `and ${warnings.length - 6} more like that` }) : null)
        : note('Ready to build.', 'ok'),
    ));
  }

  /* ---- Files ---- */
  function paintFiles(p) {
    const plan = packPlan(p, { quality: state.prefs.quality ?? 4 });
    const tree = pathsToTree(plan.rows);
    const out = h('.filetree');
    const LIMIT = 240;
    let shown = 0, hidden = 0;
    const walk = (node, depth) => {
      const kids = [...node.children.values()].sort((a, b) =>
        a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1);
      for (const k of kids) {
        if (shown >= LIMIT) { hidden++; if (k.dir) walk(k, depth + 1); continue; }
        shown++;
        const ext = k.name.includes('.') ? k.name.split('.').pop() : '';
        out.appendChild(h('.ft-row',
          h('span', { text: '  '.repeat(depth) }),
          h('span', { class: k.dir ? 'ft-dir' : `ft-file ft-${ext}`, text: k.dir ? `${k.name}/` : k.name }),
          h('span.ft-size', { text: formatBytes(k.size) }),
        ));
        if (k.dir) walk(k, depth + 1);
      }
    };
    walk(tree, 0);
    if (hidden) out.appendChild(h('.ft-row', h('span.ft-dir', { text: `… and ${hidden.toLocaleString()} more` })));
    live.files.replaceChildren(out);
  }

  function paintTarget(p) {
    const plan = packPlan(p, { quality: state.prefs.quality ?? 4 });
    const fmt = packFormats(p);
    live.target.replaceChildren(h('.export-target',
      h('.et-icon', raw(icon('package', 18))),
      h('.et-main',
        h('.et-name.truncate', { text: packFilename(p) }),
        h('.et-meta', { text: `resource format ${formatLabel(fmt.resource)} · ${plural(plan.takes, 'take')} · about ${formatBytes(plan.bytes)}` }),
      ),
    ));
  }

  /* ---- Build ---- */
  function buildPanel(p) {
    const prog = progressBar({ label: '' });
    prog.hidden = true;
    const btn = h('button.btn.btn-xl.btn-primary.btn-block', { onclick: () => build() },
      raw(icon('download', 16)), h('span', { text: 'Build resource pack' }));

    async function build() {
      const { errors } = validateProject(p);
      if (errors.length) { toast({ title: 'Fix this first', message: errors[0].message, kind: 'error' }); return; }
      btn.disabled = true;
      prog.hidden = false;
      prog.set(0, 'Starting…');
      try {
        const res = await buildPack(p, { quality: state.prefs.quality ?? 4, onProgress: (pct, msg) => prog.set(pct, msg) });
        markDirty('encoded');
        await saveProject({ silent: true });
        downloadBlob(res.blob, res.filename);
        prog.set(1, `${res.filename} — ${formatBytes(res.blob.size)}`);
        toast({
          title: 'Pack built',
          message: `${res.filename} · ${formatBytes(res.blob.size)} · ${res.encoded ? `${plural(res.encoded, 'take')} encoded` : 'nothing needed re-encoding'}`,
          kind: 'ok',
        });
        paintDynamic();
      } catch (e) {
        console.error(e);
        prog.hidden = true;
        toast({ title: 'The pack could not be built', message: e.message, kind: 'error' });
      } finally {
        btn.disabled = false;
      }
    }

    return panel('Build', [h('.col.g-4',
      live.target,
      field('Ogg quality', segmented({
        options: QUALITY_STEPS.map(s => ({ value: s.q, label: s.label, hint: s.hint })),
        value: state.prefs.quality ?? 4, block: true,
        onChange: v => { setPref('quality', v); later(); },
      })),
      btn,
      prog,
      h('.caption.muted', { text: 'Takes are encoded once and remembered, so building again after a small change only encodes what changed.' }),
    )]);
  }

  function installPanel() {
    const path = IS_MAC ? '~/Library/Application Support/minecraft/resourcepacks'
      : /Win/i.test(navigator.platform || '') ? '%APPDATA%\\.minecraft\\resourcepacks'
      : '~/.minecraft/resourcepacks';
    const step = (n, title, content) => h('.install-step',
      h('.is-num', { text: String(n) }),
      h('.is-body', h('strong', { text: title }), h('div', { style: 'margin-top:2px' }, content)),
    );
    return panel('Putting it in the game', [
      h('div',
        step(1, 'Drop the zip in resourcepacks', h('span', 'Leave it zipped. The folder is ', h('code', { text: path }), ' — or press Open Pack Folder on the game’s Resource Packs screen.')),
        step(2, 'Turn it on', 'Options → Resource Packs, then move it across to the right. Keep it above any other pack that changes sounds.'),
        step(3, 'Listen', h('span', 'Every sound you recorded now plays yours. After rebuilding, swap the zip and press ', h('kbd', { text: 'F3' }), ' + ', h('kbd', { text: 'T' }), ' to reload without restarting.')),
      ),
      note('Only what you recorded changes. Turning the pack off puts every sound back exactly as the game ships it.', 'info'),
    ]);
  }

  bus.on('project:open', () => { if (state.route === 'export') render(); });
  bus.on('sounds:list', () => { if (state.route === 'export') render(); });
  view.refresh = render;
  return view;
}
