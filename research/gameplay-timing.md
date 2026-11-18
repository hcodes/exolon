# Gameplay cadence: ZX Spectrum, CPC, C64 and Sharp

21.11.2026. The shared reconstruction previously advanced every 33.333 ms (30 updates/s) without an original-machine timing measurement. With an unchanged two-pixel walking step that produced 60 pixels/s and a 22-step jump lasting 0.733s. The reported excessive speed was reproduced, and new tests failed against that build before the correction.

## Original-code measurements

All values below come from offline execution of recovered game code, not from counting animation frames in a video. One logical game-loop traversal moves the astronaut one native X unit, corresponding to two pixels in the shared game field. Original walking has ten poses, and all four use the same22-value vertical jump table. PAL video refresh does not equal the logical gameplay rate: the measured loops depend on drawing work.

| Platform | First-screen unobstructed walking | Browser baseline | Browser walking speed |
| --- | --- | --- | --- |
| ZX Spectrum 128K | ~46.50 ms, modeled ULA contention |47 ms (~21.28 updates/s) |42.55 px/s |
| ZX Spectrum 48K | ~47.16 ms, modeled ULA contention |same47 ms baseline |same |
| Amstrad CPC | ~51.98 ms, original opcode stretching |52 ms (~19.23 updates/s) |38.46 px/s |
| Commodore 64 PAL | ~46.09–46.76 ms in VIC DMA/BA models |47 ms (~21.28 updates/s) |42.55 px/s |
| Sharp MZ-800 Datelsoft | ~44.58 ms, no additional GDG WAIT |45 ms (~22.22 updates/s) |44.44 px/s |

These are rounded fixed baselines, not claims of a universal original frame rate. Standing, crouching, shooting, jumping, enemies and different scenes change CPU workload. The browser retains its handwritten model and fixed per-platform clock; it does not execute original CPU/ROM code or simulate every original slowdown.

## Evidence and reproducibility

