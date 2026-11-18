# Original infinite-lives codes

Checked against recovered original bytes on 22.11.2026. Runtime recognition is rewritten TypeScript; no CPU executes in the browser.

| Platform | Original context and evidence | Confirmation |
| --- | --- | --- |
| ZX Spectrum | `menu_redefine_key.asm`, `$7041` compares the five Define Keys characters against `ZORBA`; `cheatLife` is XORed with `$3d`. | Enabling calls `playBeeperMusic` at `$7d17`, with `musicGameOver` at `$7d68`. Disabling skips the call. |
| Amstrad CPC | Verified RAM SHA-256 `496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec`: `$032c..035b` compares `$041e` against `ZORBA` at `$0423`, toggles `$2a25` with `$3d`. | On enable calls `$65c6`, advances `$63af` forty times with the original `$3e54` delay, then mutes at `$5a7c`. This is the same sequence used by the existing CPC Game Over recording. |
| Sharp MZ-800, Datelsoft | Canonical unpacked RAM SHA-256 `108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f`: `$7039..7058` compares `$708b` against `ZORBA` at `$7090`, toggles `$9d1d` with `$3d`. | The inherited `$7d17/$7d68` call is retained, but the beeper writes at `$8032/$804b/$8057` are `OUT (0),A`, not Spectrum port `$fe` or Sharp SN76489 port `$f2`. Its initial SN writes mute all four channels. No audible confirmation is claimed or substituted. |
| Amiga PAL | Recovered initial RAM SHA-256 `8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7`: `$8a32..8a4a` compares the first eight entered name bytes at `$fdf7` against lowercase `ad astra` at `$fe02`, then clears `$fbde`. | No sound call in the activation branch. |
| Atari ST | Recovered native code `$0a58..0a74` compares the first eight entered name bytes at `$18d8f` against lowercase `ad astra` at `$18d99`, then clears `$18b20`; `$3a50` tests that flag before decrementing lives. | No sound call in the activation branch. |

The Spectrum disassembly is Raffaele Cecco's original code, disassembled by Sergey Erokhin (2014), [CC BY-SA3.0](https://creativecommons.org/licenses/by-sa/3.0/), [source](https://github.com/rusarh/exolon-esl/blob/main/asm/menu_redefine_key.asm), [beeper driver and score](https://github.com/rusarh/exolon-esl/blob/main/asm/sound_beeper_music.asm). Existing platform provenance and historical hashes remain unchanged.

## Browser adaptation

Completed ZORBA definitions toggle the existing infinite-lives option on ZX, CPC and Sharp only. The final key must be released. Cancelled input, `ZOBRA`, C64 and invented Game Boy modes do not activate it. Defining another set of keys preserves the cheat. Split follows its effective left platform, including confirmation sound even when music belongs to the right platform.

Native confirmation accepts the original lowercase eight-character prefix when saving a qualifying name. The hidden native input retains raw case for recognition; displayed and stored Amiga names remain uppercase, while Atari retains printable ASCII case. The activation entry is excluded from rankings, as a browser adaptation consistent with existing cheat score protection. Infinite lives enables for subsequent runs and remains adjustable in CHEAT MODE. No additional high-score input page is introduced.

All five versions use the existing accessible notification controller (`Infinite lives enabled`, and `Infinite lives disabled` for the three toggling codes). Existing cheat settings and keys are preserved. Audio respects volume/mute and unavailable Web Audio; failed or cancelled loads do not block activation or play after disposal/graphics changes. The audible ZX capture and existing CPC recording are played once on enable. No invented signal is added for Sharp or the native68000 games.

## Shared ZX Game Over melody

The verified ZX 128K memory uses the same beeper score for Game Over and ZORBA. At `$7052`, ZORBA executes `21 68 7d cc 17 7d` (`LD HL,$7d68; CALL Z,$7d17`). At `$a030`, the Game Over handler executes `21 68 7d cd 17 7d` (`LD HL,$7d68; CALL $7d17`). There is no AY/128K branch between the Game Over message and this call. The 128K title uses AY music separately.

Executing the unchanged call paths offline with released keys produces 76,852 captured level transitions, including the final zero, in both cases. ZORBA `$704a..$7058` takes 7,748,220 nominal T-states; Game Over `$a030..$a036` takes 7,748,187. After subtracting the first transition's timestamp, both traces match the preserved beeper trace byte-for-byte as JSON, SHA-256 `af58fd56c08ae7cd72b4ae6c3430552396d2cdc637a6dd377996cd6d9dcb896f`. The memory/core hashes and synthesis limits below apply unchanged.

The browser now shares `src/audio/zx-spectrum/cheat-enabled.wav` between ZORBA and the ZX Game Over event. The recording loads on demand, uses the existing versioned URL/cache and respects stop, graphics changes, mute and disposal. No historical capture or active audio bytes are changed. Check with `npm run check:browser -- --zx-game-over-only`: real life depletion on an isolated pit screen must play one audible original jingle in modern and legacy builds across Chromium, Firefox and WebKit.

## ZX sound reproduction

`tools/audio/cheat-confirmation.mjs` verifies the original TAP memory SHA-256 `2ee3509dc114d70a2bd2d7e22ada889d93088091964380e4b2583341e41617b5` and the external MIT Z80.js SHA-256 `78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b`. It calls the unmodified beeper program offline with all keys released and records port `$fe` bit4 transitions. A stack/return sentinel outside the source routines ends capture; no sound instructions or note tables are patched. The routine takes 7,748,160 nominal Z80 T-states. The 3.5MHz clock and lack of ULA contention make timing approximate, not a physical-device recording.

The new trace is preserved separately at `originals/audio/zx-spectrum/cheat-enabled.trace.json`; active mono PCM16 at44.1kHz is `src/audio/zx-spectrum/cheat-enabled.wav`. Rendering integrates transitions over each output sample, applies20Hz AC coupling and appends120ms of silence/decay. Existing audio and historical captures are not rewritten.

```sh
npm run audio:cheat-confirmation -- --memory /path/to/canonical-memory.bin --z80 /path/to/Z80.js --output /tmp/zx-cheat-capture
npm run audio:cheat-confirmation -- --trace originals/audio/zx-spectrum/cheat-enabled.trace.json --output /tmp/zx-cheat-reproduced
```

The tool always requires an explicit output directory. Regular builds only copy the saved WAV. No external core is redistributed or loaded at runtime.

Checks: `node --experimental-strip-types --test tests/unit/control-menu.test.ts tests/unit/original-cheats.test.ts tests/unit/audio.test.ts`, `npm run check:browser -- --original-cheats-only`, `--control-menu-only`, `--legacy-only`, `--amiga-only`, `--atari-st-only`, `npm test`, `npm run build`. Browser engines do not establish physical-computer behavior.
