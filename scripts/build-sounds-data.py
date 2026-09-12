#!/usr/bin/env python3
"""
Build js/data/sounds.json from the Minecraft client you have installed.

Reads names and numbers only — never audio:
  • the sound event list (assets/minecraft/sounds.json, via the asset index),
  • the English subtitle strings (assets/minecraft/lang/en_us.json, in the jar).

Every event is written with its vanilla `sounds` array exactly as the game has
it, so the app can play the originals from a linked game folder and carry the
subtitle key and the per-entry attributes (stream, attenuation_distance) into
the replacement it writes.

Usage:
  python3 scripts/build-sounds-data.py                 # 26.2, plus 26.3 snapshot additions
  python3 scripts/build-sounds-data.py 26.2 26.3-snapshot-9
"""

import json
import os
import sys
import zipfile
from datetime import date

MC = os.path.expanduser(
    os.environ.get('MINECRAFT_DIR')
    or {'darwin': '~/Library/Application Support/minecraft',
        'win32': os.path.join(os.environ.get('APPDATA', ''), '.minecraft')}.get(sys.platform, '~/.minecraft')
)
OUT = os.path.join(os.path.dirname(__file__), '..', 'js', 'data', 'sounds.json')


def version_json(v):
    with open(os.path.join(MC, 'versions', v, f'{v}.json')) as f:
        return json.load(f)


def load_sounds(v):
    index_id = version_json(v)['assets']
    with open(os.path.join(MC, 'assets', 'indexes', f'{index_id}.json')) as f:
        objects = json.load(f)['objects']
    h = objects['minecraft/sounds.json']['hash']
    with open(os.path.join(MC, 'assets', 'objects', h[:2], h)) as f:
        return index_id, json.load(f)


def load_lang(v):
    jar = os.path.join(MC, 'versions', v, f'{v}.jar')
    if not os.path.exists(jar):
        # The launcher keeps a version's json after it deletes the jar. The
        # release's own strings still cover almost every snapshot subtitle.
        return {}
    with zipfile.ZipFile(jar) as z:
        return json.loads(z.read('assets/minecraft/lang/en_us.json'))


def main():
    release = sys.argv[1] if len(sys.argv) > 1 else '26.2'
    snapshot = sys.argv[2] if len(sys.argv) > 2 else '26.3-snapshot-9'

    index_id, sounds = load_sounds(release)
    lang = load_lang(release)

    snap_sounds, snap_lang = {}, {}
    if snapshot and os.path.isdir(os.path.join(MC, 'versions', snapshot)):
        _, snap_sounds = load_sounds(snapshot)
        snap_lang = load_lang(snapshot)

    events = []

    def add(eid, entry, since=None, strings=lang):
        key = entry.get('subtitle')
        row = {'id': eid}
        if key:
            row['key'] = key
            text = strings.get(key) or lang.get(key)
            if text:
                row['sub'] = text
        row['s'] = entry.get('sounds', [])
        if since:
            row['since'] = since
        events.append(row)

    for eid in sorted(sounds):
        add(eid, sounds[eid])
    snap_label = snapshot.split('-')[0] if snapshot else None
    for eid in sorted(set(snap_sounds) - set(sounds)):
        add(eid, snap_sounds[eid], since=snap_label, strings=snap_lang)

    events.sort(key=lambda r: r['id'])
    data = {
        'version': release,
        'assetIndex': index_id,
        'snapshot': snapshot if snap_sounds else None,
        'built': date.today().isoformat(),
        'events': events,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(data, f, separators=(',', ':'), ensure_ascii=False)

    files = {s if isinstance(s, str) else s['name']
             for e in events for s in e['s']
             if isinstance(s, str) or s.get('type', 'file') == 'file'}
    print(f'{len(events)} events ({sum(1 for e in events if "since" in e)} from {snapshot}), '
          f'{len(files)} vanilla files referenced, '
          f'{sum(1 for e in events if "sub" in e)} with subtitles -> {os.path.relpath(OUT)} '
          f'({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
