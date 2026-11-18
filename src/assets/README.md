# Runtime graphics assets

`graphics/<platform>/` contains only JSON tables consumed by the current renderers. `images/<platform>/loading.png` contains saved native banners for ZX Spectrum, C64, Amstrad CPC, Sharp MZ-800, Amiga and Atari ST. `images/remastered/previews/banner.jpg` is the 640×480 preview; `images/vr/banner.png` is a saved 320×240 screenshot of the actual volumetric VR scene. `images/shared/icons/` contains the favicon and touch icon. Normal builds copy these exact bytes.

VR meshes and materials are authored procedurally in `src/games/vr/view/`, using recovered map layouts and contours with Remastered as the visual reference. There are no runtime model downloads or new archived source graphics. The saved banner was captured explicitly during development; regular builds do not launch a browser or regenerate it.

Unused full illustrations, original captures, fonts, reference frames and provenance live in [originals](../../originals/README.md). They are not browser resources and have no path aliases. The obsolete second loading cover is removed; handheld styling uses the existing gameplay renderer rather than a second cover.

`npm run graphics:loading-screens` is an explicit offline regeneration tool: it reads actual originals/graphics inputs and writes saved PNGs in src, with new provenance in originals/images/loading-screens-provenance.json. It is not part of the site build. The archive preserves the previous generated provenance unchanged.

Game data remains in src/data and platform data directories; active sound remains src/audio. Source hash and pixel checks use the actual archive/runtime locations directly. Attribution and required licenses remain distributed.

The original ZX cheat-confirmation WAV is stored with playback resources at `src/audio/zx-spectrum/cheat-enabled.wav`; its offline trace and attribution are in `originals/audio/zx-spectrum/`, with source evidence in `research/original-cheats.md`.
