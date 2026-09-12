# Third-party material

## Code

**@audio/encode-ogg@1.2.2** — MIT. libvorbis compiled to WebAssembly, vendored
as `vendor/ogg-encode.js` so the app encodes Ogg Vorbis offline from the first
launch. The licence text is in `vendor/encode-ogg-LICENSE.txt`.

Everything else is original to this repository or shared with Frame & Groove
(same author, same MIT licence): `css/tokens.css`, `css/base.css`,
`css/components.css`, most of `css/app.css`, and the modules in `js/core/`,
`js/audio/engine.js`, `js/export/zip.js` and `js/ui/` that are named as copies
in the README.

## Derived from Minecraft

**No audio.** Not one of Mojang's sound files is in this repository or in any
pack the app writes. The originals play only from a game folder the user links
on their own machine, and are never uploaded. When the user keeps a copy (a
switch, on by default), those same files are copied into this site's private
browser storage on that machine, readable only by the page, and deleted on
unlink.

`js/data/sounds.json` is text read out of the 26.2 client by
`scripts/build-sounds-data.py`:

- the sound event ids and their `sounds` arrays from `minecraft/sounds.json`
  (file names, volume, pitch, weight, stream and attenuation values);
- the English subtitle strings for those events, from
  `assets/minecraft/lang/en_us.json`.

The app needs these to list the sounds by the names the game gives them, and
to write a replacement that keeps each sound's subtitle, streaming and
attenuation. Minecraft's strings and data are Mojang's.

## The unofficial notice

NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG
OR MICROSOFT.
