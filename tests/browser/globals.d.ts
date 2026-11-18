import type {
    AudioRecord,
    AudioSnapshot,
    VirtualGamepad,
    RumbleRecord,
    NavigationRecord,
} from './types.ts';
import type { GameState } from '../../src/types/game.ts';
import type { createInput } from '../../src/input/index.ts';

declare global {
    interface Element {
        webkitRequestFullscreen?: () => Promise<void> | void;
    }
    interface Window {
        __exolonAudio: AudioRecord[];
        __exolonAudioContexts: AudioContext[];
        __exolonAudioGains: GainNode[];
        __exolonAudioDecodes: { done: boolean; ok: boolean }[];
        __exolonResumeWaiters: (() => void)[];
        __exolonAudioSnapshot: () => AudioSnapshot;
        __exolonReleaseResume: () => void;
        __exolonHoldResume: boolean;
        __exolonHidden: boolean;
        __exolonPadHidden: boolean;
        __exolonVirtualPad: VirtualGamepad;
        __exolonVirtualPads: VirtualGamepad[];
        __exolonIntroAdvance: (time: number) => Promise<number>;
        __introHidden: boolean;
        __mobileInput: ReturnType<typeof createInput>;
        __pageShowListeners: () => number;
        __pairState: GameState;
        __splitState: GameState;
        __splitPointer: number;
        __hitRumble: RumbleRecord[];
        __navigationEvents: NavigationRecord[];
    }
}
