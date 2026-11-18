# Commodore 64 rocket destruction

The original C64 game removes a destructible obstacle on rocket impact, awards **150 points**, and scatters particles across the screen. A short impact flash alone does not reproduce that destruction effect.

## Original program evidence

This investigation uses the same High Society PRG and unpacked RAM as the existing [graphics provenance](../originals/graphics/c64/c64-graphics-provenance.json) and [movement investigation](motion-c64.md). The checked 65,536-byte RAM snapshot has SHA-256 `d0523af437b42628042a850c8ca69a5619f03f36acf8c66bec414bfffd2b92a4`. No archival bytes or golden references were changed.

- `$1914..$199f` advances the player's rocket and dispatches impact handling.
- `$19a3..$1a13` searches the seven-byte obstacle records at `$2f40`. A matching record is disabled with `$80`; the block parser is called in drawing mode 3, then normal drawing is restored. The score addend ends at `$38ca`, containing `000150` in `$38c5..$38ca`.
- Mode 3 selects `$3e45` through `$1ab6`. Each drawn cell is removed from bitmap/collision buffers, then `$3eeb` jumps to `$270b` to allocate a particle. This also applies to blank cells in the block's drawing commands.
- `$270b..$2785` allocates one six-byte particle record per cell, with a maximum of 100 records starting at `$281f`. It draws shifted sprite 2. Horizontal deltas at `$2786` are `-4,-3,-2,0,0,2,3,4` in two-pixel units; vertical deltas at `$278e` are `-8,-6,-4,0,0,4,6,8` in pixels. Both deltas cannot be zero.
- `$2797..$281e` redraws and moves particles once per main-loop update. Particles retire when their native x leaves `[0,120)` or y leaves `[0,169)`. They have no gravity or ten-tick flash lifetime.

An offline procedure probe with the pinned external jsSID MOS6510 helper initialized the game at `$1395`, stopped at the first `$13c4`, and called `$19a3` with rocket coordinates `$0c=76`, `$0d=112`. This hits the first-screen barrel (block 5, placement x20/y14). The procedure allocated **18 particles** and the score became `000150`. The first four records, with signed deltas, were:

| Update | Native x | Pixel y | Native dx | Pixel dy |
| --- | ---: | ---: | ---: | ---: |
| Allocation | 80 | 112 | 0 | -4 |
| Allocation | 84 | 112 | 4 | 0 |
| Allocation | 88 | 112 | -2 | 4 |
| Allocation | 92 | 104 | 0 | -8 |
| After one call to `$2797` | 80 | 108 | 0 | -4 |
| After one call to `$2797` | 88 | 112 | 4 | 0 |
| After one call to `$2797` | 86 | 116 | -2 | 4 |
| After one call to `$2797` | 92 | 96 | 0 | -8 |

The helper's input hashes and CPU limitations are documented in the linked provenance and movement investigation. This verifies the isolated program routines, rather than establishing cycle-exact VIC-II output or physical-device behavior.

## Browser reconstruction

The shared model already removes this barrel, clears its collision and awards 150 points. The missing part was the C64 renderer: it observed `object-destroyed` only as a short flash at the impact location.

The renderer now creates one particle per original C64 block cell, using shifted sprite 2, the native velocity choices, 100-record limit and native retirement boundaries. Particle age follows simulation ticks, so pausing freezes motion. Reset, respawn, restart and screen changes clear old particles. A deterministic visual hash chooses directions; the original PRNG sequence, XOR compositing and color-buffer interaction are not reproduced exactly. The shared campaign and rocket collision rules remain adaptations.

Regression coverage: [unit destruction tests](../tests/unit/c64-destruction.test.ts) and the `--c64-only` [browser scenario](../tests/browser/c64.ts).