- **ZX:** [motion-zx.json](motion-zx.json). The canonical64 KiB game memory SHA-256 is `2ee3509dc114d70a2bd2d7e22ada889d93088091964380e4b2583341e41617b5`. It was reproduced from the unpatched loading snapshot in [ESL's source archive](https://github.com/rusarh/exolon-esl): original `tools/bin/exolon.sna`, SHA-256`c28cec07baa83143fd4265b7adb37873c834b81c56abeb69ab25c211481be65f`; copy its loaded0x92a0-byte payload at6590h to6D60h in otherwise zeroed RAM. The resulting hash exactly matches existing TAP recovery. Original main loop75BEh calls player81A4h once, then the source 500-byte LDIR delay and sprite compensation; no game-loop HALT was inserted. Independent cycle-stepped C and JS cores agree on 150261.55 uncontended T-states. ULA contention and 16 initial raster phases produce the measured rounded baseline. [Floooh's original CPU core](https://github.com/floooh/chips/blob/master/chips/z80.h) and [Fuse source](https://sourceforge.net/p/fuse-emulator/fuse/ci/master/tree/) provide the offline bus/ULA reference. Retained internal bus-address behavior is modeled rather than exhaustively hardware-verified.
- **CPC:** [motion-cpc.json](motion-cpc.json). Source RAM SHA-256`496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec` is independently verified against the commercial release in graphics provenance. Probe runs startup and the complete06C3h–0788h loop, including the original keyboard scan; only the resulting input flags are supplied by the host. Opcode timing follows [hardware-tested CPC timing tables](https://64nops.wordpress.com/2021/01/13/perfectly-accurate-z80-flags-and-cpc-timing/), including PUSH, LDI and I/O stretching rather than merely rounding total Z80 cycles. All 24 opening walking loops are preserved. Interrupts remain disabled; no HALT or F5 VSYNC poll appeared.
- **C64:** [motion-c64.json](motion-c64.json), [detailed evidence](motion-c64.md). Original loop13C4h–1489h performs one player update; the raster IRQ runs rendering/audio independently. The offline CPU helper requires explicit RTI and indexed-cycle corrections. VIC bus-stealing estimates use [Christian Bauer's primary VIC-II study](https://www.cebix.net/VIC-Article.txt). These are custom model scenarios, not a cycle-exact VICE or physical-machine capture. The archived High Society PRG is the same source used for the existing graphics/audio; pristine publisher-tape equivalence remains unverified. The extracted22-step jump table equals the shared ZX table; no separate jump-mechanics difference is claimed.
- **Sharp:** [motion-sharp.json](motion-sharp.json). Original recovered RAM SHA-256`108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f`. Probe executes the original75BEh loop, native keyboard ports and VRAM banking. [Sharp's service manual](https://www.idealine.info/sharpmz/mz-800/download/sm800.pdf) documents17.7344 MHz/5 CPU clock and buffered GDG writes. Native walk 158130.75 T averages44.583 ms; the model excludes additional GDG WAIT. The 20 clean walking loops are isolated from later collisions and respawn.

The decoded source bytes, step geometry and jump sequence remain unchanged. Full maps, collision rules and effects are not redefined by timing selection. Existing source music recordings remain unchanged and keep their own replay clocks.

## Runtime policy

`getSimulationInterval` in `src/constants/game.ts` supplies each original platform's baseline. Remastered, Game Boy and Game Boy Color retain their previous 30 Hz presentation cadence. Amiga and Atari ST keep their separate clocks.

Split renders one shared state. Its **left displayed platform** selects the gameplay cadence; changing the right side changes presentation/audio without changing the clock. Optional-asset fallback follows the actually displayed platform. No second simulation is introduced. Mode changes preserve the partially completed tick, re-anchor wall-clock time and retain pause state. Reapplying an unchanged cadence cannot drop elapsed time.

Tests exercise real model walking at 50/60/120/144/240 Hz display rates, clock phase/pause changes, and native/legacy browser controls. The browser test holds real FIRE and checks the original fifteenth-tick rocket launch, then changes active, Split and paused modes. Expectations use independent literal baselines, so the former30 Hz build fails. Run `npm run check:browser -- --motion-timing-only`.

## Offline probes

No CPU helper or original executable is loaded by the game. Inputs below are separately obtained and hash-checked. A C compiler is needed only for the ZX research probe.

```sh
clang -std=c11 -O2 tools/recovery/timing/zx.c -o /tmp/zx-timing
/tmp/zx-timing --memory /path/to/zx-memory.bin --core tools/recovery/timing/third-party/z80.h --mode walk --variant 128 --contention ula --phase 0
node tools/recovery/timing/cpc.mjs --memory /path/to/cpc-ram.bin --z80 /path/to/Z80.js --output /tmp/cpc-timing.json
node tools/recovery/timing/c64.mjs /path/to/c64-ram.bin /path/to/jssid.mos6510.js right ba 120 > /tmp/c64-timing.json
node tools/recovery/timing/sharp.mjs --memory /path/to/sharp-ram.bin --z80 /path/to/Z80.js --mode walk > /tmp/sharp-timing.json
```

Source recovery commands and third-party CPU provenance are documented by the corresponding existing recovery tools. The probes bound execution and reject unknown source/core revisions. Original asset attribution, the ZX disassembly's CC BY-SA3.0 terms, and third-party CPU licenses remain applicable. Browser checks do not constitute tests on physical vintage computers.


## Verification21.11.2026

- `npm test`:420/420 passed, including TypeScript, ESLint and formatting.
- `npm run build`: passed; normal and ES5 bundles rebuilt without CPU-research dependencies.
- `--motion-timing-only`: Chromium, Firefox and WebKit passed for native and legacy, including live/paused cadence changes and Split.
- `--gamepad-only`: all three engines passed gameplay, firing, reconnection and connection notices.
- Independent final code review: no important finding.
- Broader `--legacy-only` failed in Chromium on an existing portrait layout assertion: at320×568 the touch panel bottom is571px (expected≤569). A separately rebuilt pre-fix30Hz legacy bundle reproduced exactly the same geometry; legacy CSS was byte-identical. This is an unrelated layout defect, not a speed regression. The test was not weakened and the layout was not changed in this task.
