import { AMIGA_TITLE } from '../../../audio/compressed/recordings.ts';
import { loadRecording } from '../../../audio/recordings.ts';
// The original sample track is recovered offline; no 68000/Paula emulator runs here.
export function createAmigaSound(view: Window & typeof globalThis) {
    let context: AudioContext | undefined;
    let gain: GainNode | undefined;
    let source: AudioBufferSourceNode | undefined;
    let loading: Promise<AudioBuffer | null> | undefined;
    let request: AbortController | undefined;
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
            // Called directly by the banner handler, before any asynchronous work.
            if (context?.state === 'suspended') void context.resume().catch(() => {});
        } catch {
            /* Sound is optional; input and gameplay remain available. */
        }
    }
    function stop() {
        version++;
        if (source) {
            try {
                source.stop();
            } catch {
                /* Already stopped. */
            }
            source.disconnect();
            source = undefined;
        }
    }
    async function playTitle() {
        if (disposed) return false;
        unlock();
        if (!context || !gain) return false;
        if (source) return true;
        const revision = ++version;
        if (!loading) {
            const decoder = context;
            request =
                typeof view.AbortController === 'function' ? new view.AbortController() : undefined;
            loading = loadRecording({
                url: new URL('./audio/' + AMIGA_TITLE.file, view.document.baseURI),
                timing: AMIGA_TITLE,
                context: decoder,
                fetcher: view.fetch.bind(view),
                request: request ? { signal: request.signal } : undefined,
                isCurrent: () => !disposed,
            }).catch(() => {
                loading = undefined;
                return null;
            });
        }
        const buffer = await loading;
        if (disposed || revision !== version || !buffer) return false;
        try {
            source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(gain);
            source.start();
            return true;
        } catch {
            source = undefined;
            return false;
        }
    }
    return {
        unlock,
        playTitle,
        stop,
        setVolume(value: number) {
            volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
            if (gain) gain.gain.value = volume;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            request?.abort();
            stop();
            loading = undefined;
            if (context) void context.close().catch(() => {});
        },
    };
}
export type AmigaSound = ReturnType<typeof createAmigaSound>;
