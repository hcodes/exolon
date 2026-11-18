# reex / Exolon

These instructions apply repository-wide. This is a standalone TypeScript/Preact game using Canvas 2D, Web Audio and Rolldown, with a separate modern-only Three.js/WebXR diorama; the neighboring checkdevice repository is not required. Gameplay runs as rewritten JavaScript, without a CPU/ROM emulator.

## References and commands

- [README.md](README.md): setup, architecture, build output, browser checks and offline tools.
- [docs/game.md](docs/game.md): controls, modes and compatibility.
- [research/behavior.md](research/behavior.md): original rules, evidence and fidelity limits.
- [src/assets/README.md](src/assets/README.md): active resource layout.
- Platform evidence: [Amiga](research/amiga.md), [Atari ST](research/atari-st.md), [Sharp](research/sharp-mz800.md), [movement timing](research/gameplay-timing.md).

Use Node.js 22.12+ and npm; dependencies are pinned in `package-lock.json`. Check [package.json](package.json) before using or changing scripts. Explain new dependencies and their compatibility impact.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm run dev` | Build unminified bundles and serve dist at http://127.0.0.1:8091; no watching |
| `npm run build` | Clean production build; only production minifies JS |
| `npm run build -- --dev` | Refresh development bundles |
| `npm test` | Formatting, TypeScript, ESLint, Stylelint, Knip and unit tests |
| `npm run check:browser -- --<scenario>-only` | Targeted Playwright checks; scenarios are in `tests/browser/run.ts` |

## Code and ownership

- Keep TS modules in purpose-specific folders under `src/`; build entries belong in `src/entries/`. Game modules must not import entries. Follow the directory map in README; tools belong under `tools/{build,graphics,audio,recovery}/`, without an `exolon` prefix or `tools/exolon/`.
- The model must remain usable without DOM, network or storage. Controllers compose model, input, services and rendering. Keep imperative DOM adapters, subscriptions and mounting in `src/controllers/`; Canvas drawing and simulation stay separate from Preact updates.
- Put each component in its own matching PascalCase folder with `index.tsx`, one component per file. Import an adjacent `index.css` only when the component owns styles; never create empty/comment-only stylesheets.
- Reuse `Button`, `Modal`, `Select`, `Checkbox` and `Input`. Preserve native attributes/events; callers own labels and validation. Use `createModalControl` for modal focus, Escape/Tab and backdrop behavior.
- Use named, typed handlers for multi-step event, promise and timer logic, beside the state they use. Short selectors/adapters may remain inline.
- Follow strict TypeScript with erasable types and explicit type imports. Do not add `any`, `ts-nocheck` or unchecked JS wrappers. Normalize input at module boundaries.
- Follow Prettier, `.editorconfig` and `.prettierignore`; preserve generated/archival bytes and import/execution order. Keep the early `src/entries/boot.ts` compatible before polyfills, including its no-trailing-comma convention.

## CSS and class names

- BEM is required: `block`, `block__element`, `block_modifier`, `block__element_modifier`, using lowercase kebab-case and a single modifier underscore. Retain base classes with modifiers. Use owner-specific states, such as `bonus__item_active`; no generic `is-*`/`has-*` states or `exolon` prefix.
- Compose conditional/merged JSX classes with `classNames` imported from `classnames`, passing base classes, modifier maps and caller classes separately. Static strings may remain literals; imperative state updates use native `classList`.
- Give styled nodes explicit classes. No component tag/ID selectors or positional selectors for logical elements; native state qualifiers are allowed. Preserve IDs needed for accessibility and controller contracts. Global browser resets belong in `src/index.css`.
- Keep all variants, mobile/TV/legacy and reduced-motion rules beside their owning component. Do not override another component's elements from callers. Preserve cascade order when merging rules; keep fallback declarations adjacent. Update markup, CSS, runtime toggles and tests together when renaming.
- Use Flexbox, dark theme only, and no `!important` in CSS or inline styles. Stylelint enforces BEM, class selectors and declaration rules; retain the Safari 9 accessible-text `clip` exception.

## UI, input and lifecycle

- UI text is English. Keep the eight-banner platform picker and direct entry to the game title; do not restore a second loading cover. Wide layouts use two banner rows (4+4), with Exolon VR after Remastered.
- Keep the VR banner disabled and grayscale until modern secure-context `immersive-vr` and WebGL 2 support are confirmed. Disabled VR has no active href or tab stop, cannot launch through any input and is skipped by arrow/gamepad navigation. Capability probes must not load Three.js, and late results must not touch a disposed picker.
- Controls belong in the footer, grouped with `SettingsGroup`: navigation actions in `Toolbar` inside `HomePanel`, audio in `SoundControls` inside `SettingsPanel`. Exceptions: fixed top-left `HomeButton` on every platform and in both orientations, fixed top-right `FullscreenButton`, fixed bottom-right screen `SettingsToggle`, and the existing Split slider. Home opens a compact popup below the button, without a heading or close controls; its actions stay in one horizontal row (scrollable on narrow screens), with Platforms first to return to the initial picker. Home toggling, outside clicks and Escape/Back dismiss the popup. `HomePanel` and `SettingsPanel` use `createModalControl` and never open together; opening either pauses an active game, and closing it resumes only the game it paused, unless visibility, focus, tracking or controller loss revoked resumption. Switching between them transfers pause ownership without resuming.
- Keep name entry, bonus, touch controls and cheat screen navigation outside the settings modal. Put all six CHEAT MODE options in a dedicated Settings group and apply and save changes immediately. Keep the historical settings preference key, but start the settings modal closed. Restore focus when closing dialogs. Name entry and scores appear inside the game; retain hidden accessible HTML controls.
- Preserve keyboard, gamepad, multitouch, both orientations and Fullscreen. Escape returns to the title; Pause and the separate pause button pause gameplay. TV detection uses User-Agent via `src/utils/tv.ts`, without a URL switch; preserve native text/IME and system keys.
- Subscribe through `createEventScope`; dispose listeners, timers, RAF and audio. The bfcache `pageshow` handler must survive `pagehide` but be removed on Preact unmount.
- Before platform selection, load only the landing shell, selection controls and Fullscreen. Unlock audio synchronously in the selection gesture before awaiting imports; pass the unlocked context to the classic engine. Native Fullscreen belongs to stable `#app` and must survive app replacement.
- Optional C64/CPC/Sharp banks load lazily with caching for the selected mode or active Split sides only. Preserve effective rendering/controls while loading. Only the latest request may apply graphics, music, timing or readiness; stale responses may populate caches only. Guard both success and failure after cancellation/disposal.
- Preserve held input when switching graphics during gameplay; Define Keys changes/cancellation still reset input. Late loads must never touch disposed DOM, start audio or replace a newer application.

