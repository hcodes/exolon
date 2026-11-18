import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeTrace, decodeTrace, renderPcm } from '../../tools/audio/sharp.mjs';

test('Sharp PSG trace retains every port byte and rejects invalid capture data', () => {
    const events = [
        [0, 0x83],
        [0, 0x38],
        [1000, 0x92],
        [2000, 0x9f],
    ];
    assert.deepEqual(decodeTrace(encodeTrace(events, 3000)), { events, durationMicros: 3000 });
    assert.throws(() => encodeTrace([[3000, 0]], 3000), /event/);
    assert.throws(
        () =>
            encodeTrace(
                [
                    [1, 0],
                    [0, 0],
                ],
                3000,
            ),
        /event/,
    );
    assert.throws(() => encodeTrace([[0, 256]], 3000), /event/);
    assert.throws(() => decodeTrace(Buffer.from('MZ8SN001')), /header/);
    const corrupt = encodeTrace(events, 3000);
    corrupt[21] = 1;
    assert.throws(() => decodeTrace(corrupt), /event/);
});

test('Sharp PSG PCM preserves hardware frequency, silence and volume attenuation', () => {
    const trace = {
        events: [
            [0, 0x84],
            [0, 6],
            [0, 0x90],
            [100000, 0x9a],
            [200000, 0x9f],
        ],
        durationMicros: 300000,
    };
    const pcm = renderPcm(trace, 44100, 3200000);
    assert.equal(pcm.length, 13230);
    let rises = 0;
    for (let index = 200; index < 4410; index++) if (pcm[index - 1] <= 0 && pcm[index] > 0) rises++;
    assert.ok(rises >= 94 && rises <= 97, `1000 Hz tone: ${rises} crossings`);
    const rms = (start: number, end: number) =>
        Math.sqrt(
            pcm.slice(start, end).reduce((sum: number, value: number) => sum + value * value, 0) /
                (end - start),
        );
    assert.ok(rms(5000, 8000) / rms(500, 3500) < 0.12, 'ten steps attenuate by 20 dB');
    assert.ok(rms(11000, 13000) < 0.0001, 'final volume15 silences output');
    assert.deepEqual(renderPcm(trace, 44100, 3200000), pcm);
    assert.throws(() => renderPcm(trace, 0), RangeError);
    assert.throws(() => renderPcm(trace, 44100, 0), RangeError);
});

test('Sharp mode selects its own original recording rather than a ZX title', async () => {
    const { createAudio } = await import('../../src/view/audio.ts');
    const audio = createAudio({ graphicsMode: 'sharp-mz800' });
    try {
        assert.equal(audio.selectedMusic, 'sharp-mz800');
    } finally {
        audio.destroy();
    }
});

test('Sharp recordings preserve the converted sound bytes and regenerate identical PCM', async () => {
    const { readFile } = await import('node:fs/promises');
    const { SHARP_AUDIO } = await import('../../src/audio/sharp-mz800/manifest.js');
    const { sha256, renderTrace, SOURCE_MEMORY_SHA256, SHARP_CLOCK } =
        await import('../../tools/audio/sharp.mjs');
    const directory = new URL('../../originals/audio/sharp-mz800/', import.meta.url);
    const runtimeDirectory = new URL('../../src/audio/sharp-mz800/', import.meta.url);
    const render = JSON.parse(await readFile(new URL('render.json', directory), 'utf8'));
    const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8'));
    assert.equal(render.sourceMemorySha256, SOURCE_MEMORY_SHA256);
    assert.equal(provenance.source.memorySha256, SOURCE_MEMORY_SHA256);
    assert.equal(SHARP_CLOCK, 3546880);
    assert.equal(render.recordings.length, 9);
    assert.equal(
        sha256(await readFile(new URL('audio-engine.bin', directory))),
        provenance.extraction.engine.sha256,
    );
    assert.equal(
        sha256(await readFile(new URL('sn-tone-converter.bin', directory))),
        provenance.extraction.toneConverter.sha256,
    );
    const shot = decodeTrace(await readFile(new URL('shot.snr', directory)));
    assert.deepEqual(
        shot.events.slice(8, 11).map((event: number[]) => event[1]),
        [0x92, 0x83, 0x38],
    );
    for (const recording of render.recordings) {
        const bytes = await readFile(new URL(recording.trace, directory));
        const wave = await readFile(
            new URL(
                recording.file,
                ['title', 'game-over'].includes(recording.name) ? directory : runtimeDirectory,
            ),
        );
        const trace = decodeTrace(bytes);
        assert.equal(sha256(bytes), recording.traceSha256, recording.name);
        assert.equal(sha256(wave), recording.sha256, recording.name);
        assert.equal(trace.events.length, recording.writes, recording.name);
        assert.deepEqual(renderTrace(trace), wave, recording.name);
        assert.equal(wave.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wave.readUInt32LE(24), 44100);
        let peak = 0;
        for (let offset = 44; offset < wave.length; offset += 2)
            peak = Math.max(peak, Math.abs(wave.readInt16LE(offset)));
        assert.ok(peak > 1000, `${recording.name} is audible`);
    }
    for (const url of Object.values(SHARP_AUDIO.effects))
        assert.ok((await readFile(url)).length > 44);
    assert.equal(SHARP_AUDIO.effects.suit.href, SHARP_AUDIO.effects['refill-ammo'].href);
    assert.equal(SHARP_AUDIO.effects.mine.href, SHARP_AUDIO.effects.explosion.href);
    assert.notEqual(SHARP_AUDIO.effects.grenade.href, SHARP_AUDIO.effects.shot.href);
});

