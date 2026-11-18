import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseSid, encodeWave, sha256 } from '../../tools/audio/c64.mjs';
import { C64_AUDIO } from '../../src/audio/c64/manifest.js';

test('C64 audio extractor preserves PSID memory addresses and all original bytes', async () => {
    const bytes = await readFile(new URL('../../originals/audio/c64/Exolon.sid', import.meta.url));
    const sid = parseSid(bytes);
    assert.equal(sid.loadAddress, 0x6aba);
    assert.equal(sid.initAddress, 0x7ed8);
    assert.equal(sid.playAddress, 0x6ada);
    assert.equal(sid.songs, 2);
    assert.equal(sid.author, 'Nick Jones');
    assert.equal(sid.memory[0x6aba], 0xa9);
    assert.equal(sid.memory[0x7ed8], 0xc9);
    assert.deepEqual(
        sid.memory.subarray(sid.loadAddress, sid.loadAddress + bytes.length - 126),
        bytes.subarray(126),
    );
    assert.throws(() => parseSid(Buffer.from('PSID')), /header/i);
    const corrupt = Buffer.from(bytes);
    corrupt.writeUInt16BE(0xffff, 6);
    assert.throws(() => parseSid(corrupt), /offset/i);
});

test('offline PCM export uses mono signed 16-bit WAV without clipping or endian changes', () => {
    const wave = encodeWave(new Float32Array([-2, -1, 0, 0.5, 1, 2]), 44100);
    assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wave.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wave.readUInt16LE(22), 1);
    assert.equal(wave.readUInt32LE(24), 44100);
    assert.equal(wave.readUInt32LE(40), 12);
    assert.deepEqual(
        Array.from({ length: 6 }, (_, index) => wave.readInt16LE(44 + index * 2)),
        [-32768, -32768, 0, 16384, 32767, 32767],
    );
});

test('original C64 recordings and recovered sound data match their documented source hashes', async () => {
    const directory = new URL('../../originals/audio/c64/', import.meta.url);
    const runtimeDirectory = new URL('../../src/audio/c64/', import.meta.url);
    const render = JSON.parse(await readFile(new URL('render.json', directory), 'utf8'));
    assert.equal(
        sha256(await readFile(new URL('Exolon.sid', directory))),
        'c9efb37683f9c763a15c8e4b9dd384dd17d5e67e9a863dd5463f3e144e85843d',
    );
    const engine = await readFile(new URL('audio-engine.bin', directory));
    assert.equal(
        sha256(engine),
        '1e23b4d9eeb1850fb96b7220c4f7caf4be8bb55272207f3a27acdbe7fdf0e553',
    );
    assert.equal(render.engineSha256, sha256(engine));
    assert.equal(
        sha256(await readFile(new URL('random-routine.bin', directory))),
        render.randomRoutineSha256,
    );
    assert.equal(render.recordings.length, 14);
    for (const recording of render.recordings) {
        const wave = await readFile(
            new URL(
                recording.file,
                ['title', 'game-over'].includes(recording.name) ? directory : runtimeDirectory,
            ),
        );
        assert.equal(sha256(wave), recording.sha256, recording.name);
        assert.equal(wave.readUInt32LE(24), 44100);
        assert.equal(wave.length - 44, Math.round(recording.seconds * 44100 * 2));
        let peak = 0;
        for (let offset = 44; offset < wave.length; offset += 2)
            peak = Math.max(peak, Math.abs(wave.readInt16LE(offset)));
        assert.ok(peak > 1000, `${recording.name} must contain audible original output`);
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
        assert.ok(C64_AUDIO.effects[name] instanceof URL, name);
        assert.ok((await readFile(C64_AUDIO.effects[name])).length > 44);
    }
    assert.equal(C64_AUDIO.effects.suit.href, C64_AUDIO.effects['refill-ammo'].href);
    assert.equal(C64_AUDIO.effects.rocket.href, C64_AUDIO.effects.turret.href);
    assert.equal(C64_AUDIO.effects.mine.href, C64_AUDIO.effects.explosion.href);
});
