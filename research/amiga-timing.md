# Amiga gameplay timing correction — 20.11.2026

The earlier 50Hz gameplay assumption was incorrect. The PAL display produces approximately 50 vertical blanks per second; original `$869c..$873a` runs a complete software-rendered game update, then `$873e → $e034` clears `$e064` and waits for the **next** VBL. Any VBLs passed during CPU work do not count as game updates.

## Reproducible source execution

`tools/recovery/amiga-timing.py` executes the verified original disk code with the M68000 core from **machine68k 0.5.2**. This is an optional offline research dependency, installed in a temporary environment, with no browser or npm dependency. It verifies the disk and recovered-RAM SHA-256 recorded in [amiga.md](amiga.md). Original disk transfers are copied from the verified disk; original graphics expansion, new-game setup and first-screen object setup execute before collecting twenty neutral-input updates.

The probe replaces disk service, CIA/music setup, title presentation, interrupt installation and VBL waits with RTS; the exact addresses are included in [the recorded result](amiga-timing.json). It reports CPU core cycles, **excluding** chipset DMA contention, interrupts, music overhead and time spent waiting for VBL. It is a lower-bound probe, not an Amiga hardware emulator or a physical-device capture.

```sh
node --experimental-strip-types tools/recovery/amiga.mjs /path/to/Disk.1 /tmp/amiga-ram.bin
python3 -m venv /tmp/amiga-timing-venv
/tmp/amiga-timing-venv/bin/pip install machine68k==0.5.2
/tmp/amiga-timing-venv/bin/python tools/recovery/amiga-timing.py /path/to/Disk.1 /tmp/amiga-ram.bin
```

## Findings and browser adaptation

The CPU assumption comes from the original Commodore [A500/A2000 Technical Reference Manual](https://amiga.net.au/files/Tech_Amiga/Commodore_A500-A2000_Technical_Reference_Manual.pdf), printed page 45: PAL 7M is 7.09379MHz. The frame budgets below use nominal PAL 50Hz.

- The native 32,000-byte background copy `$c6d4..$c766` alone costs **163,196 CPU cycles**, about 23ms at 7.09MHz. Therefore 50 complete gameplay updates/second are already impossible on that baseline CPU.
- Twenty first-screen updates take **339,194–351,128 cycles**, mean **344,622**, before VBL waiting. This is approximately 48–50ms of CPU work, more than two 20ms PAL budgets. Waiting for the next VBL gives a baseline of three PAL periods: **60ms, approximately 16.67 updates/second**. This last step is an inference under an ideal CPU-only PAL schedule, not a measured physical-device frame rate.
- Other scenes and active objects can cost more. The browser uses a stable three-period baseline; it does not yet reproduce variable CPU/DMA slowdowns. No universal exact frame rate for every original scene is claimed.
- RAF may render at 60/120/144/240Hz, but model steps use a fixed 60ms accumulator. Movement remains the native three pixels per step. Music uses its independent CIA-derived recording, and title idle timing retains PAL time.

The regression test failed against the old implementation with **150 instead of 50 steps in three seconds**. It now verifies fifty updates and 150 pixels of unobstructed walking over that interval for 50/60/120/144/240Hz displays. Browser checks also measure the controller's actual model ticks against elapsed wall time.

## Scene-dependent follow-up — 22.11.2026

The first-screen measurements above remain unchanged. A new [125-scene original-code survey](native-piston-pacing.md) supplies separate 60/80ms lower-bound baselines: the first piston scene needs at least four PAL periods. The browser now selects the baseline for the current scene while retaining the original movement and piston state changes per update. Dynamic CPU/DMA variation remains outside this adaptation.
