# Exolon Amiga — source recovery and native browser game

20.11.2026. Independent TypeScript/Preact implementation in reex, entered through the Amiga banner. Amiga has its own model, original maps, graphics, music and records. It is not a Graphics/Split mode. The [approved specification](../docs/superpowers/specs/2026-11-20-exolon-amiga-design.md) and [implementation plan](../docs/superpowers/plans/2026-11-20-exolon-amiga.md) describe the boundaries.

## Original inputs

| Input | Source | Bytes | SHA-256 |
| --- | --- | --- | --- |
| WHDLoad installer | [WHDLoad Exolon](https://www.whdload.de/games/Exolon.html), `https://www.whdload.de/games/Exolon.lha` | 16858 | `53be724f3641be2ffe0075bf0c51df7cd3c65d00fde1d1403ac7f73731e8f23a` |
| Preinstalled game archive | [WHDownLoad catalogue](https://www.whdownload.com/games.php?name=e&sort=0&dir=0), `https://www.whdownload.com/games/E/Exolon_v1.3_0015.lha` | 222214 | `b13822b8fffd5a5bc56766ab492af9676cec8702741d50587e7e15755dd0d09c` |
| Extracted `Exolon/Disk.1` | Above archive, LHA CRC verified | 901120 | `54260a1b4f95b18b115ef69d5f90cbc7a584e74c28572e7296e80196989ee8d1` |
| Initial recovered RAM | Original disk-read sequence, 35 regions | 524288 | `8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7` |

The WHDLoad installer is a patch/installation package, not the game source. Its documentation distinguishes PAL/NTSC revisions and timing/DDFSTOP fixes. We unpacked its archive offline, read the original disk bytes, and reconstructed the PAL loader/data placement without applying the slave's runtime patches. The validated loader identifies this PAL layout; other editions are rejected by checksum. A general claim about every Amiga release is not made.

Original boot code loads its service at RAM `$15000` from disk `$1dc00`, then the game at `$8000` from disk `$12800`. The startup's thirty further reads are recorded independently in [amiga-loader.json](amiga-loader.json). Offline analysis used temporary `lhafile` for CRC-checked decompression and Capstone for 68000 disassembly. These packages, the disk, full RAM and CPU execution are not browser dependencies.

## Original graphics and campaign

[Graphics provenance](../originals/graphics/amiga/provenance.json) preserves source ranges, hashes, code snippets and decoding details. Two native 256-tile banks, 125 maps and the game's own static object composites are extracted independently from ZX. Maps are 40×23 bytes; five disk banks each contain 25 screens after a 28-byte header. Stage-end indices come from RAM `$92a2`: 24, 49, 74, 99, 124.

Display size is 320×200. Copper DIWSTRT `$4781` / DIWSTOP `$0fc1` gives 200 visible lines; DDFSTRT `$38` / DDFSTOP `$d0` gives 40 bytes per scanline. Player/object graphics use four planes with native word/row interleaving. The loader illustration uses five full planes and its own 32-entry palette. Gameplay palettes are stage-specific, read at `$111f0` and converted exactly as `$c802` writes them. Physical PAL pixel aspect and analog monitor calibration are not baked into the extracted pixels.

The original 320×200 loading illustration is used by the banner. Choosing it opens the native menu directly, avoiding a repeated full-screen copy. Its credits, the menu's original text, logo and native Hall of Fame names are preserved. Game scene resources include the two player suits, walking/jumping/crouching poses, death frames, flyers, turrets, projectiles, pods, mines, teleports, barriers, spikes, exit gates, fonts and HUD.

The player has 15 source 32×40 poses and 15 mirrored poses per suit. Its Y is a bottom anchor; rendering uses `(X,Y-40)`. Death frames are 48×48 at `(deathX,deathY-48)`. Original player blits mask index zero, then source `$c824` redraws map tile IDs 1..128, including their black pixels, in front of actors. HUD digits update plane 1 at Y193. These are native Amiga rules, without ZX attributes.

The teleport energy overlay is a one-shot thirteen-frame sequence after transport, idle at source phase13, positioned inside the chamber by `$d40c/$be54`. It does not continuously flash while unused; its lifecycle and alignment are covered by model/pixel/browser regressions.

Source `$c29c` makes 100 star-placement attempts within 320×176 on empty background pixels. Browser presentation uses a reproducible seed instead of the original hardware clock. Initial background comparison PNGs intentionally omit those procedural stars and moving actors.

## Original logic and measurements

Detailed source addresses, tables and behavior are in [amiga-behavior.md](amiga-behavior.md). The model uses its own extracted jump arcs, projectile paths, enemy paths and per-screen object tables. Native movement is three pixels per update, gravity four, and held fire switches from a single bullet to a grenade at ten updates. The main loop waits for a PAL vertical blank per iteration, but that is not 50 gameplay updates/second: its software framebuffer copy alone exceeds one 20ms budget on a 7MHz 68000. An offline core-cycle probe of the first screen needs three PAL budgets per update. Browser gameplay now uses separate 60/80ms scene baselines from [independent workload samples](native-piston-pacing.md), while menu PAL timing and music remain independent. This is a baseline adaptation, not measured physical-hardware FPS; later dynamic workloads can run slower. The [original first-screen timing evidence](amiga-timing.md) remains unchanged.

Source fixtures cover movement/turning, directional arc collision samples, standing/crouching, fire and grenades, native RNG word arithmetic, damage/respawn, terrain, armor/mines, laser damage, destruction, stage bonuses and the final loop. Direct browser level selection is an adaptation: it chooses a supported entry surface on raised maps rather than starting below the ground. Adjacent screen transitions retain their original entry height. Falling out of bounds recovers even under invulnerability.

The native bonus order is bravery/lives summary, roulette, then the next bank. The final bank inserts congratulations before its roulette and then starts the next campaign loop with score/lives retained. The browser requires separate released fire presses between those screens. Original records contain 34 names; zero and below-cutoff results bypass name entry, ties qualify. Amiga records and cheat preferences have independent registered storage keys. A run selected through cheats stays excluded even after those toggles are disabled.

### Crouching and turret shots

Original `$ac7e..accc` tests bullets against a 32×40 player rectangle; `$e618` shifts the crouching Y anchor down six pixels. Turret `$b9e8` can place a bullet eight pixels lower. Thus a high shot can pass above a crouched player while a lower shot still hits. The source-fixture regression checks standing/high (hit), crouching/high (miss), and crouching/lower (hit). Crouching grants no immunity.

## Original music and effect dispatcher

[Audio provenance](../originals/audio/amiga/provenance.json) retains the original sample bank, driver and lifecycle code snippets. The recovered song has six PCM instruments, ten patterns and eleven orders. It is rendered offline at 22050 Hz stereo, using the original note periods, sample data and volume commands. Its full loop is 2,001,095 output frames (approximately 90.752593 seconds). WAV SHA-256: `c41d7b0a5fae64ac07437b1dfed0f3ee6cc4c49d36e799585584f5540277d6a4`.

The PAL CIA latch is `$3b88`, six ticks per music row. Gameplay `$9310 → $93b6 → $9570 → $957c → $a016` reinitializes that same music bank; F toggles it. Starting a game/stage restarts the recovered track. In this particular disk revision the effects dispatcher `$a040` is a bare RTS, including calls from firing/grenades: substitute ZX effects are not added. Analog filtering and Paula DMA microtiming are approximations of the offline mixer.

### Additional editions checked — 21.11.2026

The credits do include both MUSIC (J. D. Rogers) and SOUND (G. Henkel). Credits alone do not establish that gameplay effects run. To check whether our initial disk was exceptional, six additional ADF images were downloaded and inspected: Hewson PAL/QTX, its Band and Cosmos trainer copies, Hewson PAL/Maverick, PAL/Maverick reissue, and Medalist NTSC/Maverick. Catalogue dates and labels are preserved as archive identifiers, not asserted as independently verified release history.

[Edition comparison](amiga-audio-editions.json) records each source URL, decompressed disk SHA-256, music-driver hash, and resolved call offsets. In all six images the checked shot (`$16`), teleport (`$1c`), ammunition (`$1f`) and grenade-pickup (`$20`) calls target a single `RTS` (`$4e75`). The dispatcher is at disk `$14832` in the QTX copies and `$14840` in the Maverick copies. These are disk offsets: RAM addresses can differ between editions. The QTX music driver differs from the initial disk's driver; its effect dispatcher remains empty.

This is a static comparison, not a physical-hardware listening test or a complete runtime-patch trace of each image. The trainer copies share the same dispatch code; six disk hashes do not mean six independent original revisions. No working effects implementation was found among these images, but this does not prove absence from every possible Amiga edition. Game resources and behavior were left unchanged.

For reproduction, find the unique byte sequence `72 <effect ID> 61 00` (MOVEQ to D1 followed by BSR.W). If its first byte is at disk offset `p`, the call target is `p + 4 + signedBE16(disk[p + 4:p + 6])`; inspect the target's first word. All 24 checked calls in the manifest resolve to `$4e75`.

## Reproduction and verification

```sh
node --experimental-strip-types tools/recovery/amiga.mjs /path/to/Disk.1 /tmp/amiga-ram.bin
node --experimental-strip-types tools/recovery/amiga-model.mjs /path/to/Disk.1 /tmp/amiga-model-constants.ts
node --experimental-strip-types tools/graphics/amiga.mjs /path/to/Disk.1
node --experimental-strip-types tools/audio/amiga.mjs /path/to/Disk.1
npm test
npm run build
npm run check:browser -- --amiga-only
```

Ordinary builds use committed extracted data and do not need an Amiga disk or offline analysis packages. Tests verify full extraction hashes, source read records, native rendering across all five stages, original audio reconstruction, gameplay fixtures, all 125 direct level starts, cancellation, independent saves and malformed inputs. Browser checks cover modern/ES5 bundles in Chromium/Firefox/WebKit, music activation, controls, touch orientations, gamepad/remote behavior, missing assets/modules, Retry and absence from Split. They do not establish physical Amiga/iPod/TV testing.

Remaining boundaries: hardware-seeded random sequences and omitted cosmetic RNG calls differ; some entity update ordering remains simplified; structural debris now follows the recovered pool/vectors with a fixed startup cosmetic seed. No complete cycle-by-cycle hardware trace has been compared. These limitations do not justify substituting another platform's maps or assets.

Original game credits are extracted from its own menu: program M. J. Bysh, Amiga conversion G. Henkel, graphics G. P. Felix, music J. D. Rogers, sound G. Henkel, Hewson 1989. Archival access does not grant a new license; original artwork/code attribution remains intact.

The floor-piston sprite is a late disk load after the startup snapshot: disk`$37000` -> RAM`$18102`,768 bytes. Graphics extraction reads this region explicitly; the original snapshot/hash remain unchanged. See [piston behavior and reproduction](amiga-behavior.md#retracting-floor-pistons--21112026) and [original procedure references](amiga-pistons.json).

Native gameplay now uses [source workload baselines for each scene](native-piston-pacing.md). The first piston on screen 4 updates at 80 ms rather than the first-screen 60 ms baseline. Its original random threshold and extension/retraction state machine remain unchanged.
