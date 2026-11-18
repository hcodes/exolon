import type { GameCommands } from './gamepad.ts';
import type { HapticEvent } from './haptics.ts';
import type { ScopedPointerEvent } from '../lib/events.ts';
type Action = keyof GameCommands;
type TouchAction = Action | 'rocket';
type ActionButton = HTMLElement & { dataset: DOMStringMap & { action: TouchAction } };
interface TouchPointer {
    action?: TouchAction;
    directions?: Action[];
    x?: number;
    y?: number;
    seen: boolean;
}
import { createGamepadInput } from './gamepad.ts';
import { createEventScope } from '../lib/events.ts';
import type { InputConfiguration } from '../model/control-menu.ts';

const BINDINGS: Record<string, Action> = {
    ArrowLeft: 'left',
    KeyO: 'left',
    ArrowRight: 'right',
    KeyP: 'right',
    ArrowUp: 'jump',
    KeyQ: 'jump',
    ArrowDown: 'duck',
    KeyA: 'duck',
    Space: 'fire',
    KeyM: 'fire',
};

export function createInput(target: Window, controls: HTMLElement) {
    let bindings: Record<string, Action[]> = Object.fromEntries(
        Object.entries(BINDINGS).map(([code, action]) => [code, [action]]),
    );
    const keys = new Set<string>();
    const pointers = new Map<number, TouchPointer>();
    const captures = new Map<number, HTMLElement>();
    const stick = controls.querySelector?.<HTMLElement>('[data-stick]');
    const thumb = controls.querySelector?.<HTMLElement>('[data-stick-thumb]');
    let stickOwner: number | null = null;
    const taps = new Set<TouchAction>();
    const remote = new Map<Action, { seen: boolean }>();
    const remoteTaps = new Set<Action>();
    const gamepad = createGamepadInput(target.navigator);
    let gamepadCommands: Partial<GameCommands> = {};
    let rocketPending = false;
    let remoteJump: { direction: 'left' | 'right'; prepared: boolean } | null = null;
    const listeners = createEventScope(target);
    function preventTouchGesture(event: Event) {
        event.preventDefault();
    }
    // Pointer cancellation alone does not cancel iOS native touch gestures.
    // Keep these active after reset: pausing clears input while fingers stay down.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'contextmenu', 'selectstart'])
        listeners.on(controls, type, preventTouchGesture);
    const actions = new Set<TouchAction>([...Object.values(BINDINGS), 'rocket']);
    function actionButton(node: EventTarget | null): ActionButton | null {
        const button = (node as Element | null)?.closest?.<HTMLElement>('[data-action]');
        if (
            !button ||
            !actions.has(button.dataset.action as TouchAction) ||
            (controls.contains && !controls.contains(button))
        )
            return null;
        return button as ActionButton;
    }
    function updateHeld() {
        const held = new Set<string | undefined>(
            [...pointers.values()].flatMap((pointer) => pointer.directions || [pointer.action]),
        );
        for (const button of controls.querySelectorAll<HTMLElement>('[data-action]'))
            button.classList.toggle('touch-controls__button_held', held.has(button.dataset.action));
        if (thumb) {
            const pointer = stickOwner === null ? undefined : pointers.get(stickOwner);
            thumb.style.transform = `translate(${pointer?.x || 0}px, ${pointer?.y || 0}px)`;
        }
    }
    function moveStick(event: ScopedPointerEvent, pointer: TouchPointer) {
        if (!stick) return;
        const bounds = stick.getBoundingClientRect();
        const radius = bounds.width / 2;
        const x = event.clientX - bounds.left - radius;
        const y = event.clientY - bounds.top - bounds.height / 2;
        const distance = Math.sqrt(x * x + y * y);
        pointer.directions = [];
        pointer.x = 0;
        pointer.y = 0;
        if (!Number.isFinite(distance) || radius <= 0 || event.clientX > target.innerWidth / 2)
            return;
        const scale = Math.min(1, (radius * 0.45) / (distance || 1));
        pointer.x = Math.round(x * scale);
        pointer.y = Math.round(y * scale);
        if (distance < radius * 0.2) return;
        if (Math.abs(x) >= Math.abs(y) * 0.5) pointer.directions.push(x < 0 ? 'left' : 'right');
        if (Math.abs(y) >= Math.abs(x) * 0.5) pointer.directions.push(y < 0 ? 'jump' : 'duck');
    }
    function releaseCapture(id: number, button: HTMLElement | undefined) {
        try {
            if (
                typeof button?.releasePointerCapture === 'function' &&
                (!button.hasPointerCapture || button.hasPointerCapture(id))
            )
                button.releasePointerCapture(id);
        } catch {
            /* Outside-release handling remains available without capture. */
        }
    }
    function clearPointers() {
        pointers.clear();
        stickOwner = null;
        taps.clear();
        const held = [...captures];
        captures.clear();
        for (const [id, button] of held) releaseCapture(id, button);
        updateHeld();
    }
    function clearRemoteCommands() {
        remote.clear();
        remoteTaps.clear();
        remoteJump = null;
    }
    function reset() {
        keys.clear();
        clearRemoteCommands();
        gamepadCommands = {};
        rocketPending = false;
        gamepad.reset();
        clearPointers();
    }
    const editing = (event: Event) =>
        ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
            (event.target as Element | null)?.tagName || '',
        );
    listeners.on(target, 'keydown', (event) => {
        if (!bindings[event.code] || editing(event)) return;
        event.preventDefault();
        if (!event.repeat) keys.add(event.code);
    });
    listeners.on(target, 'keyup', (event) => {
        keys.delete(event.code);
        if (!bindings[event.code]) return;
        if (!editing(event)) event.preventDefault();
    });
    function handlePointerDown(event: ScopedPointerEvent) {
        const button = actionButton(event.target);
        const onStick = Boolean(stick?.contains(button || (event.target as Node | null)));
        if ((!button && !onStick) || (typeof event.button === 'number' && event.button !== 0))
            return;
        event.preventDefault();
        if (onStick && stickOwner !== null) return;
        const pointer: TouchPointer = {
            action: onStick ? undefined : button?.dataset.action,
            seen: false,
        };
        const capture = onStick ? stick! : button!;
        if (onStick) {
            stickOwner = event.pointerId;
            moveStick(event, pointer);
        }
        pointers.set(event.pointerId, pointer);
        captures.set(event.pointerId, capture);
        try {
            capture.setPointerCapture?.(event.pointerId);
        } catch {
            /* Some browsers reject capture after interruption. */
        }
        updateHeld();
    }
    listeners.on(controls, 'pointerdown', handlePointerDown);
    function handlePointerMove(event: ScopedPointerEvent) {
        const pointer = pointers.get(event.pointerId);
        if (!pointer) return;
        event.preventDefault();
        if (event.pointerId === stickOwner) {
            moveStick(event, pointer);
            updateHeld();
            return;
        }
        const doc = controls.ownerDocument;
        if (
            !pointers.has(event.pointerId) ||
            !Number.isFinite(event.clientX) ||
            !Number.isFinite(event.clientY) ||
            !doc?.elementFromPoint
        )
            return;
        const button = actionButton(doc.elementFromPoint(event.clientX, event.clientY));
        // Weapon fingers cannot take over the stick or slide into another weapon.
        const original = captures.get(event.pointerId)?.dataset.action;
        const action = stick
            ? button && button.dataset.action === original
                ? button.dataset.action
                : undefined
            : button?.dataset.action;
        if (pointers.get(event.pointerId)?.action !== action) {
            if (stick) pointer.action = action;
            else pointers.set(event.pointerId, { action, seen: false });
            updateHeld();
        }
    }
    listeners.on(controls, 'pointermove', handlePointerMove);
    if ((target as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent)
        listeners.on(target, 'pointermove', handlePointerMove);
    const release = (event: ScopedPointerEvent) => {
        if (!pointers.has(event.pointerId) && !captures.has(event.pointerId)) return;
        const pointer = pointers.get(event.pointerId);
        // A tap shorter than a simulation tick still reaches the next sample.
        if (event.type === 'pointerup' && pointer?.action && !pointer.seen)
            taps.add(pointer.action);
        if (event.type === 'pointerup' && pointer?.directions && !pointer.seen)
            for (const direction of pointer.directions) taps.add(direction);
        pointers.delete(event.pointerId);
        if (stickOwner === event.pointerId) stickOwner = null;
        const button = captures.get(event.pointerId);
        captures.delete(event.pointerId);
        releaseCapture(event.pointerId, button);
        updateHeld();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
        listeners.on(controls, type, release);
    listeners.on(controls, 'click', (event) => {
        const button = actionButton(event.target);
        if (button && event.detail === 0 && !event.pointerType) taps.add(button.dataset.action);
    });
    for (const type of ['pointerup', 'pointercancel'] as const) listeners.on(target, type, release);
    for (const type of ['blur', 'pagehide']) listeners.on(target, type, reset);
    for (const type of ['resize', 'orientationchange']) listeners.on(target, type, clearPointers);
    listeners.on(target.document, 'visibilitychange', () => {
        if (target.document.hidden) reset();
    });
    return {
        configure(configuration: InputConfiguration, preserveHeld = false) {
            bindings = configuration.keys;
            if (!preserveHeld) reset();
        },
        setRemoteCommand(action: Action, down: boolean, jumpDirection?: 'left' | 'right') {
            if (down) {
                if (remoteJump && (action === 'left' || action === 'right')) {
                    remoteTaps.delete(action === 'left' ? 'right' : 'left');
                    if (remoteJump.direction !== action)
                        remoteJump = { direction: action, prepared: false };
                } else if (remoteJump && action === 'duck') {
                    remoteTaps.delete(remoteJump.direction);
                    remoteJump = null;
                }
                if (!remote.has(action)) {
                    remote.set(action, { seen: false });
                    if (action === 'jump' && jumpDirection)
                        remoteJump = { direction: jumpDirection, prepared: false };
                }
            } else {
                const held = remote.get(action);
                if (held && !held.seen) remoteTaps.add(action);
                remote.delete(action);
            }
        },
        clearRemoteCommands,
        pollGamepad(enabled = true) {
            const state = gamepad.poll(enabled);
            gamepadCommands = state.commands;
            if (state.lost || state.status !== 'ready') rocketPending = false;
            else if (state.pressed.launchRocket) rocketPending = true;
            return state;
        },
        handleEvents(events: readonly HapticEvent[]) {
            gamepad.handleEvents(events);
        },
        sample() {
            const result: GameCommands & {
                rocket: boolean;
                chargeRocket?: boolean;
                firePressed?: boolean;
            } = {
                left: false,
                right: false,
                jump: false,
                duck: false,
                fire: false,
                rocket: rocketPending,
            };
            rocketPending = false;
            for (const code of keys)
                for (const action of bindings[code] || []) result[action] = true;
            const keyboardFire = result.fire;
            for (const pointer of pointers.values()) {
                for (const direction of pointer.directions || []) result[direction] = true;
                if (pointer.action === 'fire' && !pointer.seen) result.firePressed = true;
                if (pointer.action && (pointer.action !== 'rocket' || !pointer.seen))
                    result[pointer.action] = true;
                pointer.seen = true;
            }
            // Some remote adapters reconstruct a directional jump from serial
            // keys. Prime walking for one simulation sample so Classic retains
            // its original previous-step jump momentum, even after an idle tick.
            const prepareJump = remoteJump && !remoteJump.prepared;
            for (const [action, held] of remote) {
                if (prepareJump && action === 'jump') continue;
                result[action] = true;
                held.seen = true;
            }
            const deferredJumpTap = prepareJump && remoteTaps.has('jump');
            for (const action of remoteTaps) {
                if (prepareJump && action === 'jump') continue;
                result[action] = true;
                if (action === 'fire') result.firePressed = true;
            }
            remoteTaps.clear();
            if (deferredJumpTap) remoteTaps.add('jump');
            for (const action of taps) {
                result[action] = true;
                if (action === 'fire') result.firePressed = true;
            }
            taps.clear();
            if (remoteJump) {
                result[remoteJump.direction] = true;
                if (prepareJump) remoteJump.prepared = true;
                else remoteJump = null;
            }
            for (const source of Object.keys(gamepadCommands) as Action[]) {
                if (gamepadCommands[source]) result[source] = true;
            }
            if (result.fire && !keyboardFire && !remote.has('fire') && !gamepadCommands.fire)
                result.chargeRocket = false;
            return result;
        },
        reset,
        destroy() {
            this.reset();
            listeners.destroy();
        },
    };
}
