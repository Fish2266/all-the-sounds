/* ============================================================================
   Minecraft target versions.

   A sound pack is only a resource pack, so the one thing that varies by
   version is pack.mcmeta: the resource format number, and how it is written.
   sounds.json itself has kept the same shape through every release listed.

   Two format eras:
     • Up to 1.21.8  — a single `pack_format` integer, optionally with
       `supported_formats: {min_inclusive, max_inclusive}`.
     • From 1.21.9   — `min_format` / `max_format`, each either an integer or
       a [major, minor] pair.

   The numbers are the same ones Frame & Groove ships. Linking your game folder
   reads the exact pair out of the jar instead, which cannot go stale.
   ========================================================================= */

/** Ordered oldest → newest. `resource` is a [major, minor] pair. */
export const MC_VERSIONS = [
  { id: '1.21',    label: '1.21 – 1.21.1',    resource: [34, 0], verified: true },
  { id: '1.21.2',  label: '1.21.2 – 1.21.3',  resource: [42, 0], verified: true },
  { id: '1.21.4',  label: '1.21.4',           resource: [46, 0], verified: true },
  { id: '1.21.5',  label: '1.21.5',           resource: [55, 0], verified: true },
  { id: '1.21.6',  label: '1.21.6',           resource: [63, 0], verified: true },
  { id: '1.21.7',  label: '1.21.7 – 1.21.8',  resource: [64, 0], verified: true },
  {
    id: '1.21.9', label: '1.21.9 – 1.21.10', resource: [69, 0], verified: true, range: true,
    note: 'pack.mcmeta changes shape here: min_format and max_format replace pack_format.',
  },
  { id: '1.21.11', label: '1.21.11',          resource: [75, 0], verified: true, range: true },
  {
    id: '26.1', label: '26.1 – 26.1.2', resource: [84, 0], verified: true, range: true,
    note: 'Version names go year-based from here: 26.1 is the release after 1.21.11.',
  },
  {
    id: '26.2', label: '26.2', resource: [88, 0], verified: true, range: true, recommended: true,
    note: 'The current release, and the version the bundled sound list was read from.',
  },
  {
    id: '26.3', label: '26.3 (snapshot)', resource: [96, 0], verified: false, range: true, snapshot: true,
    note: 'Numbers taken from 26.3-snapshot-8. Link your game folder to pin them to the build you actually play.',
  },
  {
    id: 'custom', label: 'Custom — set the number yourself', resource: [88, 0], verified: false, range: true, custom: true,
    note: 'For a release newer than this list, or a snapshot. Set the format number in Pack settings.',
  },
];

export const DEFAULT_VERSION = '26.2';

/* ---- The linked game -----------------------------------------------------
   A client jar states its own pack formats in version.json. That beats any
   table here: it is what the game will actually accept, snapshots included.
   core/gamelink.js installs it when a game folder is linked. */
let linkedVersion = null;

export function setLinkedVersion(meta) {
  if (!meta?.packVersion) { linkedVersion = null; return null; }
  const resource = meta.packVersion.resource;
  linkedVersion = {
    id: 'linked',
    label: `${meta.version} — from your game`,
    resource,
    verified: true,
    linked: true,
    // 69 is 1.21.9's resource format, the first to read min_format / max_format.
    range: resource[0] >= 69,
    note: `Read straight out of ${meta.version}.jar. These are the exact numbers this copy of the game accepts.`,
  };
  return linkedVersion;
}
export const getLinkedVersion = () => linkedVersion;

/** The selector's list: the linked game first, then the shipped table. */
export function availableVersions() {
  return linkedVersion ? [linkedVersion, ...MC_VERSIONS] : [...MC_VERSIONS];
}

export function getVersion(id) {
  if (id === 'linked' && linkedVersion) return linkedVersion;
  return MC_VERSIONS.find(v => v.id === id) || MC_VERSIONS.find(v => v.id === DEFAULT_VERSION);
}

/** Whether a target is at least as new as a release named in the table.
 *  Anything the table does not know is treated as new enough. */
export function versionAtLeast(versionId, otherId) {
  if (versionId === 'custom' || versionId === 'linked') return true;
  const ids = MC_VERSIONS.filter(v => !v.custom).map(v => v.id);
  const a = ids.indexOf(versionId), b = ids.indexOf(otherId);
  if (a < 0 || b < 0) return true;
  return a >= b;
}

/* ---- Format helpers ----------------------------------------------------- */
/** [94, 1] -> "94.1" for display. */
export const formatLabel = f => (Array.isArray(f) ? (f[1] ? `${f[0]}.${f[1]}` : `${f[0]}`) : String(f));

/** Parse "94.1" or "94" back into [major, minor]. Returns null if unusable. */
export function parseFormat(text) {
  const m = String(text ?? '').trim().match(/^(\d+)(?:[.,](\d+))?$/);
  if (!m) return null;
  return [parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0];
}

/**
 * The JSON value for a min_format / max_format field. For a max bound a bare
 * integer means "any minor of that major", which keeps the pack loading on
 * later patch releases.
 */
export function formatValue(f, { bound = 'min' } = {}) {
  const [maj, min] = Array.isArray(f) ? f : [f, 0];
  if (bound === 'max') return maj;
  return min ? [maj, min] : maj;
}
