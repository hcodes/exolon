# Historical audio generator snapshots

These text files preserve the exact generator bytes used by the archived recordings and their provenance SHA-256 values. They are archival inputs, not runnable current tools. Current entry points live in tools/audio/. The directory reorganization changed import paths and CLI labels, while the source score, synthesis programs and recorded sound files remain unchanged. Unit tests compare the current Game Boy generator's output against every preserved recording, and verify the historical generator hash against its snapshot.

Serialized source records such as tools/audio/title-score.json and src/audio/original-data.js retain their original historical path labels because their exact bytes are fingerprinted by the archived recordings. Resolve those old paths using research/project-layout.json; current executable tools and npm commands use the new structure.

`gameboy-synthesize.js.txt` is the exact JavaScript synthesizer used for the preserved Game Boy WAV recordings before the TypeScript migration. Historical provenance labels keep their original `src/audio/gameboy/synthesize.js` spelling; new generation uses the typed `src/audio/gameboy/synthesize.ts`. Tests verify both the archived source hash and byte-exact output of the current synthesizer.
