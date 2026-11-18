# Sharp MZ-800: Datelsoft colour version

The browser mode `sharp-mz800` uses the archived **Exolon New! / Datelsoft** conversion, with its original sixteen-colour presentation. It is not a four-colour reduction of the Spectrum renderer. This conversion selects 320×200 sixteen-colour video, requiring expanded VRAM on the original machine. The native TypeScript game model remains shared across platforms; no MZF program or CPU emulator runs in the browser.

## Sources and extraction

- [Archived program and screenshots](https://github.com/MZPico/mz-catalog/tree/main/titles/exolnew): `exolnew.mzf`, SHA-256 `57bf60e91a20d1f0357bd1fac0048fdca27381b7b29789511a7665a2191b35cf`. The catalogue metadata is marked uncurated; the in-program credit **PRO SHARP UPRAVIL DATELSOFT** identifies this adaptation. No official commercial Sharp release is asserted.
- `tools/recovery/sharp.mjs` reproduces the original header relocation and bootstrap offline, using the external MIT-licensed [Z80.js](https://github.com/DrGoldfire/Z80.js). Recovered 64 KiB RAM SHA-256: `108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f`.
- `tools/graphics/sharp.mjs` extracts the actual shapes, menus, font and nine sprite tables. Sharp bitmap bytes are LSB-first; reversing their bit order normalizes them for the shared drawing code. All nine normalized sprite tables are identical to Spectrum tables, but shape 451 differs and is retained in the separate Sharp geometry. All 125 maps have matching placement data.
- [Graphics provenance](../originals/graphics/sharp-mz800/graphics-provenance.json) records source addresses, lengths, hashes, map comparison and the archival screenshot hashes. Reference PNGs are preserved in `src/assets/images/sharp-mz800/reference/`.

## Original colours

The program writes `40,00,19,2A,3B` to palette port F0. Logical inks 0–3 map to palette entries 0, 9, 10, 11; the other entries remain available. The original brightness bit is preserved. The source glyph writer uses foreground INK on black; ZX PAPER and hardware FLASH bits are ignored. Bright-black foreground is the native grey ink.

RGB values follow the digital PAL palette in [mz800emu display.c](https://github.com/MZPico/mz800emu/blob/master/src/emulator/display.c), independently checked against the catalogue screenshots. `sharp-renderer.ts` outputs a 320×200 raster with the source play area centred. It does not simulate analogue monitor calibration or the complete GDG. The palette test compares **all 4,617 non-black menu pixels** with the archive menu capture, including its selected Cursor item; the RGB values match exactly. The recovered menu remains an independent gameplay asset; this validation does not establish the origin of the separate loading artwork.

## Native pixel composition

ZX Spectrum stores two colours (INK/PAPER, with shared brightness) for each 8×8 cell. The Sharp conversion uses four colour planes instead. The browser now keeps a separate 4-bit index for every Sharp pixel: overlapping sprites can produce more than two colours inside one 8×8 region without recolouring neighbouring pixels. Geometry, foreground occlusion masks and the original per-pixel XOR behaviour are retained; this is not a redesign of the source sprites.

The following addresses refer to the recovered 64 KiB Datelsoft RAM with the SHA-256 recorded above. They identify writes to GDG port CC, whose plane-mask and write-mode meanings are described in the [MZ-800 service manual](https://www.idealine.info/sharpmz/mz-800/download/sm800.pdf):

| Source routine | Evidence and browser operation |
| --- | --- |
| Glyph writer at `$3100` | Computes INK/BRIGHT from the source metadata, sets CC REPLACE (`$80` plus the native ink), and writes the glyph on black. PAPER and FLASH do not participate. |
| Player 24×32 writer at `$7814`; small 16×16 writer at `$7A37` | CC=`$2F`: EXOR all four planes, pixel mask 15. The wrapper at `$334A` restores `$2F` for ordinary small sprites. |
| Coloured flying enemies, wrapper at `$3354` | Patches the small-sprite mask to `$28 | (colour & 7)`. The matching erase wrappers at `$3366`/`$337E` restore that same mask. |
| Preshifted sprites, wrapper at `$322B` | CC=`$27`: EXOR the three low planes, pixel mask 7. |
| Player bullet at `$32BE`; enemy bullet at `$32CD` | CC=`$2F` / `$2E`: pixel masks 15 / 14. |
| Flashing scenery loop at `$9118` | Still writes RAM attributes at `$5800`, without writing GDG pixels. Its cell-colour mutation is not reapplied as a ZX display effect. |

The source pump uses the 24×32 writer; plasma sprites and large death effects use the ordinary small-sprite wrapper. They therefore use mask 15. Native XOR can change colours exactly where sprite pixels overlap scenery; applying the same sprite twice restores the background. This is different from a Spectrum attribute clash, which changes colours throughout an entire cell.

Source bitmap/colour metadata is retained for extraction and static glyph drawing; it does not impose a two-colour display cell on Sharp moving sprites. Tests cover four colours within one cell, unchanged neighbouring pixels, reversible XOR, source foreground occlusion, and the actual player sprite crossing coloured source tiles. All 125 maps and Sharp/ZX/Remastered Split pairs are checked in browsers.

## Music and effects

`tools/audio/sharp.mjs` executes the extracted original music/effect routines offline, captures every SN76489 byte written to F2, and renders them into an independent WAV bank. The original converted pitches, note order and attenuation are preserved. Chip-write traces, source program fragments, PCM recordings and [audio provenance](../originals/audio/sharp-mz800/provenance.json) remain in `src/audio/sharp-mz800/`.

The isolated driver uses 90 title steps/second and 50 effect steps/second. These rates are a presentation approximation, not a tempo measured on physical hardware: the source title and effects are driven by variable-duration drawing/game loops. Events without a separately identified source sound use documented aliases. Older platform sounds and all previous arrangements remain unchanged.

## Browser adaptations

The Graphics selector and either side of Split accept Sharp MZ-800. Loading the optional Sharp asset does not block other platforms. Its style can change during gameplay or pause without changing progress. The first screen includes a Sharp banner between Amstrad CPC and Remastered; choosing it unlocks and starts Sharp music in the same gesture.

The banner uses the archived monochrome Sharp picture from the [FRGCB comparison](https://frgcb.blogspot.com/2020/08/exolon-hewson-consultants-1987.html), at the user’s request. The full 256×192 picture is extracted from the preserved montage at x1438/y25, 512×384 source pixels, with every 2×2 block and both opaque black/white inks verified. The author explicitly questions its identification as a loading screen; use by this Datelsoft edition is unconfirmed. It is not claimed to come from the recovered MZF. The montage remains unchanged in `src/assets/images/shared/reference/`; generated hashes and crop details are in `dist/assets/images/intro-provenance.json`. Choosing the banner opens the recovered Datelsoft menu directly; the full-screen loading cover is no longer repeated. Unsupported original key-definition/input-device rows are omitted from the browser launch menu. Records use the source composition and the shared persistent player leaderboard, rather than replacing player data with Datelsoft's baked names. Shared gameplay, cheats, controls, name entry and ending states remain available.

## Reproduction and checks

```sh
npm run recovery:sharp -- /path/to/exolnew.mzf /path/to/Z80.js /path/to/sharp-ram.bin
npm run graphics:sharp -- /path/to/sharp-ram.bin
npm run audio:sharp -- --memory /path/to/sharp-ram.bin --z80 /path/to/Z80.js
npm test
npm run build
npm run check:browser -- --sharp-only
```

The extraction tools require the archived program and offline CPU source; ordinary builds and tests use the committed resources. See each tool's usage for optional output paths. Browser checks cover Chromium, Firefox and WebKit, native and legacy bundles, source palette membership, all 125 maps, pixel comparisons of Sharp/ZX and Sharp/Remastered Split in both directions, menu animation, independent music/effects, saved mode, mobile width and missing-art fallback. These checks do not constitute a physical MZ-800 or iPod test.
