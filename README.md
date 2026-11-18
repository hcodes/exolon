# [Exolon](https://hcodes.github.io/exolon/)

Exolon in TypeScript and Preact, using Canvas 2D and Web Audio: five worlds, 125 screens.

[Play games](https://hcodes.github.io/exolon/)

## Ported platforms and modes

- 🌈 ZX Spectrum
- 💾 Commodore 64
- 🖥️ Amstrad CPC
- ⌨️ Sharp MZ-800
- 🔴 Amiga
- 🕹️ Atari ST
- 🎮 Game Boy
- 🎨 Game Boy Color
- ✨ Remastered
- 🌓 Split — side-by-side graphics modes
- 🥽 Exolon VR — a separate Three.js/WebXR diorama in the Remastered style

## Running and building

Requires Node.js 22.12 or later and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:8091. The dev command first builds unminified bundles, then serves **dist/**. Use `npm run build` for a production build with minified JavaScript or `npm run build -- --dev` for a development build. To deploy, copy the contents of `dist/` to a static HTTP server. Source files in `src/` are not served directly: Rolldown compiles TypeScript/TSX and bundles Preact. The build also copies platform PNGs and creates a compatible ES5 version. It clears only `dist/` and leaves `src/` unchanged.

The Home button stays at the top-left screen edge on every platform and in both orientations. It opens a compact popup below the button, without a heading or close controls. Navigation actions stay in one horizontal row, scrolling on narrow screens; Platforms comes first and returns to the initial launch screen. Start game, Controls, Scores, Pause/Resume, Restart and Menu appear as applicable. Press Home again, click outside or press Escape/Back to close the popup. Settings contains graphics, audio, CHEAT MODE, display and VR view options. Opening either popup pauses an active game; closing it resumes only the game it paused, unless focus, visibility, tracking or controller loss revoked resumption. Home and Settings never open together. Check with `npm run check:browser -- --home-only` and `npm run check:browser -- --settings-panel-only`.

JavaScript errors and unhandled promise rejections are captured before application startup and sent to the existing Yandex Metrika counter as `JS errors → message → stack` visit parameters. Add `?debug=1` (or `&debug=1` after other parameters) to display the bundled [show-js-error](https://github.com/hcodes/show-js-error) panel, copy error details or open a prefilled GitHub issue. Known webOS and extension errors are ignored. Diagnostics use ES5, extracted dark-theme CSS and local assets in both builds. Verify with `npm run check:browser -- --analytics-only`.

## Supported browsers and operating systems

The following are compatibility targets. Browser versions follow [`.browserslistrc`](.browserslistrc); the operating system must be able to run a supported browser.

| Operating system / device                                               | Browser target                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Windows, macOS, Linux                                                   | Chrome / Chromium 68+; the latest two Firefox and Edge versions                                  |
| macOS                                                                   | Safari 9+                                                                                        |
| iOS 9.3.5+ and iPadOS                                                   | Safari, including iPod touch 5th generation running iOS 9.3.5                                    |
| Android                                                                 | Chrome / Chromium 68+                                                                            |
| Xbox One, Xbox Series X\|S                                              | Built-in [Microsoft Edge](https://news.xbox.com/en-us/2021/09/23/september-2021-xbox-update/)    |
| PlayStation 4 (PS4)                                                     | Built-in [Internet Browser](https://manuals.playstation.net/document/en/ps4/browser/browse.html) |
| Smart TV: LG webOS, Samsung Tizen, Android / Google TV, Hisense / VIDAA | Built-in TV browsers; Chromium 68 (LG webOS 5, 2020) is the Chromium compatibility floor         |
| Meta Quest 3S (Quest OS), Exolon VR                                     | Meta Quest Browser with WebGL 2 and immersive WebXR over HTTPS                                   |

Older browsers automatically receive the compatible ES5 build. The non-VR games retain touch and keyboard controls, with fallbacks when audio, storage, gamepads or native Fullscreen are unavailable. Exolon VR requires a modern browser; its banner remains disabled until WebGL 2 and immersive VR support are confirmed.

Run `npm run check:browser -- --webos-only` to check webOS 3 automatic fallback with missing native Symbols, visible rendering and startup of all seven non-VR platforms, with and without touch capabilities.

Automated browser checks cover Chromium, Firefox and WebKit, including the compatible build and mobile/TV layouts. These checks do not establish testing on historical Safari, physical phones, iPods, Xbox or PS4 consoles, TVs or Quest headsets; performance on old devices and headset comfort remain unverified. See the [game guide](docs/game.md) for controls and compatibility details.
