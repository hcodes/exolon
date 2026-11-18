# Commodore 64 movement timing

The source and numeric evidence are archived in [motion-c64.json](motion-c64.json). The portable offline probe is [tools/recovery/timing/c64.mjs](../tools/recovery/timing/c64.mjs). No original game RAM or external CPU implementation is distributed with the probe. Its inputs must match the existing recovery tool's SHA-256 checks.

## Source behavior

The PAL VIC-II generates approximately 50.12454 video frames per second (985248 CPU clock cycles/s, 63 cycles/line, 312 lines/frame). Exolon's gameplay update rate is separate from that raster rate. Christian Bauer's [VIC-II study](https://www.cebix.net/VIC-Article.txt), sections 2.2, 3.4–3.6, 3.8 and 3.12, documents the clock, bad-line bus theft, sprite DMA and IRQ behavior.

The original main loop runs at `$13c4..$1489`, updating the player once through `$1aec`. It does software drawing, pads the draw count to 22 at `$14b2`, and publishes the new sprite buffer at `$5365`. That publication does not wait for a raster flag. IRQ `$5385` runs at raster 246 after its first raster 199 call, copies published state, and calls sound at `$53c6`. It does not call the player update. There is no fixed two-video-frame gameplay divider. The two-raster wait at `$08cd` belongs to the menu.

Horizontal coordinate `$20` increments by one at `$1c96`; `ASL` at `$1bc9` converts this to two physical pixels. The physical sprite coordinate adds 55 pixels for the game's screen offset. Thus original movement can be compared directly with the shared model's two-pixel steps in its 256-wide playfield; scaling the entire 320-wide C64 display to 256 would be an incorrect coordinate conversion here.

Walking uses source animation frames 0–9, advancing one per successful horizontal update. The jump table at `$1c27..$1c3c`, read backwards, is exactly the shared model's `JUMP` sequence:

```
-4,-4,-2,-2,-2,-1,-1,-1,-1,0,0,0,0,1,1,1,1,2,2,2,4,4
```

It has 22 logical updates and an 18-pixel rise, first reaching the apex after nine updates. This evidence supports retaining the existing jump table.

## Modeled measurements

The first 28 unobstructed rightward updates on screen 0 move native x16→44 at y112, or 56 physical pixels. The custom probe models original code, corrected 6502 instruction timing and raster IRQs:

| VIC allowance | PAL wall cycles/update | Milliseconds/update | Updates/s | Physical pixels/s |
| --- | ---: | ---: | ---: | ---: |
| No DMA, unrealistically fast control | 42213.75 | 42.8458 | 23.3395 | 46.6790 |
| 40-cycle bad lines and two-cycle sprite fetches | 45410.29 | 46.0902 | 21.6966 | 43.3932 |
| Above plus all three BA warning cycles | 46068.46 | 46.7582 | 21.3866 | 42.7732 |

The first full jump in the DMA model lands after 991.936 ms and first reaches its apex at 394.951 ms from the sampled loop start. Later samples include collisions/respawn and vary with game workload; they are not used to measure unobstructed walking.

The reconstruction uses **47ms per logical update** as a practical rounded baseline from the 46.758 ms BA case, keeping its two-pixel movement step. This is a C64-informed presentation adaptation. Native C64 cadence depends on scene workload; a fixed shared clock cannot reproduce that variation. Split must retain one shared simulation timeline.

## Reproduction and limits

First reproduce the checked RAM using the existing recovery helper and separately obtained inputs documented in [C64 asset provenance](../originals/graphics/c64/c64-graphics-provenance.json):

```sh
node tools/recovery/c64.mjs '/path/to/Exolon_(HS).prg' /path/to/jssid.mos6510.js /tmp/ram-game.bin
node tools/recovery/timing/c64.mjs /tmp/ram-game.bin /path/to/jssid.mos6510.js right none 120 > /tmp/c64-right-none.json
node tools/recovery/timing/c64.mjs /tmp/ram-game.bin /path/to/jssid.mos6510.js right dma 120 > /tmp/c64-right-dma.json
node tools/recovery/timing/c64.mjs /tmp/ram-game.bin /path/to/jssid.mos6510.js right ba 120 > /tmp/c64-right-ba.json
node tools/recovery/timing/c64.mjs /tmp/ram-game.bin /path/to/jssid.mos6510.js jump dma 120 > /tmp/c64-jump-dma.json
```

The recovery helper creates its output exclusively; retain an existing verified RAM file rather than overwriting it. The probe outputs bounded JSON (29–120 loop samples, 12 million instruction maximum) and does not write files itself. `right` injects the original keyboard matrix's P key; `jump` holds Space, so the jump repeats; `idle` releases input. `first28Updates` and `first22Updates` summarize the sampled loop intervals; `loops` and `playerUpdates` preserve numeric observations.

The separately supplied jsSID CPU is an audio helper under GPL-2.0. It treats RTI as RTS and undercounts indexed stores. The probe implements genuine RTI and separately accounts for standard NMOS 6502 instruction cycles, including taken branches and page crossings. Its remaining arithmetic execution is inherited and is not a validated full-machine implementation, particularly decimal arithmetic.

VIC DMA is an allowance model: registers are sampled each line, writes occur at instruction boundaries, sprite DMA state/latching is approximated, and CIA/ROM hardware and video collisions are not fully emulated. The BA scenario includes all three warning cycles; real RDY only stops reads and lets writes finish. Therefore these scenarios illustrate bus-stealing cost, rather than proving formal bounds on total emulation error. The measurements support approximately 21–23 updates/s, not an exact native rate of 21.6966 Hz. Cycle-exact VICE or hardware capture would provide stronger validation. The same archived High Society PRG used for existing graphics/audio is measured; pristine publisher cassette equivalence is not established.
