import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GAMEBOY_AUDIO } from '../../src/audio/gameboy/manifest.js';
import {
    EFFECT_NAMES,
    buildGameBoyAudio,
    createEffectProgram,
    createTitleProgram as untypedCreateTitleProgram,
    renderProgram as untypedRenderProgram,
} from '../../tools/audio/gameboy.mjs';
import { encodeWave, sha256 } from '../../tools/audio/c64.mjs';

interface SourceScore {
    sourceStopSeconds: number;
    events: {
        tone: boolean;
        channel: number;
        seconds: number;
        endSeconds: number;
        midiNote: number;
    }[];
}
interface Program {
    durationSeconds: number;
    events: { channel: number; seconds: number; endSeconds: number; note: number }[];
}
const createTitleProgram: (score: SourceScore) => Program = untypedCreateTitleProgram;
const renderProgram: (program: Program, sampleRate?: number) => Float32Array = untypedRenderProgram;

const directory = new URL('../../originals/audio/gameboy/', import.meta.url);
const runtimeDirectory = new URL('../../src/audio/gameboy/', import.meta.url);
const scoreURL = new URL('../../tools/audio/title-score.json', import.meta.url);

test('Game Boy-inspired arrangement retains every source melody onset and pitch with four distinct voice roles', async () => {
    const score: SourceScore = JSON.parse(await readFile(scoreURL, 'utf8'));
    const program = createTitleProgram(score);
    const sourceMelody = score.events.filter((event) => event.tone && event.channel === 0);
    const melody = program.events.filter((event) => event.channel === 0);
    assert.equal(program.durationSeconds, score.sourceStopSeconds + 0.16);
    assert.deepEqual(
        melody.map((event) => [event.seconds, event.endSeconds, event.note]),
        sourceMelody.map((event) => [event.seconds, event.endSeconds, event.midiNote]),
    );
    assert.deepEqual(new Set(program.events.map((event) => event.channel)), new Set([0, 1, 2, 3]));
    for (let channel = 0; channel < 4; channel++) {
        const events = program.events.filter((event) => event.channel === channel);
        assert.ok(
            events.every((event, index) => !index || event.seconds >= events[index - 1].endSeconds),
        );
    }
});

test('Game Boy-inspired noise and stepped effects are deterministic and event-specific', () => {
    const hashes = new Set();
    for (const name of EFFECT_NAMES) {
        const program = createEffectProgram(name);
        const first = renderProgram(program, 22050);
        assert.deepEqual(first, renderProgram(program, 22050), name);
        assert.ok(first.every(Number.isFinite), name);
        assert.ok(
            first.some((sample) => Math.abs(sample) > 0.04),
            name,
        );
        assert.ok(
            first.every((sample) => Math.abs(sample) <= 0.81),
            name,
        );
        assert.ok(
            first.subarray(first.length - 200).every((sample) => Math.abs(sample) < 0.0001),
            name,
        );
        hashes.add(sha256(encodeWave(first, 22050)));
    }
    assert.equal(hashes.size, EFFECT_NAMES.length);
    assert.throws(() => createEffectProgram('not-an-event'), /Unknown/);
    assert.throws(() => renderProgram(createEffectProgram('shot'), 0), /sample rate/i);
});

test('Game Boy-inspired PCM assets match offline source hashes and provenance', async () => {
    const render = JSON.parse(await readFile(new URL('render.json', directory), 'utf8'));
    const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
    assert.equal(render.sourceScoreSha256, sha256(await readFile(scoreURL)));
    assert.equal(
        render.synthesizerSha256,
        sha256(
            await readFile(
                new URL('../../research/generators/gameboy-synthesize.js.txt', import.meta.url),
            ),
        ),
    );
    assert.equal(
        render.arrangementRendererSha256,
        sha256(
            await readFile(new URL('../../research/generators/gameboy.mjs.txt', import.meta.url)),
        ),
    );
    assert.equal(provenance.kind, 'New Game Boy-inspired stylization');
    assert.equal(provenance.originalComposer, 'Nick Jones');
    assert.equal(render.recordings.length, EFFECT_NAMES.length + 2);
    assert.ok(GAMEBOY_AUDIO.title instanceof URL);
    assert.ok(GAMEBOY_AUDIO.gameOver instanceof URL);
    for (const name of EFFECT_NAMES)
        assert.ok(
            GAMEBOY_AUDIO.effects[name as keyof typeof GAMEBOY_AUDIO.effects] instanceof URL,
            name,
        );
    for (const recording of render.recordings) {
        const wave = await readFile(
            new URL(
                recording.file,
                ['title', 'game-over'].includes(recording.name) ? directory : runtimeDirectory,
            ),
        );
        assert.equal(sha256(wave), recording.sha256, recording.name);
        assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wave.readUInt16LE(22), 1);
        assert.equal(wave.readUInt32LE(24), 44100);
        assert.equal((wave.length - 44) / 88200, recording.seconds);
        const program =
            recording.name === 'title'
                ? createTitleProgram(JSON.parse(await readFile(scoreURL, 'utf8')))
                : createEffectProgram(recording.name);
        assert.deepEqual(encodeWave(renderProgram(program), 44100), wave, recording.name);
    }
});

test('Game Boy-inspired offline builds preserve existing recordings', async () => {
    const output = await mkdtemp(join(tmpdir(), 'exolon-gameboy-preserve-'));
    try {
        const preserved = Buffer.from('existing take must remain unchanged');
        await writeFile(join(output, 'title.wav'), preserved);
        await assert.rejects(buildGameBoyAudio(output), /Refusing to overwrite/);
        assert.deepEqual(await readFile(join(output, 'title.wav')), preserved);
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});

test('Game Boy CLI --output reproduces all files inside the temporary directory and preserves runtime assets', async () => {
    const output = await mkdtemp(join(tmpdir(), 'exolon-gameboy-isolated-'));
    const runtimeFiles = await readdir(runtimeDirectory);
    const before = await Promise.all(
        runtimeFiles.map(async (file) => [
            file,
            sha256(await readFile(new URL(file, runtimeDirectory))),
        ]),
    );
    try {
        await promisify(execFile)(process.execPath, [
            '--experimental-strip-types',
            fileURLToPath(new URL('../../tools/audio/gameboy.mjs', import.meta.url)),
            '--output',
            output,
        ]);
        const expected = [
            'title.wav',
            'game-over.wav',
            ...EFFECT_NAMES.map((name) => `${name}.wav`),
            'render.json',
            'provenance.json',
        ];
        assert.deepEqual((await readdir(output)).sort(), expected.sort());
        const render = JSON.parse(await readFile(join(output, 'render.json'), 'utf8'));
        for (const recording of render.recordings)
            assert.equal(sha256(await readFile(join(output, recording.file))), recording.sha256);
        assert.deepEqual(await readdir(runtimeDirectory), runtimeFiles);
        assert.deepEqual(
            await Promise.all(
                runtimeFiles.map(async (file) => [
                    file,
                    sha256(await readFile(new URL(file, runtimeDirectory))),
                ]),
            ),
            before,
        );
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});
