# Exolon Atari ST audio

The browser plays offline-rendered YM2149 recordings. No 68000 interpreter, game executable or SNDH replay driver runs in the browser. All existing Amiga recordings remain separate and unchanged.

The source is [Exolon by Dave Rogers in the SNDH archive](https://sndh.atari.org/?ID=1558), SHA-256 `f7fedb6ff4835186dec8b8d8463173d5af6f7a3430bf20837aef8cb89ec15b38`. The supported recovered original executable has SHA-256 `2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638`. Executing its unchanged native driver offline produces exactly the same register bytes as the SNDH driver across 12000 main-music ticks and 600 Game Over ticks. See [original-verification.json](original-verification.json) and [provenance.json](provenance.json).

The original initializes native music selection 1 at text offset `$000006`. Game Over stops music at `$0008ce`, selects 7 at `$0008d2`, then restores selection 1 at `$0008f4` when the music flag is set. Main music therefore continues during gameplay as well as title and scores screens. Original effect calls go through `$0021b8`, which suppresses effects while the default music flag at RAM `$1253a` is set. The current implementation reproduces the two music selections; it does not substitute effects from another platform.

## Original timing

Original setup at text `$002196` calls XBIOS 31 with Timer A 0, control 7 and data 244. The MFP clock is 2.4576 MHz, so native replay frequency is `2457600 / 200 / 244 = 3072 / 61`, approximately 50.3606557377 Hz. This differs from the archive's nominal `TC50` metadata. Production WAVs are rendered at native timing with a fixed 2 MHz YM clock and playbackRate 1; tempo correction does not shift tone pitch.

The source for the timer interpretation is Atari's [XBIOS guide](https://bitsavers.computerhistory.org/pdf/atari/ST/Atari_ST_GEM_Programming_1986/GEM_0087.pdf), the [Motorola MC68901 register table](https://www.tautec-electronics.de/Datenblaetter/Schaltkreise/MC68901.pdf), and Atari's [engineering hardware specification](https://www.cpcwiki.eu/imgs/b/b1/Atari_ST_-_Hardware_Specification.pdf).

| Recording | Driver ticks | PCM samples at 44100 Hz | Buffer duration |
| --- | ---: | ---: | ---: |
| `title.wav` |10399 |9106234 |206.490566893424s |
| `game-over.wav` |158 |138359 |3.137392290249s |

The main theme has one initialization tick followed by a 10398-tick exact driver-state cycle. The 5199-tick musical phrase changes channel C's arpeggio parity, so a full cycle requires two phrases. The native loop starts at PCM sample 876 and ends at 9106234, or `876 / 44100` to `9106234 / 44100` seconds. PCM boundaries round upward to the next sample; exact state repetition does not guarantee identical YM oscillator/noise phase at the WAV seam.

Game Over is a finite recording. Original channels A/B stop during tick 152 and C during 156; emitted register volumes are all zero from tick 157. The original program restores main music after a busy loop: 589824 iterations cost 23592964 nominal 68000 cycles. The browser uses the nominal 8 MHz baseline of 2.9491205 seconds, guarded against stop, switching, disposal, mute and page hiding. Interrupt service and bus contention extend the hardware delay and are not simulated. Consequently the restoration baseline can interrupt the final part of the complete Game Over recording.

## Preserved recordings and reproduction

[archive/title-50hz.wav](archive/title-50hz.wav) and [archive/game-over-50hz.wav](archive/game-over-50hz.wav) preserve the earlier 50 Hz SNDH renderings byte-for-byte, at 207.98 s and 3.16 s respectively. They are archival assets; production playback uses the native-rate WAVs in this directory. The `.ym14` files are unchanged tick-domain register streams: fourteen bytes R0 through R13 per driver tick.

Reproduce all production and archived WAVs with:

```sh
/path/to/python tools/audio/atari-st.py /path/to/Exolon.sndh /path/to/recovered/original-main.bin [output-directory]
```

This offline tool requires machine68k 0.5.2 and a C compiler (`CC`, default `clang`). It validates both original hashes, compares native/SNDH register traces, checks the loop state, renders both timing variants, and rejects output differing from the recorded hashes before modifying the destination. Normal builds use the checked-in recordings and require neither original input nor emulator dependency.

Rendering uses Peter Sovietov's MIT-licensed [Ayumi](https://github.com/true-grue/ayumi) in YM mode, mono, 44100 Hz, one-third gain per channel, with its FIR and DC filter. [LICENSE-ayumi.txt](LICENSE-ayumi.txt) accompanies the sources. Tick-grouped PSG writes, a nominal 2 MHz YM clock and digital chip output are reproduced; intra-tick bus timing, analog ST circuitry and exact interrupt overhead are outside this recording model.
