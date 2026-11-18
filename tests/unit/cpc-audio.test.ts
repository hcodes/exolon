import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    CPC_CLOCK,
    SOURCE_MEMORY_SHA256,
    encodeTrace,
    decodeTrace,
    traceFrames,
    renderTrace,
    sha256,
} from '../../tools/audio/cpc.mjs';
import { CPC_AUDIO } from '../../src/audio/cpc/manifest.js';

const directory = new URL('../../originals/audio/cpc/', import.meta.url);
const runtimeDirectory = new URL('../../src/audio/cpc/', import.meta.url);

test('CPC AY traces preserve timing, repeated register writes and unsigned byte values', () => {
    const events = [
        [0, 7, 255],
        [1000, 8, 15],
        [1000, 8, 13],
        [3000, 8, 0],
    ];
    const trace = decodeTrace(encodeTrace(events, 5000));
    assert.deepEqual(trace, { events, durationMicros: 5000 });
    const frames = traceFrames(trace);
    assert.equal(frames.length, 5);
    assert.equal(frames[0][7], 255);
    assert.equal(frames[0][8], 0);
    assert.equal(frames[1][8], 13);
    assert.equal(frames[3][8], 0);
    assert.notEqual(frames[0], frames[1]);
    assert.throws(() => decodeTrace(Buffer.from('CPCAY001')), /header/);
    assert.throws(() => decodeTrace(encodeTrace(events, 5000).subarray(0, 20)), /length/);
    assert.throws(
        () =>
            encodeTrace(
                [
                    [2, 0, 0],
                    [1, 0, 0],
                ],
                5,
            ),
        /event/,
    );
    assert.throws(() => encodeTrace([[5, 0, 0]], 5), /event/);
    assert.throws(() => encodeTrace([[0, 14, 0]], 5), /event/);
    const corrupt = encodeTrace(events, 5000);
    corrupt[22] = 1;
    assert.throws(() => decodeTrace(corrupt), /event/);
    assert.throws(() => traceFrames({ events: [[0, 8, 16]], durationMicros: 1000 }), /envelope/);
});

test('CPC shot capture uses its original CPC stream and tone table, and regenerates identical PCM', async () => {
    const engine = await readFile(new URL('audio-engine.bin', directory));
    const at = (address: number) => engine[address - 0x59fa];
    assert.deepEqual(
        Array.from(engine.subarray(0x69d2 - 0x59fa, 0x69d9 - 0x59fa)),
        [0xfc, 0, 0xfe, 13, 0xfb, 15, 0x74],
    );
    assert.equal(at(0x6b3a) | (at(0x6b3b) << 8), 0x647);
    const trace = decodeTrace(await readFile(new URL('shot.ayr', directory)));
    const sounding = traceFrames(trace).find(
        (registers: Uint8Array) => registers[8] && registers[6],
    )!;
    assert.equal(sounding[0] | (sounding[1] << 8), 0x647);
    assert.equal(sounding[6], 15);
    assert.equal(sounding[8], 13);
    assert.equal(CPC_CLOCK, 1000000);
    assert.deepEqual(renderTrace(trace), await readFile(new URL('shot.wav', runtimeDirectory)));
});

test('all CPC sound recordings and captured original register traces match provenance', async () => {
    const render = JSON.parse(await readFile(new URL('render.json', directory), 'utf8'));
    const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
    assert.equal(render.sourceMemorySha256, SOURCE_MEMORY_SHA256);
    assert.equal(provenance.source.memorySha256, SOURCE_MEMORY_SHA256);
    assert.equal(
        sha256(await readFile(new URL('audio-engine.bin', directory))),
        render.engineSha256,
    );
    assert.equal(render.engineSha256, provenance.extraction.engine.sha256);
    assert.equal(render.recordings.length, 12);
    for (const recording of render.recordings) {
        const bytes = await readFile(new URL(recording.trace, directory)),
            trace = decodeTrace(bytes);
        const wave = await readFile(
            new URL(
                recording.file,
                ['title', 'game-over'].includes(recording.name) ? directory : runtimeDirectory,
            ),
        );
        assert.equal(sha256(bytes), recording.traceSha256, recording.name);
        assert.equal(sha256(wave), recording.sha256, recording.name);
        assert.equal(trace.events.length, recording.writes);
        assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wave.readUInt16LE(22), 1);
        assert.equal(wave.readUInt32LE(24), 44100);
        assert.equal(wave.length - 44, Math.round(recording.seconds * 88200));
        let peak = 0;
        for (let offset = 44; offset < wave.length; offset += 2)
            peak = Math.max(peak, Math.abs(wave.readInt16LE(offset)));
        assert.ok(peak > 1000, `${recording.name}: audible original sound`);
    }
    for (const name of [
        'shot',
        'grenade',
        'rocket',
        'explosion',
        'enemy-destroyed',
        'turret',
        'mine',
        'death',
        'teleport',
        'refill-ammo',
        'refill-grenades',
        'suit',
    ] as const) {
        assert.ok(CPC_AUDIO.effects[name] instanceof URL, name);
        assert.ok((await readFile(CPC_AUDIO.effects[name])).length > 44);
    }
    assert.equal(CPC_AUDIO.effects.suit.href, CPC_AUDIO.effects['refill-ammo'].href);
    assert.equal(CPC_AUDIO.effects.mine.href, CPC_AUDIO.effects.explosion.href);
    assert.equal(CPC_AUDIO.effects.death.href, CPC_AUDIO.effects.explosion.href);
    assert.ok(CPC_AUDIO.title instanceof URL);
    assert.ok(CPC_AUDIO.gameOver instanceof URL);
});
