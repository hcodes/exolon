import { versionAssetUrl } from '../services/asset-url.ts';
import { loadRecording, type RecordingTiming } from '../audio/recordings.ts';
export interface RecordedAudioBank {
    gameOverTiming?: RecordingTiming;
    effects: Readonly<Record<string, URL>>;
    gameOver?: URL;
}
export interface TitleRecording {
    kind: string;
    file: string;
    timing?: RecordingTiming;
    label: string;
    title: string;
}
export interface AudioEvent {
    type: string;
    supply?: string;
}
type SoundMode = 'c64' | 'cpc' | 'gameboy' | 'sharp-mz800' | 'retro' | 'remastered';

import { decodeEffect } from '../audio/decode.ts';
import { renderAy } from '../audio/synthesize.ts';
import { renderRemasteredEffect } from '../audio/remastered.ts';
import { C64_AUDIO } from '../audio/c64/manifest.js';
import { CPC_AUDIO } from '../audio/cpc/manifest.js';
import { GAMEBOY_AUDIO } from '../audio/gameboy/manifest.js';
import { SHARP_AUDIO } from '../audio/sharp-mz800/manifest.js';
import {
    C64_TITLE,
    CPC_TITLE,
    GAMEBOY_TITLE,
    SHARP_MZ800_TITLE,
} from '../audio/compressed/recordings.ts';

const RECORDED_BANKS: Partial<Record<string, RecordedAudioBank>> = {
    c64: C64_AUDIO,
    cpc: CPC_AUDIO,
    gameboy: GAMEBOY_AUDIO,
    'sharp-mz800': SHARP_AUDIO,
};
// Original ZX Game Over and ZORBA both play musicGameOver at $7d68.
const ZX_BEEPER_AUDIO: RecordedAudioBank = {
    effects: {},
    gameOver: new URL('../audio/zx-spectrum/cheat-enabled.wav', import.meta.url),
};

export const TITLE_RECORDINGS: readonly TitleRecording[] = [
    {
        kind: 'sharp-mz800',
        file: SHARP_MZ800_TITLE.file,
        timing: SHARP_MZ800_TITLE,
        label: 'Original Sharp MZ-800',
        title: 'Original Exolon music · Sharp MZ-800 (Datelsoft)',
    },
    {
        kind: 'gameboy',
        file: GAMEBOY_TITLE.file,
        timing: GAMEBOY_TITLE,
        label: 'Game Boy · stylized',
        title: 'Exolon · Game Boy chiptune',
    },
    {
        kind: 'cpc',
        file: CPC_TITLE.file,
        timing: CPC_TITLE,
        label: 'Original Amstrad CPC',
        title: 'Original Exolon music · Amstrad CPC',
    },
    {
        kind: 'c64',
        file: C64_TITLE.file,
        timing: C64_TITLE,
        label: 'Original Commodore 64',
        title: 'Original Exolon music · Commodore 64',
    },
    { kind: 'ambient', file: 'title-ambient.m4a', label: 'Ambient', title: 'Exolon · Ambient' },
    {
        kind: 'original',
        file: 'title-128k.mp3',
        label: 'Original ZX Spectrum 128K',
        title: 'Original Exolon music · ZX Spectrum 128K',
    },
];

