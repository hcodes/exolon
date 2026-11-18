# Preserved original resources

This directory is an archive and is never copied into dist or imported by game code. It contains original/recovered inputs and preserved historical derivatives; the presence of a Game Boy or Remastered variant does not claim an original platform release.

- `audio/<platform>/`: original music WAV, hardware traces, extracted drivers/banks, provenance and render reports; historical Atari recordings remain in their archive subfolder. Root `audio/title-*.m4a` contains preserved unused arrangements. Active music M4A/MP3 and WAV effects remain src/audio.
- `graphics/<platform>/`: extraction provenance, canonical input lists and the source Atari font. Active JSON sprite/map tables remain src/assets/graphics.
- `images/<platform>/`: original captures, independent reference frames and full-size/historical illustrations. Shared comparison material remains images/shared/reference. The only Remastered image used by the game is its saved small preview in src.
- `data/`: preserved research screen extraction.
- `metadata/`: historical project-layout documents. Their old paths are historical evidence, not aliases or lookup tables used by code.

All moved originals retain their exact bytes and SHA-256. Direct path/hash checks are in tests/unit/assets.test.ts; original provenance hashes are not rewritten. Prior generated cover metadata is preserved, while the explicit loading-screens exporter writes a separate current provenance report. No old-to-new path resolver exists.

Offline tools may read these direct paths to regenerate explicitly selected runtime files. Normal game builds need only saved src assets and do not read this archive. Music compression accepts separate --originals-root and --runtime-root, validates existing provenance before publication, and never overwrites historical provenance. --metadata-only verifies existing WAV/M4A and updates runtime timing descriptors without encoding audio. Required Ayumi/Preact/lyam licenses remain in the distribution.
