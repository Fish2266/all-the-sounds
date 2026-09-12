# All The Sounds

Every sound in Minecraft, listed. Record your own for any of them, trim and
retake, and export a resource pack that swaps yours in for the game's. Runs
entirely in the browser — no build step, no account, nothing leaves your
machine.

The third of [Fish's MC Tools](https://fish2266.github.io/mctools), next to
[Frame & Groove](https://fish2266.github.io/frame-and-groove/), and built from
the same parts.

---
## How to run it locally

```bash
python3 -m http.server 8723 --directory .
```

Then open <http://localhost:8723>. It has to be served over `http://` rather
than opened as a `file://` path: the app is ES modules, and the recorder is an
AudioWorklet, which browsers only load from a real origin. `localhost` counts
as secure, so the microphone works there too.

---

## The thing worth knowing first

**A sound is an event, not a file.** `entity.cow.ambient` is what the game
plays; it points at `mob/cow/say1` … `say4`, and the game picks one at random
each time. That is the unit here. You record takes for an event — one or
twenty — and the game picks among yours exactly the way it picked among
Mojang's.

1,968 events in 26.2 point at 4,843 files, and many files are shared between
events. Working per event keeps the list to the names the game itself uses
(the subtitles — "Cow moos", "Door creaks") and means replacing a sound can
never half-replace it.

**Replacing an event deletes its subtitle unless you say it again.** The game
throws the old registration away when a pack says `"replace": true`, subtitle
included. Every entry this app writes restates the vanilla subtitle key, so
subtitles keep working:

```json
"entity.cow.ambient": {
  "replace": true,
  "subtitle": "subtitles.entity.cow.ambient",
  "sounds": [ "mysounds:entity/cow/ambient/1", "mysounds:entity/cow/ambient/2" ]
}
```

The same goes for `stream` (music, discs and long ambience are streamed from
disk) and `attenuation_distance` (a ghast is heard from further away than a
chicken): where every vanilla file agrees, the replacement gets the same value.

**Replace or mix.** Each sound can instead be written with `"replace": false`,
which adds your takes to the vanilla pool — the game then sometimes plays yours
and sometimes Mojang's.

## What lands in the zip

```
<namespace>_sounds.zip
├── pack.mcmeta
├── pack.png
├── assets/minecraft/sounds.json           one entry per sound you recorded
├── assets/<ns>/sounds/entity/cow/ambient/1.ogg
├── assets/<ns>/sounds/entity/cow/ambient/2.ogg
├── …
└── .all-the-sounds/project.json           so the zip reopens here exactly
```

A sound pack needs no data pack — replacing a sound is purely a resource-pack
job — so unlike Frame & Groove this writes one zip, not two.

## Recording

Frame & Groove records with `MediaRecorder`, which is right for a three-minute
disc and wrong for a cow: the browser's compressed stream starts a beat late
and comes back as Opus that has to be decoded again. Here the samples come
straight off an **AudioWorklet** (`js/audio/capture-worklet.js`):

- **Pre-roll.** While the mic is armed, the worklet keeps the last quarter
  second in a ring buffer and hands it over when recording starts. You can
  press R a moment after you start the noise and the attack is still there.
- **Auto-trim.** Windowed RMS against a threshold that is absolute for a quiet
  take and relative to the loudest moment for a loud one, padded so breaths
  and tails survive. The trim is a setting, not an edit — pull it back out any
  time.
- **Lossless until it ships.** A take is stored as 16-bit WAV. Trim, gain,
  fades and normalising are applied once, on the way into the one Vorbis pass
  that goes in the pack.
- **What you hear is what ships.** Playing a take in the app runs it through
  the same `processBuffer()` the exporter uses, at the volume and pitch
  written into `sounds.json`.
- **Starts at the game's loudness.** A new take's in-game volume starts at
  the median of the vanilla files' volumes, so a normalised recording lands
  where the game meant that sound to sit.
- **Mono by default.** Minecraft only positions mono sounds in the world; a
  stereo take plays flat wherever it happens. The worklet folds to mono.
- **Voice processing off.** Echo cancellation, noise suppression and automatic
  gain are tuned for calls and smear sound effects, so they start off
  (Preferences can turn them on).

The interface clicks — the same synthesised set as Frame & Groove — are
silenced on the record panel and across the whole board while a take is
running, so they never end up in a recording.

## Hearing the originals

This app ships **none of Mojang's audio**. Link your game folder once
(Preferences, or the card under the categories) and it reads from your own
disk:

| File | For |
| --- | --- |
| `assets/indexes/<n>.json` | which hashed object is which sound |
| `assets/objects/…` | the vanilla `.ogg` files, played on demand |
| `minecraft/sounds.json` (via the index) | the exact event list for your version |
| `versions/<v>/<v>.jar` → `version.json` | the resource pack format |
| `versions/<v>/<v>.jar` → `lang/en_us.json` | subtitle names for new events |

**Chrome will not give a site a directory handle for the game folder** on
macOS or Windows. `showDirectoryPicker()` refuses anything inside `~/Library`
or `AppData` — "can't open this folder because it contains system files" — and
that is exactly where the launcher installs the game. So there, and in Safari
and Firefox, the folder is read through a plain `<input webkitdirectory>`:

- It opens fine. The browser words its prompt as "upload N files"; nothing is
  uploaded — the files are only readable by the page, and only the index, the
  version file and the sounds you play are ever opened. The game folder is
  about 6,500 files, which a file list handles in a moment.
- A file list cannot outlive the session, and a page can never remember a
  path. So the first link **keeps a copy**: the sound files the linked
  version uses (about 375 MB for 26.2) are copied into this site's private
  storage — the origin private file system, on the same disk, readable only by
  this page — and from then on the originals play on every visit with nothing
  to pick. Linking a newer version later copies only what changed. It is a
  switch in the link dialog, on by default; turning it off or unlinking
  deletes the copy.

Where the directory picker can reach the folder (Linux, `~/.minecraft`), the
handle is remembered and the browser just asks for read access again.

On macOS the folder is in the hidden Library folder: press ⌘⇧G in the picker
and paste `~/Library/Application Support/minecraft`.

## The sound list

`js/data/sounds.json` is read out of the 26.2 client by
`scripts/build-sounds-data.py` — names, subtitles and the vanilla `sounds`
arrays, never audio. The 23 events the 26.3 snapshots add are included and
marked. To rebuild it after a new release:

```bash
python3 scripts/build-sounds-data.py 26.2 26.3-snapshot-9
```

**Nothing here can go stale**, though, because a linked game's own
`sounds.json` replaces the bundled list outright. Takes recorded for an event
the current list does not know are never hidden — they show under "not in this
version" and still export.

## Version support

sounds.json has had the same shape through every release listed; only
`pack.mcmeta` changes.

| Target | Resource format | pack.mcmeta |
|---|---|---|
| 1.21 – 1.21.1 | 34 | `pack_format` |
| 1.21.2 – 1.21.3 | 42 | `pack_format` |
| 1.21.4 | 46 | `pack_format` |
| 1.21.5 | 55 | `pack_format` |
| 1.21.6 | 63 | `pack_format` |
| 1.21.7 – 1.21.8 | 64 | `pack_format` |
| 1.21.9 – 1.21.10 | 69 | `min_format` / `max_format` |
| 1.21.11 | 75 | `min_format` / `max_format` |
| 26.1 – 26.1.2 | 84 | `min_format` / `max_format` |
| **26.2** | 88 | `min_format` / `max_format` |
| 26.3 (snapshot) | 96 | `min_format` / `max_format` |

A linked game adds a "from your game" target with the numbers out of its own
jar.

## Round trip

Every exported pack carries `.all-the-sounds/project.json`, so dropping the zip
back in reopens it with every take, its weight, volume and pitch. Its Ogg is
kept as the encode, so exporting again does not compress it a second time.

Sound packs made anywhere else are read the two ways they get made: through
`assets/minecraft/sounds.json`, or by dropping `.ogg` files straight over
vanilla paths (`assets/minecraft/sounds/mob/cow/say1.ogg`), which the sound list
maps back to every event that plays that file.

## Keyboard

| Key | Does |
| --- | --- |
| `R` | Record — and again to keep it |
| `Esc` | Throw the take away |
| `Space` | Play the selected take, or the newest, or an original |
| `O` | Play an original, picked by weight like the game does |
| `N` | Next sound you have not done |
| `↓` `↑` / `J` `K` | Next / previous sound |
| `1`–`9` | Pick a take and play it |
| `Delete` | Delete the selected take (Undo is on the toast) |
| `/` | Search |
| `⌘K` | Command palette — every sound is in it by name |

With **Move on after each take** switched on in Preferences, `R`, `R`, `R` works
through a whole category without touching the mouse.

## Layout

```
index.html
css/      tokens · base · components   byte-for-byte copies from Frame & Groove
          app                          Frame & Groove's shell, less its paintings,
                                       mobs and sprites
          sounds                       only this app's own layer
js/
  core/   dom util icons               copied from Frame & Groove
          db                           copied, with its own database name
          texturepack                  an empty stand-in, so ui/textures.js is a
                                       straight copy
          versions project store soundlist gamelink
  audio/  engine                       copied from Frame & Groove
          capture capture-worklet takes
  export/ zip                          copied from Frame & Groove
          packbuild importer
  ui/     kit sfx tooltip cmdk textures  copied from Frame & Groove
          pixicons pixelart-overrides    copied too — the rail wears Frame &
                                         Groove's own hand-drawn icons
          shell brandmark waveform gamelinkui
  ui/views/ library sounds export
  data/   sounds.json                  generated by scripts/build-sounds-data.py
scripts/  build-sounds-data.py
vendor/   ogg-encode.js (@audio/encode-ogg@1.2.2, MIT)
```

When Frame & Groove's design language or one of the shared modules changes,
copy it across again rather than editing it here.

The database is called `all-the-sounds`, not `frame-and-groove`: both apps are
served from `fish2266.github.io`, one origin, so they would otherwise open each
other's projects.

## Storage

Packs and takes live in IndexedDB in your browser. Browsers can evict site
data under pressure, and exporting is always the real backup.

## Putting it online

Static files, no build step, so GitHub Pages serves it as-is from a repository
called `all-the-sounds` at `https://fish2266.github.io/all-the-sounds/`:
Settings → Pages → Deploy from a branch, `main`, `/ (root)`. `.nojekyll` is
there, every path is relative, and nothing needs special headers — the
microphone needs HTTPS, which Pages gives you.

## Licence and legal

- **[LICENSE](LICENSE)** — MIT, as Frame & Groove.
- **[THIRD-PARTY.md](THIRD-PARTY.md)** — the vendored Ogg encoder, and exactly
  what is derived from Minecraft (text only — no audio).
- **Privacy.** Nothing is collected: no accounts, no analytics, no cookies, no
  servers. The microphone is open only while the red **Mic live** light is on
  in the top bar; click it to close it, and it closes itself after two idle
  minutes or when you leave the sound board.

> NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH
> MOJANG OR MICROSOFT.
