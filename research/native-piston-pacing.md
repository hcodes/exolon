# Native piston activation and scene pacing — 22.11.2026

The first piston is on screen 4 (index 3), column 17 / X272, in both native games. Its apparent speed combines the original per-update state machine with the duration of each gameplay update.

## Original activation

Amiga `$a3a6` and Atari ST `$1324c` draw the old height before updating. An idle piston samples one random byte and arms for values 0 through 6. Arming leaves height zero; six subsequent updates raise it by eight pixels to 48, then six updates retract it to zero. The next update can sample again. There is no independent cooldown; the shortest possible interval between activations is 13 gameplay updates.

The Amiga procedure calls `$bae4` / `$ef4a` / `$ef06`, reduces the original two-longword recurrence modulo 65535 and masks the result with 255. Existing Amiga behavior already matches independent original-instruction traces for zero/default seeds and one/two pistons.

Atari ST `$14942` calls TOS XBIOS Random and masks its result at `$14952`. It must not use the Amiga recurrence. Original TOS 1.02 `$fc1510` advances its initialized 32-bit seed by `seed * $bb40e62d + 1` modulo 2^32, returns the upper 24 bits, and the game takes their low byte. Original CPU execution verified the byte vectors in `tests/unit/atari-st-random.test.ts`, including unsigned overflow. The browser still uses an explicit deterministic seed; original initialization from the 200 Hz hardware timer is outside this model.

Source: [original TOS 1.02 listing](https://github.com/th-otto/tos1x/blob/7c6680d96642220710bddca825817d29ba86cdab/listings/tos102de.s#L1458-L1476).

## Scene workload and pacing

The original games wait for a display refresh after executing their gameplay and drawing work. The existing fixed 60 ms browser baseline came from the first scene and was too short for some later scenes.

[Independent scene samples](native-scene-pacing.json) execute the recovered original main loops, stage loaders and scene setup for all 125 screens on each platform. Amiga records 16 consecutive updates per screen; Atari ST records eight. Each scene starts with a neutral controller, the same initialized seed and the original invulnerability gate enabled. The Atari OS Random hook follows the verified TOS recurrence.

The saved CPU clocks are 7,093,790 Hz for Amiga and 8,010,612 Hz for Atari ST, with nominal PAL refresh at 50 Hz. For each screen, the browser selects the smallest whole number of refresh periods that can contain the minimum sampled CPU work, retaining a floor of three refresh periods. This is a conservative scene-dependent baseline:

- Amiga: 73 screens at 60 ms, 52 at 80 ms. Screen 4 requires 80 ms: even its minimum sampled work, 444,488 cycles, exceeds three PAL periods.
- Atari ST: 106 screens at 60 ms, 19 at 80 ms. Screen 4 initially fits 60 ms and keeps that baseline; copying the Amiga slowdown would be incorrect.

The full first-piston Amiga probe ran 600 updates and required at least four PAL periods throughout. Atari ST's first 300 updates fit three periods; after the hunter starts moving at update 301, some updates need four. The browser banks approximate the initial scene workload; they do not reproduce this later dynamic variation.

Pacing updates on native screen changes and direct/cheat selection. The existing clock preserves fractional progress and pause state; music, title animation and score scrolling retain their separate timing.

## Reproduction and limits

With the existing temporary `machine68k` 0.5.2 environment and verified original inputs:

```sh
python tools/recovery/native-scene-timing.py amiga --disk /path/to/Disk.1 --ram /path/to/recovered-ram.bin --steps 16
python tools/recovery/native-scene-timing.py atari-st --main research/atari-st-original-main.bin --source-files /path/to/source-files --steps 8
npm run check:browser -- --native-pacing-only
```

These probes measure core CPU cycles. DMA contention, interrupts, audio/OS-call costs, refresh waiting and later actor/player workloads are excluded. The saved intervals are lower-bound scene baselines, not hardware-exact schedules or physical-device measurements. Regular builds and browser gameplay read only the saved pacing banks; disks, TOS instructions and CPU emulation remain offline.
