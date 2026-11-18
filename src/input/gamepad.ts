import type { HapticEvent, HapticGamepad } from './haptics.ts';
import { createGamepadHaptics } from './haptics.ts';
export interface GamepadDevice extends HapticGamepad {
    mapping?: string;
    axes?: readonly number[];
    buttons?: readonly { pressed?: boolean; value: number }[];
}
export interface GamepadNavigator {
    getGamepads?: () => ArrayLike<GamepadDevice | null> | null;
}
export type GameCommands = {
    left: boolean;
    right: boolean;
    jump: boolean;
    duck: boolean;
    fire: boolean;
};
export type GamepadActions = {
    launchRocket: boolean;
    confirm: boolean;
    pause: boolean;
    back: boolean;
    scores: boolean;
    previousMusic: boolean;
};
export type GamepadStatus =
    'inactive' | 'unsupported' | 'waiting' | 'nonstandard' | 'unavailable' | 'ready' | 'release';
// Standard Gamepad mapping: https://www.w3.org/TR/gamepad/#remapping
const commands = (): GameCommands => ({
    left: false,
    right: false,
    jump: false,
    duck: false,
    fire: false,
});
const actions = (): GamepadActions => ({
    launchRocket: false,
    confirm: false,
    pause: false,
    back: false,
    scores: false,
    previousMusic: false,
});
const any = (state: GameCommands | GamepadActions) => Object.values(state).some(Boolean);
const down = (pad: GamepadDevice, index: number) =>
    Boolean(
        pad.buttons?.[index]?.pressed ||
        (Number.isFinite(pad.buttons?.[index]?.value) && pad.buttons![index].value >= 0.5),
    );
const axis = (pad: GamepadDevice, index: number) =>
    Number.isFinite(pad.axes?.[index]) ? Math.max(-1, Math.min(1, pad.axes![index])) : 0;

function read(pad: GamepadDevice) {
    const dpadX = down(pad, 14) || down(pad, 15);
    const dpadY = down(pad, 12) || down(pad, 13);
    const x = dpadX ? Number(down(pad, 15)) - Number(down(pad, 14)) : axis(pad, 0);
    const y = dpadY ? Number(down(pad, 13)) - Number(down(pad, 12)) : axis(pad, 1);
    return {
        navigation: { x: x < -0.25 ? -1 : x > 0.25 ? 1 : 0, y: y < -0.25 ? -1 : y > 0.25 ? 1 : 0 },
        commands: {
            left: x < -0.25,
            right: x > 0.25,
            jump: y < -0.25 || down(pad, 0),
            duck: y > 0.25 || down(pad, 1),
            fire: down(pad, 2) || down(pad, 5),
        },
        buttons: {
            launchRocket: down(pad, 7),
            confirm: down(pad, 0),
            pause: down(pad, 9),
            back: down(pad, 1),
            scores: down(pad, 3),
            previousMusic: down(pad, 4),
        },
    };
}

export function createGamepadInput(
    navigatorObject: GamepadNavigator | undefined = globalThis.navigator,
) {
    const haptics = createGamepadHaptics();
    let key: string | null = null,
        id = '',
        index = -1,
        armed = false,
        previous = actions();
    function reset() {
        armed = false;
        previous = actions();
        haptics.stop();
    }
    function state(
        status: GamepadStatus,
        lost = false,
        held = commands(),
        pressed = actions(),
        navigation = { x: 0, y: 0 },
    ) {
        return {
            status,
            id,
            index,
            lost,
            commands: held,
            pressed,
            activity: any(held) || any(pressed),
            navigation,
        };
    }
    function unavailable(status: GamepadStatus) {
        const lost = key !== null;
        haptics.setGamepad(null);
        key = null;
        id = '';
        index = -1;
        reset();
        return state(status, lost);
    }
    return {
        poll(enabled = true) {
            if (!enabled) {
                reset();
                haptics.setGamepad(null);
                return state('inactive');
            }
            try {
                if (typeof navigatorObject?.getGamepads !== 'function')
                    return unavailable('unsupported');
                const connected = Array.from(navigatorObject.getGamepads() || []).filter(
                    (pad): pad is GamepadDevice => pad?.connected === true,
                );
                const pads = connected.filter(
                    (pad) =>
                        pad.mapping === 'standard' && Number.isInteger(pad.index) && pad.index >= 0,
                );
                pads.sort((a, b) => a.index - b.index);
                const identity = (pad: GamepadDevice) => `${pad.index}:${pad.id}`;
                let pad = pads.find((pad) => identity(pad) === key);
                const lost = key !== null && !pad;
                if (!pad)
                    pad =
                        pads.find((pad) => {
                            const input = read(pad);
                            return any(input.commands) || any(input.buttons);
                        }) || pads[0];
                if (!pad) {
                    haptics.setGamepad(null);
                    key = null;
                    id = '';
                    index = -1;
                    reset();
                    return state(
                        connected.length && !pads.length ? 'nonstandard' : 'waiting',
                        lost,
                    );
                }
                if (key !== identity(pad)) {
                    key = identity(pad);
                    id = String(pad.id || 'Gamepad');
                    index = pad.index;
                    reset();
                }
                haptics.setGamepad(pad);
                const input = read(pad);
                if (!armed) {
                    armed = !any(input.commands) && !any(input.buttons);
                    previous = input.buttons;
                    return state(armed ? 'ready' : 'release', lost);
                }
                const pressed = actions();
                for (const action of Object.keys(pressed) as (keyof GamepadActions)[])
                    pressed[action] = input.buttons[action] && !previous[action];
                previous = input.buttons;
                return state('ready', lost, input.commands, pressed, input.navigation);
            } catch {
                return unavailable('unavailable');
            }
        },
        handleEvents(events: readonly HapticEvent[]) {
            if (armed) haptics.handle(events);
        },
        reset,
    };
}