test('Sharp AAC failure stays unavailable without requesting archived WAV and preserves WAV effects', async () => {
    const { readFile } = await import('node:fs/promises');
    const { createAudio } = await import('../../src/view/audio.ts');
    const { audioGlobals } = await import('../helpers/browser-mocks.ts');
    const previousWindow = audioGlobals.window,
        previousFetch = audioGlobals.fetch;
    const started: import('../helpers/browser-mocks.ts').PcmBuffer[] = [];
    const requested: string[] = [];
    class AudioContext {
        state = 'running';
        sampleRate = 44100;
        createGain() {
            return { gain: { value: 1 }, connect() {} };
        }
        createBuffer(_channels: number, length: number, sampleRate: number) {
            const data = new Float32Array(length);
            return { sampleRate, getChannelData: () => data };
        }
        createBufferSource() {
            return {
                connect() {},
                disconnect() {},
                stop() {},
                start() {
                    started.push(this.buffer);
                },
            } as import('../helpers/browser-mocks.ts').PcmSource;
        }
        decodeAudioData(
            bytes: ArrayBuffer,
            resolve: (buffer: import('../helpers/browser-mocks.ts').PcmBuffer) => void,
        ) {
            const wave = new DataView(bytes);
            if (wave.getUint32(0) !== 0x52494646) throw new Error('Fixture decodes PCM WAV only');
            const buffer = this.createBuffer(
                1,
                (bytes.byteLength - 44) / 2,
                wave.getUint32(24, true),
            );
            for (let index = 0; index < buffer.getChannelData().length; index++)
                buffer.getChannelData()[index] = wave.getInt16(44 + index * 2, true) / 32768;
            resolve(buffer);
        }
        async resume() {}
        async close() {
            this.state = 'closed';
        }
    }
    audioGlobals.window = { AudioContext };
    audioGlobals.fetch = async (url) => {
        requested.push(new URL(url).pathname);
        const bytes = await readFile(url);
        return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    };
    const audio = createAudio({ graphicsMode: 'sharp-mz800' });
    try {
        assert.equal(await audio.unlock(), true);
        assert.equal(await audio.loadMusic(), false);
        assert.equal(audio.startMusic(), false);
        assert.equal(audio.musicInfo, null);
        audio.handle([{ type: 'shot' }]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assert.equal(started.length, 1);
        assert.equal(started[0].getChannelData(0).length, 16758);
        assert.ok(started[0].getChannelData(0).some((value) => value > 0.05));
        assert.ok(requested.every((path) => path.includes('/audio/sharp-mz800/')));
        assert.equal(new Set(requested).size, 9);
        assert.ok(requested.some((path) => path.endsWith('/title.m4a')));
        assert.ok(requested.every((path) => !path.endsWith('/title.wav')));
        assert.ok(requested.every((path) => !path.includes('/originals/')));
        audio.setGraphicsMode('retro');
        assert.equal(audio.selectedMusic, 'original');
    } finally {
        audio.destroy();
        if (previousWindow === undefined) delete audioGlobals.window;
        else audioGlobals.window = previousWindow;
        audioGlobals.fetch = previousFetch;
    }
});
