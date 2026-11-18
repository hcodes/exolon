import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRecording, normalizeRecordingBuffer } from '../../src/audio/recordings.ts';

const original = new URL('https://example.test/reex/audio/c64/title.m4a?version=1');
const marker = {} as AudioBuffer;
function decoder(failed = false, promiseOnly = false) {
    return {
        state: 'running',
        decodeAudioData(
            _bytes: ArrayBuffer,
            resolve: (value: AudioBuffer) => void,
            reject: (error: Error) => void,
        ) {
            if (failed) {
                reject(new Error('Unsupported codec'));
                return;
            }
            if (promiseOnly) return Promise.resolve(marker);
            resolve(marker);
        },
    } as unknown as AudioContext;
}
function fetcher(calls: string[], failed = false) {
    return (async (url: URL | RequestInfo) => {
        calls.push(String(url));
        return new Response(new Uint8Array([1, 2]), { status: failed ? 404 : 200 });
    }) as typeof fetch;
}
test('a recording loads exactly its actual resource URL under a document subpath', async () => {
    const calls: string[] = [];
    assert.equal(
        await loadRecording({ url: original, context: decoder(), fetcher: fetcher(calls) }),
        marker,
    );
    assert.deepEqual(calls, [String(original)]);
});
for (const reason of ['HTTP', 'decode'] as const)
    test(`${reason} failure never requests an archived WAV or changes the URL`, async () => {
        const calls: string[] = [];
        await assert.rejects(
            loadRecording({
                url: original,
                context: decoder(reason === 'decode'),
                fetcher: fetcher(calls, reason === 'HTTP'),
            }),
        );
        assert.deepEqual(calls, [String(original)]);
    });
test('Promise-only decoding works alongside the legacy callback path', async () => {
    assert.equal(
        await loadRecording({ url: original, context: decoder(false, true), fetcher: fetcher([]) }),
        marker,
    );
});
test('a stale recording aborts without another resource request', async () => {
    const calls: string[] = [];
    let current = true;
    const transport = (async (url: URL | RequestInfo) => {
        calls.push(String(url));
        current = false;
        return new Response('', { status: 404 });
    }) as typeof fetch;
    await assert.rejects(
        loadRecording({
            url: original,
            context: decoder(),
            fetcher: transport,
            isCurrent: () => current,
        }),
        { name: 'AbortError' },
    );
    assert.equal(calls.length, 1);
});
test('an aborted or closed recording cannot continue loading', async () => {
    const request = new AbortController();
    const calls: string[] = [];
    const transport = (async (url: URL | RequestInfo, options?: RequestInit) => {
        calls.push(String(url));
        assert.equal(options?.signal, request.signal);
        request.abort();
        return new Response('', { status: 404 });
    }) as typeof fetch;
    await assert.rejects(
        loadRecording({
            url: original,
            context: decoder(),
            fetcher: transport,
            request: { signal: request.signal },
        }),
        { name: 'AbortError' },
    );
    assert.equal(calls.length, 1);
    const closed = decoder();
    Object.defineProperty(closed, 'state', { value: 'closed' });
    await assert.rejects(
        loadRecording({ url: original, context: closed, fetcher: fetcher(calls) }),
        { name: 'AbortError' },
    );
    assert.equal(calls.length, 1);
});
test('the caller supplies AAC timing directly without a source-path lookup', async () => {
    const decoded = pcm(1, 1032, 1000);
    const audio = {
        state: 'running',
        createBuffer: pcm,
        decodeAudioData(_bytes: ArrayBuffer, resolve: (value: AudioBuffer) => void) {
            resolve(decoded);
        },
    } as unknown as AudioContext;
    const result = await loadRecording({
        url: new URL('https://example.test/reex/audio/new-platform/theme.m4a'),
        timing: {
            frames: 1000,
            sampleRate: 1000,
            channels: 1,
            primingFrames: 20,
            remainderFrames: 12,
        },
        context: audio,
        fetcher: fetcher([]),
    });
    assert.equal(result.length, 1000);
    assert.deepEqual(result.getChannelData(0), decoded.getChannelData(0).subarray(20, 1020));
});

function pcm(channels: number, frames: number, sampleRate: number): AudioBuffer {
    const data = Array.from({ length: channels }, () =>
        Float32Array.from({ length: frames }, (_, i) => i / frames),
    );
    return {
        length: frames,
        sampleRate,
        numberOfChannels: channels,
        getChannelData: (channel: number) => data[channel],
    } as unknown as AudioBuffer;
}
const context = { createBuffer: pcm } as unknown as AudioContext;
test('AAC end padding is trimmed to the exact source duration at the decoded sample rate', () => {
    const decoded = pcm(2, 206, 2000);
    const result = normalizeRecordingBuffer(
        decoded,
        { frames: 100, sampleRate: 1000, channels: 2 },
        context,
    );
    assert.equal(result.length, 200);
    assert.equal(result.numberOfChannels, 2);
    assert.deepEqual(result.getChannelData(0), decoded.getChannelData(0).subarray(0, 200));
    assert.equal(
        normalizeRecordingBuffer(result, { frames: 100, sampleRate: 1000, channels: 2 }, context),
        result,
    );
});
test('truncated or incorrectly channelled compressed files are rejected', () => {
    assert.throws(
        () =>
            normalizeRecordingBuffer(
                pcm(1, 80, 1000),
                { frames: 100, sampleRate: 1000, channels: 1 },
                context,
            ),
        /short|truncat/i,
    );
    assert.throws(
        () =>
            normalizeRecordingBuffer(
                pcm(1, 100, 1000),
                { frames: 100, sampleRate: 1000, channels: 2 },
                context,
            ),
        /channel/i,
    );
});

test('untrimmed AAC priming is removed by packet metadata without shifting gapless decoders', () => {
    const timing = {
        frames: 1000,
        sampleRate: 1000,
        channels: 1,
        primingFrames: 20,
        remainderFrames: 12,
    };
    const untrimmed = pcm(1, 1032, 1000);
    const normalized = normalizeRecordingBuffer(untrimmed, timing, context);
    assert.equal(normalized.length, 1000);
    assert.deepEqual(normalized.getChannelData(0), untrimmed.getChannelData(0).subarray(20, 1020));
    const alreadyTrimmed = pcm(1, 1000, 1000);
    assert.equal(normalizeRecordingBuffer(alreadyTrimmed, timing, context), alreadyTrimmed);
    const tailOnly = pcm(1, 1012, 1000);
    assert.deepEqual(
        normalizeRecordingBuffer(tailOnly, timing, context).getChannelData(0),
        tailOnly.getChannelData(0).subarray(0, 1000),
    );
});
