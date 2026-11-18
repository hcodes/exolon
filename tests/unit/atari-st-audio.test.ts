import test from 'node:test';
import assert from 'node:assert/strict';
import { createAtariStSound } from '../../src/games/atari-st/controllers/audio.ts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function environment(delayedDecode = false) {
    const calls: string[] = [];
    const requests: {
        url: string;
        signal?: AbortSignal | null;
        result: ReturnType<typeof deferred<Response>>;
    }[] = [];
    const decodes: ReturnType<typeof deferred<AudioBuffer>>[] = [];
    const gain = { gain: { value: 0 }, connect() {} };
    const timers = new Map<number, () => void>();
    const timerDelays: number[] = [];
    let timerId = 0;
    const sources: {
        loop: boolean;
        loopStart: number;
        loopEnd: number;
        playbackRate: { value: number };
        onended: (() => void) | null;
    }[] = [];
    class Audio {
        state = 'suspended';
        destination = {};
        resume() {
            calls.push('resume');
            this.state = 'running';
            return Promise.resolve();
        }
        close() {
            calls.push('close');
            return Promise.resolve();
        }
        createGain() {
            return gain;
        }
        createBufferSource() {
            const source = {
                loop: false,
                loopStart: 0,
                loopEnd: 0,
                playbackRate: { value: 1 },
                buffer: null,
                onended: null as (() => void) | null,
                connect() {},
                disconnect() {
                    calls.push('disconnect');
                },
                start() {
                    calls.push('start');
                },
                stop() {
                    calls.push('stop');
                },
            };
            sources.push(source);
            return source;
        }
        decodeAudioData(
            _bytes: ArrayBuffer,
            success: (buffer: AudioBuffer) => void,
            failure: (error: Error) => void,
        ) {
            calls.push('decode');
            if (!delayedDecode) success({ duration: 207.98 } as AudioBuffer);
            else {
                const ready = deferred<AudioBuffer>();
                decodes.push(ready);
                void ready.promise.then(success, failure);
            }
            // Callback-only Safari implementation deliberately returns nothing.
        }
    }
    const view = {
        AudioContext: Audio,
        AbortController,
        setTimeout(callback: () => void, delay: number) {
            timerDelays.push(delay);
            const id = ++timerId;
            timers.set(id, () => {
                timers.delete(id);
                callback();
            });
            return id;
        },
        clearTimeout(id: number) {
            timers.delete(id);
        },
        document: { baseURI: 'https://example.test/reex/' },
        fetch(url: string, init?: RequestInit) {
            calls.push('fetch');
            const result = deferred<Response>();
            requests.push({ url: String(url), signal: init?.signal, result });
            return result.promise;
        },
    } as unknown as Window & typeof globalThis;
    function respond(index: number, ok = true) {
        requests[index].result.resolve({
            ok,
            arrayBuffer: async () => new ArrayBuffer(4),
        } as Response);
    }
    return { view, calls, requests, decodes, gain, sources, respond, timers, timerDelays };
}
const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};

test('Atari ST unlocks synchronously and plays the complete original title loop', async () => {
    const env = environment();
    const sound = createAtariStSound(env.view);
    sound.unlock();
    assert.deepEqual(env.calls, ['resume']);
    const pending = sound.playTitle();
    assert.equal(env.requests[0].url, 'https://example.test/reex/audio/atari-st/title.m4a');
    env.respond(0);
    assert.equal(await pending, true);
    assert.equal(env.sources[0].loop, true);
    assert.equal(env.sources[0].loopStart, 876 / 44100);
    assert.equal(env.sources[0].loopEnd, 9106234 / 44100);
    assert.equal(env.sources[0].playbackRate.value, 1);
    assert.equal(await sound.playTitle(), true);
    assert.equal(env.sources.length, 1);
    sound.setVolume(2);
    assert.equal(env.gain.gain.value, 1);
    sound.setVolume(Number.NaN);
    assert.equal(env.gain.gain.value, 0);
    sound.dispose();
    assert.ok(env.calls.includes('close'));
    assert.equal(await sound.playTitle(), false);
});

test('Atari ST Game Over restores main music after the original nominal busy wait', async () => {
    const env = environment();
    const sound = createAtariStSound(env.view);
    const title = sound.playTitle();
    env.respond(0);
    await title;
    const ending = sound.playGameOver();
    assert.equal(env.calls.filter((call) => call === 'stop').length, 1);
    assert.match(env.requests[1].url, /\/audio\/atari-st\/game-over\.m4a$/);
    env.respond(1);
    assert.equal(await ending, true);
    assert.equal(env.sources[1].loop, false);
    assert.equal(env.sources[1].playbackRate.value, 1);
    assert.deepEqual(env.timerDelays, [(23592964 / 8e6) * 1000]);
    assert.equal(env.timers.size, 1);
    env.timers.values().next().value?.();
    await flush();
    assert.equal(env.calls.filter((call) => call === 'stop').length, 2);
    assert.equal(await sound.playTitle(), true);
    assert.equal(env.requests.length, 2);
    assert.equal(env.sources.length, 3);
    sound.dispose();
});

