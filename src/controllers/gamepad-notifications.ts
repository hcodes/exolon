import type { EventScope } from '../lib/events.ts';
import type { createInput } from '../input/index.ts';
type PadState = ReturnType<ReturnType<typeof createInput>['pollGamepad']>;
interface GamepadNotificationsOptions {
    view: Window;
    notifications: Pick<ReturnType<typeof createNotifications>, 'show'>;
    events: EventScope;
}
import type { createNotifications } from './notifications.ts';

export function createGamepadNotifications({
    view,
    notifications,
    events,
}: GamepadNotificationsOptions) {
    const supported = typeof view.navigator.getGamepads === 'function';
    const connectedGamepads = new Set<string>();
    let previousStatus: PadState['status'] | undefined;
    let polledGamepad: { index: number; id: string } | null = null;
    function announceGamepad(pad: Pick<Gamepad, 'id' | 'index'> | null, connected: boolean) {
        if (!pad || !Number.isInteger(pad.index) || pad.index < 0) return;
        const key = `${pad.index}:${pad.id}`;
        if (connectedGamepads.has(key) === connected) return;
        if (connected) connectedGamepads.add(key);
        else connectedGamepads.delete(key);
        notifications.show(
            `Gamepad ${connected ? 'connected' : 'disconnected'}: ${String(pad.id || 'Controller').slice(0, 80)}`,
        );
    }
    function handleConnection(event: GamepadEvent) {
        announceGamepad(event.gamepad, true);
    }
    function handleDisconnection(event: GamepadEvent) {
        announceGamepad(event.gamepad, false);
    }
    if (supported) {
        events.on(view, 'gamepadconnected', handleConnection);
        events.on(view, 'gamepaddisconnected', handleDisconnection);
    }
    return {
        update(pad: PadState) {
            if (!supported) return;
            if (pad.status !== 'inactive') {
                if (pad.lost && polledGamepad) announceGamepad(polledGamepad, false);
                if (pad.status === 'ready' || pad.status === 'release') {
                    announceGamepad(pad, true);
                    polledGamepad = { index: pad.index, id: pad.id };
                } else polledGamepad = null;
            }
            const messages: Partial<Record<PadState['status'], string>> = {
                unavailable:
                    'Gamepad access is unavailable. Keyboard and on-screen controls are available.',
                nonstandard: 'Nonstandard gamepad layout. Use the keyboard or on-screen controls.',
            };
            const message = messages[pad.status];
            if (message && previousStatus !== pad.status) notifications.show(message);
            previousStatus = pad.status;
        },
    };
}
