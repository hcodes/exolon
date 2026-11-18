import { isTvBrowser, tvKey } from '../utils/tv.ts';
import { isPs4Browser } from '../utils/ps4.ts';
import type { EventScope } from '../lib/events.ts';
import type { createInput } from '../input/index.ts';
import type { createGamepadInput } from '../input/gamepad.ts';
import {
    createControlMenu,
    controlEntries,
    controlInput,
    CONTROL_ACTIONS,
} from '../model/control-menu.ts';

interface ControlMenuOptions {
    canvas: HTMLCanvasElement;
    button: HTMLButtonElement;
    events: EventScope;
    input: ReturnType<typeof createInput>;
    isTitle(): boolean;
    isActive(): boolean;
    open(): void;
    start(fromGamepad?: boolean): void;
    activity(): void;
    onCheat(mode: string): void;
}
export function createControlMenuController(options: ControlMenuOptions) {
    const menu = createControlMenu();
    let mode = 'retro',
        direction = 0,
        fire = false;
    const { canvas, input, events } = options;
    const userAgent = canvas.ownerDocument.defaultView?.navigator.userAgent || '';
    const tv = isTvBrowser(userAgent);
    const ps4 = isPs4Browser(userAgent);
    const available = () => mode !== 'remastered';
    const active = () => available() && options.isActive();
    function describe() {
        const snapshot = menu.snapshot,
            definition = snapshot.definition;
        if (definition)
            canvas.setAttribute(
                'aria-label',
                `Define keys. ${CONTROL_ACTIONS[definition.step].toUpperCase()}: ${definition.labels[definition.step] || 'press a key'}. Escape cancels.`,
            );
        else {
            const entries = controlEntries(mode),
                platform =
                    mode === 'c64' || mode === 'cpc' || mode === 'sharp-mz800' ? mode : 'retro';
            const device =
                entries[snapshot.profiles[platform].device + 2]?.label.slice(2) || 'KEYBOARD';
            const controls = tv
                ? 'arrows or 2/4/6/8, OK or 5'
                : `digits 1 to ${entries.length}, arrows and Enter`;
            canvas.setAttribute(
                'aria-label',
                `Game screen. ${available() ? `${device}. ` : ''}${snapshot.profiles[platform].bindings.map((binding, index) => `${binding.label}: ${CONTROL_ACTIONS[index]}`).join(', ')}.${available() ? ` Controls menu: ${controls}.` : ''}`,
            );
        }
    }
    function configure(preserveHeld = false) {
        options.button.hidden = !available();
        if (!available() && canvas.ownerDocument.activeElement === options.button)
            canvas.focus({ preventScroll: true });
        input.configure(controlInput(menu.snapshot, mode), preserveHeld);
        describe();
    }
    function cancel() {
        menu.cancel();
        direction = 0;
        fire = false;
        configure();
    }
    function activate(digit?: number, fromGamepad = false) {
        options.activity();
        const result = menu.activate(mode, digit);
        if (result === 'start') options.start(fromGamepad);
        else if (result === 'changed') configure();
    }
    function open() {
        if (!available() || !options.isTitle()) return;
        cancel();
        options.open();
        canvas.focus({ preventScroll: true });
    }
    events.on(options.button, 'click', open);
    // Capture before TV focus navigation and gameplay listeners. No native field is shown.
    function captureDefinitionKey(event: KeyboardEvent) {
        if (event.code === 'Tab' || event.code === 'Pause') return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        options.activity();
        if (tvKey(event) === 'Back') {
            cancel();
            return;
        }
        if (
            !event.code ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            /^(Shift|Control|Alt|Meta|CapsLock)/.test(event.code)
        )
            return;
        const label =
            event.code === 'Space'
                ? 'SPACE'
                : event.key.length === 1
                  ? event.key
                  : event.code.replace(/^Arrow/, '');
        menu.captureKey(event.code, label);
        describe();
        return;
    }
    function handleKeyDown(event: KeyboardEvent) {
        if (
            !options.isTitle() ||
            ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
                (event.target as Element | null)?.tagName || '',
            )
        )
            return;
        if (menu.snapshot.definition) {
            captureDefinitionKey(event);
            return;
        }
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const remoteKey = tv || ps4 ? tvKey(event, tv) : null;
        // The TV controller owns title confirmation and suppresses held start
        // buttons until release; this controller owns the in-game controls menu.
        if (remoteKey && !active()) return;
        const key = remoteKey || event.code;
        const digit =
            available() && !remoteKey && /^Digit[1-5]$/.test(event.code)
                ? Number(event.code.slice(5))
                : 0;
        const navigation = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key);
        const confirm =
            event.code === 'Digit1' ||
            key === 'Enter' ||
            Boolean(controlInput(menu.snapshot, mode).keys[event.code]?.includes('fire'));
        if (!digit && !confirm && !(active() && navigation)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (!active() && confirm && !digit) {
            options.start();
            return;
        }
        if (!active()) options.open();
        if (navigation) {
            menu.move(mode, key === 'ArrowUp' || key === 'ArrowLeft' ? -1 : 1);
            describe();
            options.activity();
        } else activate(digit || undefined);
    }
    events.on(canvas.ownerDocument.defaultView, 'keydown', handleKeyDown, true);
    function handleKeyUp(event: KeyboardEvent) {
        if (!menu.snapshot.definition) return;
        const result = menu.release(event.code);
        if (result) {
            configure();
            if (result === 'cheat') options.onCheat(mode);
        } else describe();
    }
    events.on(canvas.ownerDocument.defaultView, 'keyup', handleKeyUp, true);
    configure();
    return {
        get active() {
            return active();
        },
        get available() {
            return available();
        },
        get snapshot() {
            return menu.snapshot;
        },
        get defining() {
            return Boolean(menu.snapshot.definition);
        },
        setMode(value: string, preserveHeld = false) {
            if (mode !== value) {
                mode = value;
                menu.cancel();
                direction = 0;
                fire = false;
                configure(preserveHeld);
            }
        },
        cancel,
        open,
        confirm() {
            if (active()) {
                if (!menu.snapshot.definition) activate();
                return true;
            }
            return false;
        },
        click(x: number, y: number) {
            if (!active() || menu.snapshot.definition) return false;
            if (mode === 'sharp-mz800') {
                x = (x * 320) / 256 - 32;
                y = (y * 200) / 192 - 4;
            }
            const index = controlEntries(mode).findIndex(
                (entry) => y >= entry.row * 8 - 3 && y < entry.row * 8 + 10,
            );
            if (index < 0 || x < 52 || x > 248) return false;
            activate(index + 1);
            canvas.focus({ preventScroll: true });
            return true;
        },
        pad(pad: ReturnType<ReturnType<typeof createGamepadInput>['poll']>) {
            if (!active()) return false;
            if (menu.snapshot.definition) {
                if (pad.pressed.back) cancel();
                return true;
            }
            if (pad.pressed.back || pad.pressed.scores) return false;
            const nextDirection = pad.navigation.y || pad.navigation.x;
            if (nextDirection && !direction) {
                menu.move(mode, nextDirection);
                options.activity();
            }
            direction = nextDirection;
            const nextFire = pad.commands.fire;
            if ((nextFire && !fire) || pad.pressed.confirm || pad.pressed.pause)
                activate(undefined, true);
            fire = nextFire;
            describe();
            return Boolean(nextDirection || nextFire || pad.pressed.confirm || pad.pressed.pause);
        },
    };
}
