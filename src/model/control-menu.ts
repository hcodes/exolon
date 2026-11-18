import type { GameCommands } from '../input/gamepad.ts';

export type ControlAction = keyof GameCommands;
export type ControlPlatform = 'retro' | 'c64' | 'cpc' | 'sharp-mz800';
export interface ControlBinding {
    kind: 'key';
    code: string;
    label: string;
}
export interface ControlProfile {
    device: number;
    bindings: ControlBinding[];
}
export interface ControlMenuSnapshot {
    profiles: Record<ControlPlatform, ControlProfile>;
    focus: number;
    definition?: { platform: ControlPlatform; step: number; labels: string[] };
}
export interface InputConfiguration {
    keys: Record<string, ControlAction[]>;
}
export const CONTROL_ACTIONS: readonly ControlAction[] = ['left', 'right', 'jump', 'duck', 'fire'];
const DEVICES: Record<ControlPlatform, string[]> = {
    retro: ['KEYBOARD', 'INTERFACE 2', 'KEMPSTON'],
    c64: ['KEYBOARD', 'JOYSTICK PORT 1', 'JOYSTICK PORT 2'],
    cpc: [],
    'sharp-mz800': ['KEYBOARD', 'CURSOR', 'JOYSTICK'],
};
const ALIASES = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

export function controlPlatform(mode: string): ControlPlatform {
    return mode === 'c64' || mode === 'cpc' || mode === 'sharp-mz800' ? mode : 'retro';
}
export function controlEntries(mode: string) {
    const platform = controlPlatform(mode);
    return ['START GAME', 'DEFINE KEYS', ...DEVICES[platform]].map((label, index) => ({
        label: `${index + 1} ${label}`,
        row: platform === 'cpc' ? 13 + index * 4 : 11 + index * 2,
    }));
}
function defaults(platform: ControlPlatform): ControlBinding[] {
    return ['KeyO', 'KeyP', 'KeyQ', 'KeyA', platform === 'cpc' ? 'Space' : 'KeyM'].map((code) => ({
        kind: 'key',
        code,
        label: code === 'Space' ? 'SPACE' : code.slice(3),
    }));
}
export function controlInput(snapshot: ControlMenuSnapshot, mode: string): InputConfiguration {
    const platform = controlPlatform(mode),
        profile = snapshot.profiles[platform];
    const result: InputConfiguration = { keys: {} };
    const add = (code: string, action: ControlAction) => (result.keys[code] ||= []).push(action);
    // Platform menus are presentation preferences. All current input devices
    // remain available, and Define Keys changes only the keyboard bindings.
    profile.bindings.forEach((binding, index) => add(binding.code, CONTROL_ACTIONS[index]));
    ALIASES.forEach((code, index) => {
        if (!result.keys[code]) add(code, CONTROL_ACTIONS[index]);
    });
    if (profile.bindings[4].code === 'Space' && !result.keys.KeyM) add('KeyM', 'fire');
    return result;
}

export function createControlMenu() {
    const profiles: ControlMenuSnapshot['profiles'] = {
        retro: { device: 0, bindings: defaults('retro') },
        c64: { device: 0, bindings: defaults('c64') },
        cpc: { device: 0, bindings: defaults('cpc') },
        'sharp-mz800': { device: 1, bindings: defaults('sharp-mz800') },
    };
    let focus = 0;
    let definition:
        | {
              platform: ControlPlatform;
              mode: string;
              bindings: ControlBinding[];
              waiting: string | null;
              held: Set<string>;
          }
        | undefined;
    function capture(binding: ControlBinding, token: string) {
        if (!definition) return;
        definition.held.add(token);
        if (definition.waiting || definition.bindings.length >= 5) return;
        definition.bindings.push(binding);
        definition.waiting = token;
    }
    return {
        get snapshot(): ControlMenuSnapshot {
            return {
                profiles: Object.fromEntries(
                    Object.entries(profiles).map(([key, value]) => [
                        key,
                        {
                            device: value.device,
                            bindings: value.bindings.map((binding) => ({ ...binding })),
                        },
                    ]),
                ) as ControlMenuSnapshot['profiles'],
                focus,
                ...(definition
                    ? {
                          definition: {
                              platform: definition.platform,
                              step: Math.min(
                                  4,
                                  definition.bindings.length - Number(Boolean(definition.waiting)),
                              ),
                              labels: Array.from(
                                  { length: 5 },
                                  (_, index) => definition?.bindings[index]?.label || '',
                              ),
                          },
                      }
                    : {}),
            };
        },
        move(mode: string, direction: number) {
            const count = controlEntries(mode).length;
            focus = (((focus + direction) % count) + count) % count;
        },
        activate(mode: string, digit = focus + 1): 'start' | 'changed' | null {
            if (
                definition ||
                !Number.isInteger(digit) ||
                digit < 1 ||
                digit > controlEntries(mode).length
            )
                return null;
            const platform = controlPlatform(mode);
            focus = digit - 1;
            if (digit === 1) return 'start';
            if (digit === 2)
                definition = { platform, mode, bindings: [], waiting: null, held: new Set() };
            else profiles[platform].device = digit - 3;
            return 'changed';
        },
        captureKey(code: string, label: string) {
            capture(
                {
                    kind: 'key',
                    code,
                    label:
                        label
                            .toUpperCase()
                            .replace(/[^ -Z]/g, '')
                            .slice(0, 12) || 'KEY',
                },
                code,
            );
        },
        release(token: string) {
            if (
                !definition ||
                !definition.held.delete(token) ||
                definition.held.size ||
                !definition.waiting
            )
                return false;
            definition.waiting = null;
            if (definition.bindings.length === 5) {
                const cheat =
                    ['retro', 'cpc', 'sharp-mz800'].includes(definition.mode) &&
                    definition.bindings.map((binding) => binding.label).join('') === 'ZORBA';
                profiles[definition.platform] = { device: 0, bindings: definition.bindings };
                definition = undefined;
                return cheat ? 'cheat' : true;
            }
            return false;
        },
        cancel() {
            definition = undefined;
            focus = 0;
        },
    };
}
