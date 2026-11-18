# Original Atari ST graphics

These resources are independently decoded from the original Hewson Pasti disk's FAT12 files and the recovered, unpatched `AUTO/GAME.PRG`. They do not contain an Atari emulator, ROM, Amiga screenshot, or replacement artwork.

Reproduce them with Node22.12+:

```sh
node tools/graphics/atari-st.mjs /path/to/source-files /path/to/original-main.bin
```

`canonical-inputs.json` validates every original file before extraction. The original main image is52426bytes, SHA-256 `2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638`. The provenance manifest records individual inputs, native addresses, ranges, and hashes. Original disk recovery is documented in [research/atari-st.md](../../../../research/atari-st.md).

The shared planar decoder implements the same verified word-interleaved four-plane byte format used by both16-bit machines. Every input bitmap, map, palette, placement table, text stream, and score record here comes from the ST release. Source-equivalent graphics are decoded again rather than copied from the Amiga JSON.

- `EXOPIC.PIC`:28-byte TOS data header, then22440bytes containing240×187 indexed pixels. The original copy starts at display(48,0) and copies189rows. The final two rows read beyond the file; this extraction uses zero background for those rows and outside the artwork. It preserves the full original picture, including its11black padding columns.
- Palettes: original main text offsets `$a22c` (five stages), `$a2cc` (menu), `$a2ec` (loading). Each channel is3-bit, expanded with `round(value*255/7)`; the ST white is255 rather than the Amiga rendition's238.
- Credits and messages: original VT52 streams retain exact uppercase wording,8×8 coordinates, and foreground `ink`. Game Over uses ink7 with the active stage palette.
- Font: `tos-system-8x8.fnt` is the original8×8 system font from [the restored Atari TOS source](https://github.com/th-otto/tos1x/blob/master/vdi/fonts/8x8/system.fnt). [font8x8.c](https://github.com/th-otto/tos1x/blob/master/vdi/font8x8.c) selects this source for the ordinary system font. The2650-byte input has SHA-256 `8bb21d897c7204a22b3d21a63072de3da5243230763475f725e534a6b1f704a6`. `asciiFont` retains all256glyphs, including original punctuation; `font` provides the shared39-glyph subset. The game's disk itself uses GEMDOS output and does not embed this font.
- The native piston routine copies height+1rows. The49th row retains two ink10pixels from an overlapping earlier `PC.DAT` read. The missile similarly reads its final28bytes from the following `LOGO.DAT` header. Both are preserved rather than silently replaced with the Amiga frame.

The five map banks and all125initial static scene compositions match the independently recovered Amiga pixel indices. Dynamic source bitmaps still differ: bullets25pixels, energy beam54pixels, missile27pixels, piston2pixels. Title artwork, text, score names, and RGB palettes remain platform-specific. Analog monitor response and PAL pixel aspect are not baked into these square-pixel assets.
