# Original Atari ST code and model recovery

The input is the original protected `AUTO/GAME.PRG` from the canonical Atarimania STX documented in [atari-st.md](atari-st.md). Neither recovery tool reads the HDD adaptation. The canonical relocated text is52,426 bytes with SHA-256 `2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638`. The recovered ordinary TOS executable is54,806 bytes with SHA-256 `c7c03df04258f86ef00c9b1a35a0dda3127c1b682e12c94621479d9164eee6ba`; its header specifies52,426 text bytes, no data segment and289,272 BSS bytes, with2,289 relocations.

The CPU dependency is offline `machine68k==0.5.2`, installed in an external Python environment. Recover the original source files first, then execute:

```sh
node tools/recovery/atari-st.mjs /path/to/Exolon.stx /path/to/source-files
python tools/recovery/atari-st-code.py /path/to/Exolon.stx /path/to/source-files /path/to/recovered --probes
node tools/recovery/atari-st-model.mjs /path/to/recovered/original-main.bin /path/to/atari-st-constants.ts
```

The Python CLI verifies the original disk hash, reconstructs its44 FAT12 files and compares every supplied source file to those original bytes. It checks input files again after recovery. Its output directory must be separate from the source inventory and input disk. The Node CLI uses exclusive creation for its optional constants output. Ordinary builds require none of these inputs or Python dependencies.

## Protection boundary

The protector executes758,502 original instructions. Its trace handler temporarily decodes four bytes using `swap(not(previous ciphertext long))`, then restores the ciphertext after each instruction. Separate user/supervisor stack banks and the five original address-error word-sum dispatches are modeled explicitly. The host supplies TOS basepage/stack pointers, BIOS interrupt-disable responses and floppy sector bytes from the original STX. Synthetic successful sector timings100/105 satisfy the physical timing check; those timing values do not enter the sector-derived decryption key. Original track0 sector6 begins `Rob Northen Comp` and produces checksum `$de534692`.

[atari-st-recovery.json](atari-st-recovery.json) records these boundaries and both output hashes. No gameplay instruction is patched. `original-main.bin` contains relocated text whose RAM base is `$10000`; subtract that base when locating an absolute RAM address within the file. `original-main.prg` undoes the inner TOS relocation entries and retains the original relocation table. `original-ram.bin` is the one-megabyte post-recovery RAM fixture.

## Independent tables

`readAtariStModelTables` accepts only the verified original relocated text size/hash. Every read is bounded within that text, and trajectories require a terminator within1,024 pairs. The extractor reads ST jumps, grenade movement, pod particles, all125 screen metadata records, five flyer trajectories, turret metadata, stage ends and roulette rewards. Flyer graphics addresses become IDs1..4; trajectory keys retain their ST source addresses.

[atari-st-model-golden.json](atari-st-model-golden.json) records the complete model's `JSON.stringify` hash and representative arrays/counts. [atari-st-model-comparison.json](atari-st-model-comparison.json) records independent byte comparisons against Amiga: all13 numeric tables and125 metadata rows match, and all five paths match after address normalization. The12 rocket-trail graphics pointers also match after their atlas-address delta. These comparisons support sharing handwritten rules; each platform injects its independently extracted data.

ST source random calls use TOS XBIOS `Random`. The browser's seeded RNG is a deliberate deterministic approximation, not a claim of original random-sequence equivalence.

## Executed behavior

With `--probes`, the Python CLI reproduces the committed behavior, timing and ending JSON fixtures from unchanged original gameplay instructions. [atari-st-behavior.json](atari-st-behavior.json) executes the piston collision branch at RAM `$140ac..$14136`, counting calls to death `$13a22`. At hero `(100,176)` and piston column6, heights8..48 kill an unarmored hero; height0 does not. Armor prevents all seven cases. The external comparison's harmless-ST-piston observation does not hold for this original source. Source drawing uses `Y175-height`, while collision uses `184-height..184`, matching the Amiga offset.

The hunter source counter reaches299 without spawning, initializes at X320 on update300 and moves to315 on update301. Stage ends are24/49/74/99/124. [atari-st-ending.json](atari-st-ending.json) executes index124 atX190 with fire held, recording bravery/lives summary, congratulations, roulette and the subsequent first-stage load. It returns to index0 with ammo99, grenades9, armor0 andY176; the probe's nine lives remain nine.

## Timing and its limits

The original loop executes one update at relative `$6d8..$774`, then waits in relative `$6e98` for absolute `$466` to change. This is the TOS `_frclock` processed-VBL counter. The200 Hz `_hz_200` variable is at `$4ba`, a different address. Both the [EmuTOS fixed-address map](https://github.com/emutos/emutos/blob/master/tosvars.ld) and [TOS system-variable documentation](https://freemint.github.io/tos.hyp/en/bios_sysvars.html) confirm these addresses.

[atari-st-timing.json](atari-st-timing.json) measures348,794/346,596/346,596/346,596/352,766core cycles for five original first-screen updates, including native raster drawing and buffer flipping between updates. These exceed two PAL frame budgets at approximately8MHz, supporting a three-frame `50/3 Hz` stable browser baseline. Music replay remains50 Hz. This is an inferred baseline, not cycle-exact hardware timing or a universal frame rate for every scene: video bus contention, IRQ costs, OS call overhead and waits are excluded, and the deterministic probe supplies zero for TOS Random.