test('Atari ST cancels stale fetches when switching tracks and stops pending decode', async () => {
    const env = environment(true);
    const sound = createAtariStSound(env.view);
    const staleTitle = sound.playTitle();
    const ending = sound.playGameOver();
    assert.ok(env.requests[0].signal?.aborted);
    env.respond(0);
    assert.equal(await staleTitle, false);
    assert.equal(env.decodes.length, 0);
    env.respond(1);
    await flush();
    assert.equal(env.decodes.length, 1);
    sound.stop();
    env.decodes[0].resolve({} as AudioBuffer);
    assert.equal(await ending, false);
    assert.equal(env.sources.length, 0);
    const retry = sound.playTitle();
    assert.equal(env.requests.length, 3);
    sound.dispose();
    assert.ok(env.requests[2].signal?.aborted);
    env.requests[2].result.reject(new Error('aborted'));
    assert.equal(await retry, false);
});

test('Atari ST shares a pending same-track load and handles unavailable audio or recordings', async () => {
    const env = environment();
    const sound = createAtariStSound(env.view);
    const first = sound.playTitle();
    const second = sound.playTitle();
    assert.equal(env.requests.length, 1);
    env.respond(0);
    assert.equal(await first, true);
    assert.equal(await second, true);
    assert.equal(env.sources.length, 1);
    sound.stop();
    const ending = sound.playGameOver();
    env.respond(1, false);
    await flush();
    assert.equal(env.requests.length, 2);
    assert.match(env.requests[1].url, /\/audio\/atari-st\/game-over\.m4a$/);
    assert.equal(await ending, false);
    sound.dispose();
    const silent = createAtariStSound({} as Window & typeof globalThis);
    silent.unlock();
    assert.equal(await silent.playTitle(), false);
    assert.equal(await silent.playGameOver(), false);
    silent.dispose();
});

test('Atari ST handles M4A failures without requesting archived WAV', async () => {
    for (const failure of ['http', 'decode'] as const) {
        const env = environment(failure === 'decode');
        const sound = createAtariStSound(env.view);
        const playing = sound.playTitle();
        assert.match(env.requests[0].url, /\/audio\/atari-st\/title\.m4a$/);
        env.respond(0, failure !== 'http');
        await flush();
        if (failure === 'decode') {
            env.decodes[0].reject(new Error('Unsupported AAC'));
            await flush();
        }
        assert.equal(env.requests.length, 1);
        assert.equal(await playing, false);
        assert.equal(env.sources.length, 0);
        sound.dispose();
    }
});

test('Atari ST cannot restart loading after a cancelled AAC decode rejects', async () => {
    const env = environment(true);
    const sound = createAtariStSound(env.view);
    const playing = sound.playTitle();
    env.respond(0);
    await flush();
    sound.stop();
    env.decodes[0].reject(new Error('Late AAC decode failure'));
    assert.equal(await playing, false);
    assert.equal(env.requests.length, 1);
    assert.equal(env.sources.length, 0);
    sound.dispose();
});

test('Atari ST recordings preserve the verified original PSG traces and PCM', async () => {
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    for (const [file, bytes, digest] of [
        ['title.ym14', 145586, 'b6bff708bde51b8561e3d7795c3f7c8723835f69678c5b34d965be740489cd58'],
        [
            'game-over.ym14',
            2212,
            'ee201e5cb9e719e11553625d24b2de4c249c68d47af08d8ba55b428b427d8ed7',
        ],
        ['title.wav', 18212512, '7958a15639d5b0fd442114ef095b3d38d1ec471380dd84c574ef856f4084af4a'],
        [
            'game-over.wav',
            276762,
            '5beac0fd6c1a534921222db6f379bd2eafd110543d3f582b05212303f81eec64',
        ],
        [
            'archive/title-50hz.wav',
            18343880,
            '6e260eafc5476ceae9022f9402256afd4164e20c9df29e6fee90131fdd7b1c5f',
        ],
        [
            'archive/game-over-50hz.wav',
            278756,
            'be8e18d4f2fb6e55267a90abd5616de2cbd9479796f33426f1f39abfc455a43d',
        ],
    ] as const) {
        const data = await readFile(
            new URL(`../../originals/audio/atari-st/${file}`, import.meta.url),
        );
        assert.equal(data.length, bytes, file);
        assert.equal(createHash('sha256').update(data).digest('hex'), digest, file);
        if (file.endsWith('.wav')) {
            assert.equal(data.toString('ascii', 0, 4), 'RIFF');
            assert.equal(data.readUInt16LE(22), 1);
            assert.equal(data.readUInt32LE(24), 44100);
            assert.equal(data.readUInt16LE(34), 16);
            assert.equal(data.readUInt32LE(40), data.length - 44);
        }
    }
});

test('Atari ST stop and disposal cancel the original Game Over restoration timer', async () => {
    for (const action of ['stop', 'dispose'] as const) {
        const env = environment();
        const sound = createAtariStSound(env.view);
        const ending = sound.playGameOver();
        env.respond(0);
        await ending;
        const obsolete = env.timers.values().next().value;
        assert.equal(typeof obsolete, 'function');
        sound[action]();
        assert.equal(env.timers.size, 0);
        obsolete?.();
        await flush();
        assert.equal(env.requests.length, 1, 'Late timer must not fetch or restart title');
        assert.equal(env.sources.length, 1);
        sound.dispose();
    }
});
