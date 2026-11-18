export interface HapticActuator {
    effects?: readonly string[];
    type?: string;
    playEffect?: (
        type: 'dual-rumble',
        parameters: {
            startDelay: number;
            duration: number;
            weakMagnitude: number;
            strongMagnitude: number;
        },
    ) => unknown;
    pulse?: (intensity: number, duration: number) => unknown;
    reset?: () => unknown;
}
export interface HapticGamepad {
    connected?: boolean;
    index: number;
    id: string;
    vibrationActuator?: HapticActuator | null;
    hapticActuators?: readonly HapticActuator[];
}
export interface HapticEvent {
    type: string;
    weapon?: string;
}
type ActuatorChoice = { actuator: HapticActuator | null; mode: 'dual' | 'pulse' | null };

// Optional Gamepad haptics: https://www.w3.org/TR/gamepad/#gamepadhapticactuator-interface
const PROFILES = {
    bullet: { duration: 55, weakMagnitude: 0.2, strongMagnitude: 0.08 },
    rocket: { duration: 140, weakMagnitude: 0.5, strongMagnitude: 0.4 },
};
function safely(action: () => unknown) {
    try {
        Promise.resolve(action()).catch(() => {});
    } catch {
        /* Optional hardware may reject an effect. */
    }
}
function choose(pad: HapticGamepad): ActuatorChoice {
    const actuators = [pad.vibrationActuator, ...Array.from(pad.hapticActuators || [])].filter(
        (item): item is HapticActuator => Boolean(item),
    );
    for (const actuator of actuators) {
        const dual =
            actuator.effects === undefined
                ? !actuator.type || actuator.type === 'dual-rumble'
                : Array.from(actuator.effects).includes('dual-rumble');
        if (dual && typeof actuator.playEffect === 'function') return { actuator, mode: 'dual' };
        if (typeof actuator.pulse === 'function') return { actuator, mode: 'pulse' };
    }
    return { actuator: null, mode: null };
}
export function createGamepadHaptics(now = () => globalThis.performance.now()) {
    let key: string | null = null,
        actuator: HapticActuator | null = null,
        mode: ActuatorChoice['mode'] = null,
        until = 0,
        priority = 0;
    function stop() {
        const current = actuator;
        if (current && until)
            safely(() => {
                if (typeof current.reset === 'function') return current.reset();
                if (mode === 'pulse') return current.pulse?.(0, 0);
                return current.playEffect?.('dual-rumble', {
                    startDelay: 0,
                    duration: 0,
                    weakMagnitude: 0,
                    strongMagnitude: 0,
                });
            });
        until = 0;
        priority = 0;
    }
    return {
        setGamepad(pad: HapticGamepad | null) {
            try {
                const next = pad?.connected ? `${pad.index}:${pad.id}` : null;
                if (next !== key) stop();
                key = next;
                ({ actuator, mode } = next && pad ? choose(pad) : { actuator: null, mode: null });
            } catch {
                stop();
                key = null;
                actuator = null;
                mode = null;
            }
        },
        handle(events: readonly HapticEvent[]) {
            const current = actuator;
            if (!current) return;
            const impacts = events.filter((event) => event.type === 'hit');
            const weapon = impacts.some((event) => event.weapon === 'rocket')
                ? 'rocket'
                : impacts.some((event) => event.weapon === 'bullet')
                  ? 'bullet'
                  : null;
            if (!weapon) return;
            const level = weapon === 'rocket' ? 2 : 1,
                time = now();
            if (time < until && level <= priority) return;
            const profile = PROFILES[weapon];
            until = time + profile.duration;
            priority = level;
            safely(() =>
                mode === 'dual'
                    ? current.playEffect?.('dual-rumble', { startDelay: 0, ...profile })
                    : current.pulse?.(profile.weakMagnitude, profile.duration),
            );
        },
        stop,
    };
}