## Resources, persistence and builds

- Active graphics/images belong in `src/assets/`, maps in `src/data/`, music/effects/playback in `src/audio/`. Unused originals, full artwork, music WAVs, captures, traces and provenance belong in platform-specific `originals/` folders outside dist; active WAV effects stay in src.
- Reference actual active files directly: no old-path aliases, WAV-to-M4A mapping, archival fallback or runtime reads from originals. Preserve explicit audio timing, priming compensation, channels and Atari loops. Keep all music variants, source sprites, attribution, licenses and research manifests; export new arrangements separately.
- Preserve original bytes/hashes and independent golden references. Never rewrite historical hashes or derive goldens from the JS renderer to make tests pass. Keep `research/generators/` and historical metadata unchanged; metadata is not a path resolver. Preserved generated JS audio data is not a pattern for new authored code.
- Use `getLocalStorageItem`/`setLocalStorageItem` from `src/lib/LocalStorage/index.ts`, with keys in `keys.ts`; no direct localStorage in new code. Preserve existing keys, blocked-storage handling and local rankings that accept cheated and level-selected results.
- `dist/` is generated and Git-ignored: never edit it manually. Builds clear only dist, preserve src and copy saved loading PNGs. Recovery, audio encoding and `graphics:loading-screens` are offline operations, never regular build prerequisites.
- Publish JS bundles only under boot/runtime/legacy, without source maps or individual modules. SSR bundles stay in `.cache/build/`; instrumented reference modules stay in `.cache/reference/` and are served through Playwright only. Preserve relative URLs and identical dev/production bundle boundaries; no runtime CDN dependency.
- Keep content versions as `?v=<hash>` through `tools/build/versioning.mjs` and `versionAssetUrl`; preserve filenames, other query parameters/fragments and per-audio versions. No preselection manifest request or Service Worker. Dev disables HTTP caching; GitHub Pages owns its headers.
- CSS is extracted in dependency order by `tools/build/styles.mjs`, with no browser runtime injection. Both builds use Autoprefixer and the shared `.browserslistrc`; legacy also converts colors to RGBA. Do not duplicate browser targets in tools.
- Support Safari/iOS 9.3.5 / iPod touch 5+ and modern TV browsers. Legacy uses deferred ES5 IIFEs with shared Preact/hooks, polyfills before Preact and geometry after DOM creation. Preserve Touch Events, keyCode and fallback paths without audio, storage, Gamepad, Pointer Events, AbortController or native Fullscreen. Playwright results do not establish physical-device testing.

