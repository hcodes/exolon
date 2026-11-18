# ZX Spectrum cheat confirmation

This original beeper melody also plays on ZX Game Over. Both original call sites select the same score at `$7d68`; the browser shares this unchanged recording. See [call-site verification](../../../research/original-cheats.md#shared-zx-game-over-melody).

New offline trace of the original Exolon beeper melody, preserved independently from previous audio captures. See [source evidence and reproduction](../../../research/original-cheats.md).

Original game: Raffaele Cecco / Nick Jones, Hewson,1987. Original game data and recordings remain the property of their rightsholders. Disassembly attribution: Sergey Erokhin,2014, CC BY-SA3.0, https://github.com/rusarh/exolon-esl/.

The runtime recording is `src/audio/zx-spectrum/cheat-enabled.wav`, SHA-256 `1a02015584c6001260bb81c1f377196054a542abdc950fe564040d822cccb42b`,205882bytes, mono44100Hz PCM16. Trace capture is 7748160 nominal T-states at3.5MHz; it contains original port-bit transitions, not a JS game-renderer golden. Timing excludes physical ULA contention.
