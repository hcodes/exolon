import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmigaSound } from '../../src/games/amiga/controllers/audio.ts';

function environment() {
    const calls: string[] = [];
    const requests: string[] = [];
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
        release = resolve;
    });
    const gain = { gain: { value: 0 }, connect() {} };
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
            this.state = 'closed';
            return Promise.resolve();
        }
        createGain() {
            return gain;
        }
        createBufferSource() {
            return {
                loop: false,
                buffer: null,
                connect() {},
                start() {
                    calls.push('start');
                },
                stop() {
                    calls.push('stop');
                },
                disconnect() {},
            };
        }
        decodeAudioData(_data: ArrayBuffer, success: (buffer: object) => void) {
            success({ duration: 90 });
        }
    }
    const view = {
        AudioContext: Audio,
        document: { baseURI: 'http://localhost/reex/' },
        async fetch(url: string) {
            calls.push('fetch');
            requests.push(String(url));
            await ready;
            return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
        },
    } as unknown as Window & typeof globalThis;
    return { view, calls, release, gain, requests };
}

test('Amiga title unlocks in the gesture and cannot start after stop or disposal', async () => {
    const env = environment(),
        sound = createAmigaSound(env.view);
    sound.unlock();
    assert.deepEqual(env.calls, ['resume']);
    const first = sound.playTitle();
    assert.equal(env.requests[0], 'http://localhost/reex/audio/amiga/title.m4a');
    sound.stop();
    env.release();
    assert.equal(await first, false);
    assert.equal(env.calls.includes('start'), false);
    assert.equal(await sound.playTitle(), true);
    assert.equal(env.calls.filter((call) => call === 'fetch').length, 1);
    sound.setVolume(2);
    assert.equal(env.gain.gain.value, 1);
    sound.setVolume(Number.NaN);
    assert.equal(env.gain.gain.value, 0);
    sound.dispose();
    assert.ok(env.calls.includes('stop'));
    assert.ok(env.calls.includes('close'));
    assert.equal(await sound.playTitle(), false);
});

test('Amiga remains playable without Web Audio and rejected title requests are contained', async () => {
    const sound = createAmigaSound({
        document: { baseURI: 'http://localhost/' },
    } as unknown as Window & typeof globalThis);
    sound.unlock();
    assert.equal(await sound.playTitle(), false);
    sound.dispose();
    const env = environment();
    env.view.fetch = () => Promise.reject(new Error('offline'));
    const failed = createAmigaSound(env.view);
    failed.unlock();
    assert.equal(await failed.playTitle(), false);
    failed.dispose();
});

test('Amiga disposal aborts a pending source recording request when cancellation is available', async () => {
    const env = environment();
    env.view.AbortController = AbortController;
    const fetcher = env.view.fetch;
    let signal: AbortSignal | null | undefined;
    env.view.fetch = (url, init) => {
        signal = init?.signal;
        return fetcher(url, init);
    };
    const sound = createAmigaSound(env.view);
    sound.unlock();
    const playing = sound.playTitle();
    sound.dispose();
    assert.ok(signal?.aborted);
    env.release();
    assert.equal(await playing, false);
});

test('Amiga stays recoverable without requesting archived WAV after M4A failure', async () => {
    const env = environment();
    const urls: string[] = [];
    const fetcher = env.view.fetch;
    env.view.fetch = (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith('.m4a')) return Promise.resolve({ ok: false } as Response);
        return fetcher(url, init);
    };
    const sound = createAmigaSound(env.view);
    const playing = sound.playTitle();
    env.release();
    assert.equal(await playing, false);
    assert.deepEqual(urls, ['http://localhost/reex/audio/amiga/title.m4a']);
    sound.dispose();
});
