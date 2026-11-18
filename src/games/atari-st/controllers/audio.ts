import { ATARI_ST_TITLE, ATARI_ST_GAME_OVER } from '../../../audio/compressed/recordings.ts';
import { loadRecording } from '../../../audio/recordings.ts';
// Original YM2149 replay is rendered offline; the browser plays recordings only.
type Track = 'title' | 'game-over';
// Original $8da busy loop: 0x90000 iterations, 23,592,964 nominal68000 cycles.
const RESTORE_MAIN_MS = (23592964 / 8000000) * 1000;

export function createAtariStSound(view: Window & typeof globalThis) {
    let context: AudioContext | undefined;
    let gain: GainNode | undefined;
    let source: AudioBufferSourceNode | undefined;
    let playing: Track | undefined;
    let loading: { track: Track; version: number; promise: Promise<boolean> } | undefined;
    let request: AbortController | undefined;
    let restoreTimer: number | undefined;
    const buffers: Partial<Record<Track, AudioBuffer>> = {};
    let volume = 0.35;
    let disposed = false;
    let version = 0;

    function unlock() {
        if (disposed) return;
        try {
            const Audio = view.AudioContext || view.webkitAudioContext;
            if (!context && Audio) {
                context = new Audio();
                gain = context.createGain();
                gain.gain.value = volume;
                gain.connect(context.destination);
            }
            // Keep resume inside the direct banner/input gesture, before module loading.
            if (context?.state === 'suspended') void context.resume().catch(() => {});
        } catch {
            /* Audio is optional. */
        }
    }
    function stop() {
        version++;
        if (restoreTimer !== undefined) view.clearTimeout(restoreTimer);
        restoreTimer = undefined;
        request?.abort();
        request = undefined;
        loading = undefined;
        playing = undefined;
        if (source) {
            source.onended = null;
            try {
                source.stop();
            } catch {
                /* Already ended. */
            }
            source.disconnect();
            source = undefined;
        }
    }
    function play(track: Track): Promise<boolean> {
        if (disposed) return Promise.resolve(false);
        unlock();
        if (!context || !gain) return Promise.resolve(false);
        if (source && playing === track) return Promise.resolve(true);
        if (loading?.track === track) return loading.promise;
        stop();
        const revision = version;
        const decoder = context;
        const output = gain;
        const current = () => !disposed && revision === version;
        let recording: Promise<AudioBuffer>;
        try {
            const cached = buffers[track];
            if (cached) recording = Promise.resolve(cached);
            else {
                request =
                    typeof view.AbortController === 'function'
                        ? new view.AbortController()
                        : undefined;
                const data = track === 'title' ? ATARI_ST_TITLE : ATARI_ST_GAME_OVER;
                recording = loadRecording({
                    url: new URL('./audio/' + data.file, view.document.baseURI),
                    timing: data,
                    context: decoder,
                    fetcher: view.fetch.bind(view),
                    request: request ? { signal: request.signal } : undefined,
                    isCurrent: current,
                });
            }
        } catch {
            return Promise.resolve(false);
        }
        const promise = recording
            .then((buffer) => {
                if (!current()) return false;
                buffers[track] = buffer;
                const next = decoder.createBufferSource();
                next.buffer = buffer;
                next.loop = track === 'title';
                if (next.loop) {
                    // One silent init tick, then the complete two-phrase driver-state loop.
                    next.loopStart = 876 / 44100;
                    next.loopEnd = 9106234 / 44100;
                }
                next.onended = () => {
                    next.disconnect();
                    if (source === next) {
                        source = undefined;
                        playing = undefined;
                    }
                };
                source = next;
                playing = track;
                next.connect(output);
                next.start();
                if (track === 'game-over') {
                    restoreTimer = view.setTimeout(() => {
                        if (!current()) return;
                        restoreTimer = undefined;
                        void play('title');
                    }, RESTORE_MAIN_MS);
                }
                return true;
            })
            .catch(() => {
                if (current() && source) {
                    source.onended = null;
                    source.disconnect();
                    source = undefined;
                    playing = undefined;
                }
                return false;
            })
            .finally(() => {
                if (loading?.version === revision) {
                    loading = undefined;
                    request = undefined;
                }
            });
        loading = { track, version: revision, promise };
        return promise;
    }
    return {
        unlock,
        playTitle: () => play('title'),
        playGameOver: () => play('game-over'),
        stop,
        setVolume(value: number) {
            volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
            if (gain) gain.gain.value = volume;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            stop();
            delete buffers.title;
            delete buffers['game-over'];
            if (context) void context.close().catch(() => {});
        },
    };
}
export type AtariStSound = ReturnType<typeof createAtariStSound>;
