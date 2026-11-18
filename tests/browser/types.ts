import type { Page } from 'playwright';
import type { Cheats } from '../../src/types/game.ts';
import type { HapticActuator } from '../../src/input/haptics.ts';

export interface AudioDetails {
    peak: number;
    channels: number;
    sampleRate: number;
    rms: [number, number];
    stereoDifference: number;
}
export interface AudioRecord {
    started: boolean;
    stopped: boolean;
    ended: boolean;
    loop: boolean;
    duration: number;
    peak: number;
    context: number;
    startedAt: number;
    channels?: number;
    sampleRate?: number;
    rms?: [number, number];
    stereoDifference?: number;
}
export interface AudioSnapshot {
    loops: number;
    active: number;
    audible: number;
    effects: number;
    states: AudioContextState[];
    gain: number | null;
    decoded: boolean;
    waitingResumes: number;
    activated: boolean;
    musicButton: boolean;
    status: string;
    title: boolean;
    track: ({ duration: number } & AudioDetails) | null;
    timedOut?: boolean;
}
export interface VirtualGamepad {
    id: string;
    index: number;
    connected: boolean;
    mapping: string;
    axes: number[];
    buttons: { pressed: boolean; value: number }[];
    vibrationActuator?: HapticActuator | null;
}
export interface RumbleRecord {
    type: string;
    duration?: number;
    startDelay?: number;
    weakMagnitude?: number;
    strongMagnitude?: number;
}
export interface NavigationRecord {
    type: string;
    code?: string;
    native: boolean;
    focus: boolean;
    status: string | null | undefined;
}
export interface BrowserHelpers {
    prepare(page: Page): Promise<void>;
    padFrames(page: Page, count?: number): Promise<void>;
    waitForPlaying(page: Page): Promise<void>;
    overlayOpen(page: Page): Promise<boolean>;
    chooseCheats(page: Page, options: boolean | Partial<Cheats>, touch?: boolean): Promise<void>;
    expectMusic(page: Page, label: string, kind?: string): Promise<AudioSnapshot>;
}
