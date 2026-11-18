# Exolon Atari ST — original source evidence and implementation

21.11.2026. Separate native TypeScript implementation, approved and implemented 21.11.2026.

## Original sources

- [Atarimania original release](https://www.atarimania.com/games/atari-st-games-exolon-9263), original Pasti image: [exolon_hewson.zip](https://www.atarimania.com/st/dumps/exolon_hewson.zip).
- [SNDH Exolon by Dave Rogers](https://sndh.atari.org/?ID=1558). The original archive entry exposes two subtunes, replay frequency50Hz. Download requires the archive page as HTTP Referer; the unauthenticated hotlink redirect is HTML, not music data.
- [Klaz HDD adaptation](http://www.klapauzius.net/Old_Games.html#Exolon), secondary inspection aid only. It includes platform patches, trainer options and altered records; its names and behavior are not canonical inputs.
- [FRGCB comparison supplied by the user](https://frgcb.blogspot.com/2020/08/exolon-hewson-consultants-1987.html), a list of differences to verify against source data. Its stage-count claim is expressly tentative.
- [Hatari STX structures](https://hatari.frama.io/hatari/doxygen/stx_8h_source.html), reference for track/sector descriptors.

| Input         | Bytes  | SHA-256                                                            |
| ------------- | ------ | ------------------------------------------------------------------ |
| Original ZIP  | 178428 | `4f6253dec7406c8e36a4e9941947d2c7e2e54be67302de1dcee2a2e180a77a2c` |
| Exolon.stx    | 466688 | `10a96cc93ab4c73a171f0e3408e99d2ff692a280bdb4f05eaf4e75f33e185ccf` |
| AUTO/GAME.PRG | 58394  | `9adfe8193f1773c30c91249276f64e024f0df681490645cf3e6489eea9f10af4` |
| Exolon.sndh   | 4032   | `f7fedb6ff4835186dec8b8d8463173d5af6f7a3430bf20837aef8cb89ec15b38` |

Temporary originals and extraction probes are under `/tmp/reex-atari-research/`. They are not build dependencies. [atari-st-source-files.json](atari-st-source-files.json) records file sizes and hashes extracted from original sectors through FAT12. The production extractor validates the original image and preserves sector/error metadata; a flat ST image is not a substitute for the protected Pasti original.

## Verified implementation

The separate native TypeScript game is implemented under `src/games/atari-st/`, with explicit shared mechanisms under `src/games/16bit/`. No CPU/TOS/SNDH emulator runs in the browser. The seven-banner picker launches it with `game=atari-st`; graphics, records, name and cheats are independent of Amiga.

### Executable and model

The original Rob Northen loader/protection was executed offline without using HDD-patched gameplay bytes. Only host BIOS/XBIOS interfaces, original sector reads, successful physical read timings and supervisor/user stack banking were supplied. [Recovery manifest](atari-st-recovery.json) records the exact inputs and hooks. Canonical recovered text is 52,426 bytes, SHA-256 `2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638`; the unrelocated inner TOS program is 54,806 bytes, SHA-256 `c7c03df04258f86ef00c9b1a35a0dda3127c1b682e12c94621479d9164eee6ba`. The recovered text is preserved as [atari-st-original-main.bin](atari-st-original-main.bin) for bounded independent extraction tests.

All five 25-screen map banks match the Amiga tile data byte-for-byte, and all 125 screen metadata records match after memory-pointer normalization. Independent table addresses/hashes: [model comparison](atari-st-model-comparison.json); canonical table fixture: [model golden](atari-st-model-golden.json). ST flyer graphics pointers become semantic IDs 1…4; trajectory keys retain ST addresses. Other source table values are preserved.

The original piston collision **does kill an overlapping unarmored player while raised**. Armor protects; height 0 is harmless. The external article's tentative harmless-piston observation is contradicted by direct execution of the original branch. The hunter appears at update 300 and moves from X320 to315 on 301. See [behavior trace](atari-st-behavior.json).

Original stage end indices are 24/49/74/99/124. Executing the final path confirms bravery/lives bonus → congratulations → roulette → reload first stage, preserving lives and score while resetting armor, ammunition and entry height. [Ending trace](atari-st-ending.json) records the exact source texts/file reads.

### Graphics and pages

All resources are independently decoded from the canonical ST files; shared planar-format helpers do not substitute Amiga data. [Graphics provenance](../originals/graphics/atari-st/provenance.json) identifies all 81 resources and native addresses. All 125 initial static scenes have identical palette indices to Amiga. Source dynamic frames differ in bullets 25 pixels, beam 54 pixels, missile 27 pixels and piston 2 pixels, and these differences are retained.

The original `EXOPIC.PIC` body is 240×187 pixels, displayed at(48,0). The original routine copies 189 rows, reading two rows beyond the file; the reconstruction uses zero padding for those rows and the area outside the picture. The banner PNG is generated from the preserved indexed picture at build time, never substituted with the Amiga cover.

ST palettes use three bits per channel expanded to 0…255. Original VT52 text records retain wording, position and ink. TOS system-font rows come from the restored [Atari source](https://github.com/th-otto/tos1x/blob/master/vdi/fonts/8x8/system.fnt), with full 256-character ASCII support. The game itself calls GEMDOS text output rather than embedding a font.

Independent original 68000 page captures cover title, name entry, Game Over, six scroll positions, bravery, roulette and congratulations: [reference frames](../originals/images/atari-st/reference/README.md). Full RGBA frames and popup rectangles match the TypeScript renderer. Name/bonus/ending frames preserve their native borders, logoY24, text inks and roulette pointerY104. Hall of Fame retains logoY8 and clipX80…239/Y54…191.

### Pacing and audio

The first-screen gameplay baseline is 50/3 updates per second. Original first-screen updates cost 346,596…352,766 core cycles, exceeding two PAL frame budgets at roughly 8 MHz. Native display synchronization polls TOS `_frclock` at`$466`, confirmed by the [EmuTOS fixed-address map](https://github.com/emutos/emutos/blob/master/tosvars.ld); the 200 Hz system timer is at`$4ba`. [Timing evidence](atari-st-timing.json) includes measured cycles and caveats. Later scenes use [independently measured workload baselines](native-piston-pacing.md): 106 screens retain 60 ms, and 19 require 80 ms. The first piston on screen 4 retains 60 ms and uses the original TOS random recurrence. Menu stars advance every four nominalPAL loops (80ms); score scrolling uses a 40 ms baseline from the independently measured loop cost, rather than copying the Amiga 80 ms interval.

Original main music selection is D1=1, Game Over D1=7. Original unmodified replay register bytes match the preserved SNDH exactly across 12,000 main/600 ending ticks. Main music continues through gameplay. The original music-enabled flag suppresses the native effect dispatcher; no invented effects replace it. The browser exposes the original main/Game Over music path; it does not emulate the separate original music-disabled SFX mode.

The main song has one silent initialization tick and an exact 10,398-tick loop: the shorter SNDH metadata omits alternating channel C arpeggio state. Game Over contains 158 ticks and becomes muted at 157. Native TimerA replay timing and the automatic return to main are documented with recordings in [audio provenance](../originals/audio/atari-st/provenance.json). Saved SNDH, register traces and archive-rate recordings remain available alongside native playback resources. Offline synthesis uses the original YM2149 register stream and 2 MHz chip clock; no Amiga recording is reused.

### Reproduction and limits

See [native source recovery notes](atari-st-native-source.md), [graphics README](../originals/graphics/atari-st/README.md), [audio README](../originals/audio/atari-st/README.md) and [game tool commands](../docs/game.md#atari-st--отдельная-игра). Regular build/tests need no disk, ROM or Python emulator. Research extraction validates hashes and is separate from normal build.

Known fidelity limits are explicit: the TOS random recurrence uses a deterministic initialized browser seed; per-scene gameplay and fixed scroll baselines do not reproduce varying CPU/bus/OS load; Game Over's busy-wait duration is a documented CPU-rate baseline; CRT/analog output and pixel aspect are not emulated. Loading-picture overread padding is deterministic. Playwright verifies browsers and compatibility paths, not physical Atari hardware, iPod or television models. Original rights and attributions remain with their owners.