export function createAudio({
    graphicsMode: initialMode = 'retro',
    context: unlockedContext,
}: { graphicsMode?: string; context?: AudioContext } = {}) {
    let context: AudioContext | undefined = unlockedContext;
    let master: GainNode | undefined;
    let music: AudioBufferSourceNode | undefined;
    let musicBuffer: AudioBuffer | undefined;
    let musicLoading: Promise<void> | undefined;
    let musicInfo: TitleRecording | undefined;
    const soundMode = (value: string): SoundMode =>
        value === 'gameboy-color'
            ? 'gameboy'
            : RECORDED_BANKS[value]
              ? (value as SoundMode)
              : ['remastered', 'split'].includes(value)
                ? 'remastered'
                : 'retro';
    const titleKind = (mode: string) =>
        RECORDED_BANKS[mode] ? mode : mode === 'remastered' ? 'ambient' : 'original';
    let graphicsMode = soundMode(initialMode);
    let selectedMusic = titleKind(graphicsMode);
    let musicGeneration = 0;
    let destroyed = false;
    let volume = 0.35;
    const nodes = new Set<AudioBufferSourceNode>();
    const effects = new Map<SoundMode, Map<string, AudioBuffer>>();
    const effectLoading = new Map<SoundMode, Promise<unknown>>(),
        sampleCache = new Map<string, Promise<AudioBuffer>>();
    let effectGeneration = 0,
        pendingEffects = 0;
    let cheatGeneration = 0;
    let cheatSound: AudioBufferSourceNode | undefined;

    async function decode(bytes: ArrayBuffer, currentContext = context): Promise<AudioBuffer> {
        return new Promise<AudioBuffer>((resolve, reject) => {
            if (!currentContext) {
                reject(new Error('Audio context unavailable'));
                return;
            }
            const result = currentContext.decodeAudioData(bytes, resolve, reject);
            if (result && typeof result.catch === 'function') void result.catch(reject);
        });
    }
    function recordedSample(
        url: URL,
        isCurrent: () => boolean = () => !destroyed,
        timing?: RecordingTiming,
    ) {
        const key = String(url);
        if (!sampleCache.has(key)) {
            const currentContext = context;
            const loading = currentContext
                ? loadRecording({
                      url,
                      timing,
                      context: currentContext,
                      isCurrent: () => !destroyed && isCurrent(),
                  })
                : Promise.reject<AudioBuffer>(new Error('Audio context unavailable'));
            sampleCache.set(key, loading);
            void loading.catch(() => {
                if (sampleCache.get(key) === loading) sampleCache.delete(key);
            });
        }
        return sampleCache.get(key)!;
    }

    function prepareEffects() {
        if (!context) return;
        if (effects.has(graphicsMode)) return;
        if (RECORDED_BANKS[graphicsMode]) {
            const mode = graphicsMode,
                source = RECORDED_BANKS[mode]!,
                bank = new Map<string, AudioBuffer>();
            effects.set(mode, bank);
            const recordings = {
                ...source.effects,
                ...(source.gameOver ? { 'game-over': source.gameOver } : {}),
            };
            const loading = Promise.all(
                Object.entries(recordings).map(async ([name, url]) => {
                    try {
                        const buffer = await recordedSample(
                            url,
                            undefined,
                            name === 'game-over' ? source.gameOverTiming : undefined,
                        );
                        if (!destroyed) bank.set(name, buffer);
                    } catch {
                        /* Other effects remain available. */
                    }
                }),
            ).finally(() => effectLoading.delete(mode));
            effectLoading.set(mode, loading);
            return;
        }
        const bank = new Map<string, AudioBuffer>();
        const names = [
            'shot',
            'grenade',
            'explosion',
            'enemy-destroyed',
            'rocket',
            'teleport',
            'refill-ammo',
            'refill-grenades',
        ];
        if (graphicsMode === 'remastered') names.push('turret', 'mine', 'death', 'suit');
        for (const name of names) {
            const pcm =
                graphicsMode === 'remastered'
                    ? renderRemasteredEffect(name, context.sampleRate)
                    : [renderAy(decodeEffect(name), context.sampleRate)];
            if (!pcm) continue;
            const buffer = context.createBuffer(pcm.length, pcm[0].length, context.sampleRate);
            pcm.forEach((channel, index) => buffer.getChannelData(index).set(channel));
            bank.set(name, buffer);
        }
        if (graphicsMode === 'retro') {
            bank.set('turret', bank.get('explosion')!);
            bank.set('mine', bank.get('explosion')!);
            bank.set('death', bank.get('explosion')!);
            bank.set('suit', bank.get('refill-ammo')!);
        }
        effects.set(graphicsMode, bank);
    }

    async function prepareMusic() {
        if (musicBuffer) return;
        if (!musicLoading) {
            const currentContext = context;
            const generation = musicGeneration;
            const recordings = RECORDED_BANKS[selectedMusic]
                ? TITLE_RECORDINGS.filter((recording) => recording.kind === selectedMusic)
                : selectedMusic === 'ambient'
                  ? TITLE_RECORDINGS.filter((recording) =>
                        ['ambient', 'original'].includes(recording.kind),
                    )
                  : TITLE_RECORDINGS.slice(
                        TITLE_RECORDINGS.findIndex((recording) => recording.kind === selectedMusic),
                    );
            musicLoading = (async () => {
                for (const recording of recordings) {
                    if (destroyed || generation !== musicGeneration) return;
                    try {
                        const url = new URL(`../audio/${recording.file}`, import.meta.url);
                        let buffer;
                        if (RECORDED_BANKS[recording.kind])
                            buffer = await recordedSample(
                                url,
                                () => selectedMusic === recording.kind,
                                recording.timing,
                            );
                        else {
                            const response = await fetch(new URL(versionAssetUrl(url)));
                            if (!response.ok) continue;
                            buffer = await decode(await response.arrayBuffer(), currentContext);
                        }
                        if (!destroyed && generation === musicGeneration) {
                            musicBuffer = buffer;
                            musicInfo = recording;
                        }
                        return;
                    } catch {
                        /* Only the active ambient/original alternatives may be tried. */
                    }
                }
                throw new Error('Exolon title music is unavailable.');
            })();
        }
        const loading = musicLoading;
        try {
            await loading;
        } finally {
            if (musicLoading === loading) musicLoading = undefined;
        }
    }

    function play(buffer: AudioBuffer, loop = false) {
        if (!context || !master || context.state !== 'running' || destroyed) return undefined;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = loop;
        source.connect(master);
        source.onended = () => {
            nodes.delete(source);
            source.disconnect();
            if (music === source) music = undefined;
        };
        nodes.add(source);
        source.start();
        return source;
    }

    function stopSource(source: AudioBufferSourceNode) {
        try {
            source.stop();
        } catch {
            /* The source may already have ended. */
        }
        source.disconnect();
        nodes.delete(source);
    }

    function stopMusic() {
        if (music) stopSource(music);
        music = undefined;
    }

    function stop() {
        effectGeneration++;
        stopCheatConfirmation();
        stopMusic();
        for (const source of nodes) stopSource(source);
    }

    function stopCheatConfirmation() {
        cheatGeneration++;
        if (cheatSound) stopSource(cheatSound);
        cheatSound = undefined;
    }

    async function playCheatConfirmation(mode: string) {
        stopCheatConfirmation();
        if (
            destroyed ||
            !context ||
            context.state !== 'running' ||
            volume === 0 ||
            (mode !== 'retro' && mode !== 'cpc')
        )
            return false;
        const generation = cheatGeneration;
        const current = () => !destroyed && generation === cheatGeneration;
        try {
            const buffer = await recordedSample(
                mode === 'cpc' ? CPC_AUDIO.gameOver : ZX_BEEPER_AUDIO.gameOver!,
                undefined,
                mode === 'cpc' ? CPC_AUDIO.gameOverTiming : undefined,
            );
            if (!current() || volume === 0) return false;
            cheatSound = play(buffer);
            return Boolean(cheatSound);
        } catch {
            return false;
        }
    }

    return {
        // Gesture unlock waits for resume; autoplay returns the current state
        // without waiting on a browser permission gate. onReady also reports a
        // later successful autoplay resume; music loads separately.
        async unlock({
            autoplay = false,
            onReady,
        }: { autoplay?: boolean; onReady?: () => unknown } = {}) {
            try {
                if (typeof window === 'undefined' || destroyed) return false;
                const Audio = window.AudioContext || window.webkitAudioContext;
                if (!Audio) return false;
                if (!context) {
                    context = new Audio();
                }
                if (!master) {
                    master = context.createGain();
                    master.gain.value = volume;
                    master.connect(context.destination);
                }
                const currentContext = context;
                const resumed = currentContext.resume();
                if (autoplay) {
                    void Promise.resolve(resumed)
                        .then(() => {
                            if (
                                !destroyed &&
                                context === currentContext &&
                                currentContext.state === 'running' &&
                                typeof onReady === 'function'
                            )
                                return onReady();
                        })
                        .catch(() => {});
                } else await resumed;
                if (context.state !== 'running' || destroyed) return false;
                prepareEffects();
                return !destroyed && context.state === 'running';
            } catch {
                return false;
            }
        },
        // Loading also works while suspended, never starts playback, and cannot
        // delay effect readiness.
        async loadMusic() {
            if (!context || destroyed) return false;
            const generation = musicGeneration;
            try {
                await prepareMusic();
                return !destroyed && generation === musicGeneration && Boolean(musicBuffer);
            } catch {
                return false;
            }
        },
        // Idempotent; requires running audio and a successful loadMusic().
        startMusic() {
            if (music) return true;
            if (!musicBuffer) return false;
            music = play(musicBuffer, true);
            return Boolean(music);
        },
        get musicInfo() {
            return musicInfo ? { ...musicInfo } : null;
        },
        get selectedMusic() {
            return selectedMusic;
        },
        selectMusic(kind: string) {
            if (destroyed || !TITLE_RECORDINGS.some((recording) => recording.kind === kind))
                return false;
            if (selectedMusic === kind) return true;
            stopMusic();
            selectedMusic = kind;
            musicGeneration++;
            musicBuffer = undefined;
            musicLoading = undefined;
            musicInfo = undefined;
            return true;
        },
        setGraphicsMode(value: string) {
            const nextMode = soundMode(value);
            if (destroyed || graphicsMode === nextMode) return;
            stop();
            graphicsMode = nextMode;
            this.selectMusic(titleKind(graphicsMode));
            if (context) prepareEffects();
        },
        stopMusic,
        stopCheatConfirmation,
        playCheatConfirmation,
        handle(events: readonly AudioEvent[]) {
            for (const event of events) {
                const name = event.type === 'refill' ? `refill-${event.supply}` : event.type;
                const buffer = effects.get(graphicsMode)?.get(name);
                const bank =
                    graphicsMode === 'retro' ? ZX_BEEPER_AUDIO : RECORDED_BANKS[graphicsMode];
                if (buffer) play(buffer);
                else if (
                    bank &&
                    (graphicsMode === 'retro' || effectLoading.has(graphicsMode)) &&
                    context?.state === 'running' &&
                    pendingEffects < 16 &&
                    (bank.effects[name] || (name === 'game-over' && bank.gameOver))
                ) {
                    const generation = effectGeneration,
                        mode = graphicsMode,
                        queuedAt = context.currentTime || 0;
                    pendingEffects++;
                    const url = (name === 'game-over' ? bank.gameOver : bank.effects[name])!;
                    void recordedSample(
                        url,
                        undefined,
                        name === 'game-over' ? bank.gameOverTiming : undefined,
                    ).then(
                        (loaded) => {
                            pendingEffects--;
                            if (
                                !destroyed &&
                                volume > 0 &&
                                graphicsMode === mode &&
                                generation === effectGeneration &&
                                ((mode === 'retro' && name === 'game-over') ||
                                    (context?.currentTime || 0) - queuedAt < 1)
                            ) {
                                play(loaded);
                            }
                        },
                        () => {
                            pendingEffects--;
                        },
                    );
                }
            }
        },
        setVolume(value: number) {
            volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
            if (master) master.gain.value = volume;
        },
        stop,
        destroy() {
            destroyed = true;
            stop();
            effects.clear();
            effectLoading.clear();
            sampleCache.clear();
            musicBuffer = undefined;
            musicInfo = undefined;
            if (context) void context.close().catch(() => {});
        },
    };
}
