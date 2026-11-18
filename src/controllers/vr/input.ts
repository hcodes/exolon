import type { InputCommands } from '../../types/game.ts';

export interface XrControllerSource {
    handedness: string;
    tracked?: boolean;
    gamepad?: {
        mapping: string;
        axes: readonly number[];
        buttons: readonly { pressed: boolean; value: number }[];
    } | null;
}

const button = (source: XrControllerSource | undefined, index: number) => {
    const value = source?.gamepad?.buttons[index];
    return Boolean(value?.pressed || (Number.isFinite(value?.value) && value!.value > 0.5));
};
function stick(source: XrControllerSource | undefined, vertical = false) {
    const axes = source?.gamepad?.axes;
    const index = (axes && axes.length >= 4 ? 2 : 0) + Number(vertical);
    const value = axes?.[index];
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0;
}

export function createXrInput() {
    let armed = false;
    let previousPause = false;
    let previousConfirm = false;
    let previousRocket = false;
    let previousFire = false;
    let rocketPending = false;
    let firePending = false;
    let heldFire = false;
    let commands: InputCommands = {};
    let previousHands = '';
    function reset() {
        armed = false;
        previousPause = false;
        previousConfirm = false;
        previousRocket = false;
        previousFire = false;
        rocketPending = false;
        firePending = false;
        heldFire = false;
        commands = {};
    }
    function mappedSources(sources: readonly XrControllerSource[]) {
        return sources.filter((source) => source.gamepad?.mapping === 'xr-standard');
    }
    function signature(sources: readonly XrControllerSource[]) {
        return sources
            .map((source) => source.handedness + (source.tracked === false ? '!' : ''))
            .sort()
            .join(',');
    }
    return {
        reset,
        consumeCommands(): InputCommands {
            const result = { ...commands };
            rocketPending = false;
            firePending = false;
            commands = { ...commands, fire: heldFire, firePressed: false, rocket: false };
            return result;
        },
        consumeSelect(sources: readonly XrControllerSource[]) {
            const mapped = mappedSources(sources);
            const accepted =
                armed &&
                mapped.length > 0 &&
                mapped.every((source) => source.tracked !== false) &&
                signature(mapped) === previousHands;
            reset();
            return accepted;
        },
        sample(sources: readonly XrControllerSource[]) {
            const mapped = mappedSources(sources);
            const hands = signature(mapped);
            const changed = hands !== previousHands;
            const lost = previousHands !== '' && changed;
            previousHands = hands;
            if (changed) reset();
            const left = mapped.find((source) => source.handedness === 'left') ?? mapped[0];
            const right = mapped.find((source) => source.handedness === 'right');
            const x = stick(left),
                y = stick(left, true);
            const fire = button(right, 5),
                rocket = button(right, 0),
                jump = button(right, 4);
            const pause = button(
                mapped.find((source) => source.handedness === 'left'),
                5,
            );
            const connected =
                mapped.length > 0 && mapped.every((source) => source.tracked !== false);
            if (!connected) reset();
            const neutral =
                connected &&
                mapped.every(
                    (source) =>
                        Math.abs(stick(source)) < 0.25 &&
                        Math.abs(stick(source, true)) < 0.25 &&
                        // Squeeze, touchpad and stick-click have no action in this
                        // game. Holding a Quest grip must not lock out movement.
                        ![0, 4, 5].some((index) => button(source, index)),
                );
            // A disconnect frame cannot also rearm the surviving controller.
            if (mapped.length && neutral && !lost) armed = true;
            if (armed && rocket && !previousRocket) rocketPending = true;
            if (armed && fire && !previousFire) firePending = true;
            heldFire = armed && fire;
            // XR can render several times between 30 Hz simulation steps.
            // Retain short weapon presses until the simulation consumes them.
            commands = {
                left: armed && x < -0.25,
                right: armed && x > 0.25,
                jump: armed && (y < -0.25 || jump),
                duck: armed && y > 0.25,
                fire: heldFire || firePending,
                firePressed: firePending,
                chargeRocket: false,
                rocket: rocketPending,
            };
            const edge = armed && pause && !previousPause;
            const confirm = armed && jump && !previousConfirm;
            previousPause = pause;
            previousConfirm = jump;
            previousRocket = rocket;
            previousFire = fire;
            return { commands, pause: edge, confirm, connected, lost, armed };
        },
    };
}