## Platform fidelity

- Classic gameplay has five worlds/125 screens; graphics changes must not silently change maps or rules. Check original coordinate conventions before collision/movement edits: horizontal units are often two pixels.
- Amiga and Atari ST are separate games (`game=amiga`, `game=atari-st`) selectable through banners and the Version selector, never RenderMode/Split. Keep platform adapters/data in `src/games/{amiga,atari-st}/`; only verified shared rules belong in `src/games/16bit/`. Preserve Amiga exports and never import ZX maps/model or simulate Atari with an Amiga filter.
- Preserve native 320×200 geometry (including legacy), Amiga's 125 maps of 40×23 cells/four bitplanes and separate platform palettes. Records/cheats use separate platform storage; Amiga has 34 score rows, accepts level-selected/cheated results and keeps its name normalization; Atari allows case-sensitive printable ASCII. Atari has no Monochrome setting.
- Validate new native differences against original disk/code evidence. CPU/68000/SID/SNDH execution and disk extraction stay offline; normal builds use saved resources without disks or Python emulation.
- Preserve base simulation steps in `src/constants/game.ts`: ZX/C64 47 ms, CPC 52 ms, Sharp 45 ms; Remastered/Game Boy retain 30 Hz, native games their own clocks. Do not claim hardware-exact timing for every scene or restore a universal 30 Hz without evidence. Split uses the effective left mode; changing the right side must not change timing. `clock.setInterval` preserves fractional progress/pause and ignores identical intervals.
- VR is a separate `game=vr` application targeting Meta Quest 3S, with full-volume Remastered-style geometry and the existing classic model at 30 Hz. Its explicit `src/entries/vr.ts` build entry emits `runtime/vr.js`, loaded by versioned URL only on VR selection. Keep Three.js outside the landing, other platforms and legacy engine graphs; preserve shared modern Preact/hooks instances and extracted CSS. XR frames must not advance simulation more than once, and visibility/tracking loss or XR exit must pause, clear held input and preserve progress. Only explicit recentering moves the world relative to the spectator. Browser checks do not establish headset comfort or performance.

## Verification and repository care

- Run the smallest relevant check during development; before completing source changes run `npm test` and `npm run build`. Building does not replace type checking. For docs-only edits, check diff, local links, paths and commands; no build is required.
- For behavior/UI/graphics/browser APIs, run relevant Playwright scenarios against the local server in Chromium, Firefox and WebKit as supported. See `tests/browser/run.ts` and README for flags; include `--legacy-only` for compatibility, native platform checks for native changes, and `--platform-picker-only` when launch changes. Install browsers with `npm exec -- playwright install chromium firefox webkit`.
- Never run `npm test` concurrently with browser checks: unit build tests clear dist. Report checks that could not run and why.
- Tests are strict TypeScript. Preserve independent expectations/sample sizes; type invalid fixtures locally rather than weakening production contracts. Serialized `evaluate`/`addInitScript` code cannot depend on Node runtime imports; in-page module URLs use built `.js` files. Do not hide unused code by marking all src/tools as Knip entry points.
- Write documentation and CHANGELOG entries in English; preserve historical quotations, source titles and archival languages. Record completed work under `## DD.MM.YYYY` in [CHANGELOG.md](CHANGELOG.md).
- Preserve unrelated user changes. Do not commit, push or deploy without instruction. Check Git locks after work and remove only proven stale locks after confirming no active Git operation.
