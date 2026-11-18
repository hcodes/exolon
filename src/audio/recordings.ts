import { versionAssetUrl } from '../services/asset-url.ts';

export interface RecordingTiming {
    readonly frames: number;
    readonly sampleRate: number;
    readonly channels: number;
    readonly primingFrames?: number;
    readonly remainderFrames?: number;
}
// Decoders differ in honoring MP4 gapless edits. Source-frame metadata identifies
// untrimmed priming and packet padding without a browser/user-agent branch.
export function normalizeRecordingBuffer(
    buffer: AudioBuffer,
    timing: RecordingTiming,
    context: AudioContext,
): AudioBuffer {
    // Minimal callback-only transports used by tests do not expose PCM buffers.
    if (
        typeof buffer.length !== 'number' ||
        typeof buffer.getChannelData !== 'function' ||
        typeof buffer.numberOfChannels !== 'number'
    )
        return buffer;
    if (buffer.numberOfChannels !== timing.channels) throw new Error('Unexpected audio channels');
    const ratio = buffer.sampleRate / timing.sampleRate;
    const frames = Math.round(timing.frames * ratio);
    if (!Number.isSafeInteger(frames) || frames <= 0) throw new Error('Invalid recording duration');
    // Avoid copying an entire music buffer for one resampler rounding frame.
    if (Math.abs(buffer.length - frames) <= 1) return buffer;
    if (buffer.length < frames - 1)
        throw new Error('Compressed recording is truncated or too short');
    let offset = 0;
    if (timing.primingFrames !== undefined && timing.remainderFrames !== undefined) {
        const priming = timing.primingFrames;
        const remainder = timing.remainderFrames;
        const matches = (sourceFrames: number) =>
            Math.abs(buffer.length - Math.round(sourceFrames * ratio)) <= 2;
        if (matches(timing.frames + priming + remainder) || matches(timing.frames + priming)) {
            offset = Math.round(priming * ratio);
        } else if (!matches(timing.frames + remainder)) {
            throw new Error('Unexpected compressed recording padding');
        }
    } else {
        const padding = Math.ceil(4096 * ratio);
        if (buffer.length > frames + padding)
            throw new Error('Unexpected compressed recording padding');
    }
    if (buffer.length < offset + frames - 1)
        throw new Error('Compressed recording is truncated after priming');
    const normalized = context.createBuffer(timing.channels, frames, buffer.sampleRate);
    for (let channel = 0; channel < timing.channels; channel++) {
        const source = buffer.getChannelData(channel).subarray(offset, offset + frames);
        const target = normalized.getChannelData(channel);
        target.set(source);
        if (source.length < frames) target[frames - 1] = source[source.length - 1] || 0;
    }
    return normalized;
}

function decode(context: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
        const result = context.decodeAudioData(bytes, resolve, reject);
        if (result && typeof result.then === 'function') void result.then(resolve, reject);
    });
}

export async function loadRecording({
    url,
    timing,
    context,
    fetcher = fetch,
    request,
    isCurrent = () => true,
}: {
    url: URL;
    timing?: RecordingTiming;
    context: AudioContext;
    fetcher?: typeof fetch;
    request?: RequestInit;
    isCurrent?: () => boolean;
}): Promise<AudioBuffer> {
    const current = () => isCurrent() && !request?.signal?.aborted && context.state !== 'closed';
    function checkCurrent() {
        if (current()) return;
        const error = new Error('Audio recording load cancelled');
        error.name = 'AbortError';
        throw error;
    }
    checkCurrent();
    try {
        const response = await fetcher(new URL(versionAssetUrl(url)), request);
        checkCurrent();
        if (!response.ok) throw new Error('Audio recording unavailable: ' + response.status);
        const bytes = await response.arrayBuffer();
        checkCurrent();
        const decoded = await decode(context, bytes);
        checkCurrent();
        return timing ? normalizeRecordingBuffer(decoded, timing, context) : decoded;
    } catch (error) {
        checkCurrent();
        throw error;
    }
}
