# Amiga Remastered: authored graphics and effects

> Архив: 21.11.2026 пользователь запросил удаление Amiga Remastered. Режим, чекбокс, графика, новые эффекты и генераторы удалены; инструкции ниже описывают прежнюю реализацию и не применяются к текущей игре.

Implemented from the [approved design](../docs/superpowers/specs/2026-11-21-amiga-remastered-design.md). This is an optional presentation of the independent Amiga model, not a new source port or a Spectrum rendering mode.

## Resources and provenance

The native graphics file remains unchanged (SHA-256`06886939ed7533cb7e4730ec46ebe27ef92bfeb9283bc41f3a6a3afe3b4541bc`). New hand-authored semantic SVG geometry covers81 groups and368 frames: both suits/death, all projectile/effect families,20 flyer families, turrets, portals/pistons/mines,29 static subjects, menu/HUD/window/star assets. Native geometry and masks guide silhouettes/occlusion; no native bitmap is enlarged or filtered as the redraw. Background planets use smooth analytic edges at their original extents. Terrain uses both256-tile topologies with new material surfaces and five world themes. Menu/HUD have39+10 vector glyphs. Modern HUD labels heavy ammunition ROCKETS; the model's historical `grenade` identifiers remain internal.

`tools/graphics/amiga-remastered/{actors,environment}.ts` are editable source scenes. `npm run graphics:amiga-remastered` bakes them offline using the already installed Playwright, packs6 PNG pages and writes catalog/provenance. Every phase is also kept in editable SVG contact sheets under`src/assets/images/amiga/remastered/source/`. Ordinary builds only copy committed assets and need no Amiga disk/browser for authoring. Catalog validation requires all frames, tile sets, theme sets and fonts; only bounded local PNG names are accepted. PNG dimensions and successful decoding are verified. Atlas images are capped at48MiB, reserving space for fixed rendering buffers within a64MiB presentation budget. Current decoded atlas total is46,170,112 bytes. Legacy draws the same art at2× to reduce Canvas work; native draws4×.

Runtime uses the original320×200 coordinates/model with separate Canvas2D drawing. Static background/foreground caches invalidate on tile/screen changes. Foreground black cutouts remain opaque, partial pistons crop at175-height, teleport inset/word alignment and rocket directions match native rendering, and fragments remain in front of the foreground. Shared page epochs preserve title/ranking timing while switching. Native renderer restores320×200 after HD use and all original source-frame goldens still pass.

## Authored sampled sound

`src/audio/amiga/remastered/` contains14 newly generated mono22050Hz WAV16 effects, with deterministic8-bit-textured PCM definitions in`src/games/amiga/audio/remastered.ts` and offline generator`tools/audio/amiga-remastered.mjs`. `npm run audio:amiga-remastered` reproduces them and records their hashes/provenance. No recovered or third-party sample bytes are used. These effects are explicitly optional new authoring; the original-disks sound-handler research remains valid for Original.

Effects follow real model events. `impact` is presentation metadata for confirmed hits; mine explosion value1 selects its burst, blocked-bullet flash value2 suppresses a duplicate boom. No model outcome changes. Pickup and armor values select their respective cues. One music loop is retained; an independent four-voice priority mix handles FX. In Remastered the music gain is0.6× requested volume and each effect bus0.125×, giving headroom with the real committed PCM at maximum volume; Original retains1× music gain. Pause, menu, tab hide, off and disposal stop active effects without replay on resume.

A revision/disposal-guarded control loads graphics and FX together before enabling, saves successful selection via`exolon-amiga-remastered`, returns immediately to Original on off, preserves a saved selection on transient failed startup, reports a truthful error and permits retry. Missing Web Audio permits graphics alone. Original music/audio/graphics files remain intact.

## Validation

Unit tests cover SVG family/frame completeness and raster inputs, actual PNG coverage/material color range, native-coordinate draw lists, opaque order and cropping, catalog validation/cancellation/image failure, real PCM reproduction and levels, music/FX headroom, voice priority and disposal, atomic preparation and stale-load races. Browser checks exercise native/ES5 on Chromium/Firefox/WebKit, exact Original restoration on pause, music continuity, real shot FX, preference/reload, missing/corrupt resources and fallback/retry. Visual audit artifacts cover every actor/environment family, tile themes, all125 maps and five overview sheets; they are generated under`/tmp/reex-amiga-research/` locally rather than claiming original reference art is modern output.

These desktop browser tests do not prove physical iPod/TV performance or playback on historical Safari hardware. Current source and validation boundaries of the game itself remain in[amiga.md](amiga.md).


### Final recorded checks —21.11.2026

`npm test`:466/466 PASS (format, strict TypeScript, ESLint and unit/build tests). Full Original+Remastered Amiga and settings-panel browser suites passed Chromium/Firefox/WebKit in native/ES5; the expanded mode suite includes corrupt PNG/WAV retry, absent Web Audio and blocked storage. A strict24-case phone/tablet/TV/fullscreen matrix passed without grace delays after fixing the legacy first-frame touch-class measurement. The independent code review's one audio headroom finding is covered by a real-PCM RED→GREEN regression; Original gain remains unchanged.

The complete atlas fits the image budget, so all six pages are prepared atomically when enabling rather than streaming another theme during gameplay. This implementation choice avoids mid-game loading/fallback and repeats no common sprite bank. Images plus the fixed render layers remain within the64MiB presentation budget.

[Recorded CPU call measurements](amiga-remastered-profile.json) cover five worlds and210 simultaneous fragments,60 samples per case, Original/HD4×/HD2×. Maximum case mean/p95 milliseconds: Original0.44/0.50, HD4×1.74/1.90, HD2×0.39/0.50. Every case produced the same model outcome at50/3 simulation updates/second. These are isolated desktop headless render-call measurements, not physical-device FPS or GPU/audio timing guarantees.
