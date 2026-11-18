import assert from 'node:assert/strict';
import test from 'node:test';
import { createGamepadHint } from '../../src/controllers/gamepad-hint.ts';

function fixture(attributes = new Map<string, string>()) {
    let focused: object | null = null;
    const classes = new Set<string>();
    const root = {
        hasAttribute(name: string) {
            return attributes.has(name);
        },
        setAttribute(name: string, value: string) {
            attributes.set(name, value);
        },
    };
    const button = Object.assign(new EventTarget(), {
        disabled: false,
        focus() {
            focused = button;
        },
    });
    const canvas = {
        focus() {
            focused = canvas;
        },
    };
    const document = {
        getElementById(id: string) {
            return id === 'app' ? root : null;
        },
        get activeElement() {
            return focused;
        },
    };
    const element = {
        ownerDocument: document,
        hidden: true,
        classList: {
            add(name: string) {
                classes.add(name);
            },
            remove(name: string) {
                classes.delete(name);
            },
            contains(name: string) {
                return classes.has(name);
            },
        },
        contains(target: unknown) {
            return target === button;
        },
    };
    const pending = new Map<number, { callback: () => void; duration: number }>();
    let sequence = 0;
    let pads: Pick<Gamepad, 'connected'>[] = [];
    const view = Object.assign(new EventTarget(), {
        navigator: { getGamepads: () => pads },
        setTimeout(callback: () => void, duration: number) {
            pending.set(++sequence, { callback, duration });
            return sequence;
        },
        clearTimeout(id: number) {
            pending.delete(id);
        },
    });
    const control = createGamepadHint({
        element: element as unknown as HTMLElement,
        button: button as unknown as HTMLButtonElement,
        canvas: canvas as unknown as HTMLCanvasElement,
        view: view as unknown as Window,
    });
    return {
        control,
        element,
        button,
        canvas,
        view,
        pending,
        attributes,
        setPads(next: typeof pads) {
            pads = next;
        },
        get focused() {
            return focused;
        },
    };
}

test('gamepad advice is consumed by the first start and stays consumed across platform replacement', () => {
    const first = fixture();
    first.control.onStart();
    assert.equal(first.element.hidden, false);
    first.button.focus();
    first.button.dispatchEvent(new Event('click'));
    assert.equal(first.element.hidden, false);
    assert.equal(first.button.disabled, true);
    assert.equal(first.focused, first.canvas);
    const fade = [...first.pending.values()][0];
    assert.equal(fade.duration, 200);
    fade.callback();
    assert.equal(first.element.hidden, true);
    assert.equal(first.pending.size, 0);
    first.control.onStart();
    assert.equal(first.element.hidden, true);
    first.control.destroy();
    const replacement = fixture(first.attributes);
    replacement.control.onStart();
    assert.equal(replacement.element.hidden, true);
    replacement.control.destroy();
});

test('a connected controller at the first start suppresses advice even after disconnecting', () => {
    const env = fixture();
    env.setPads([{ connected: false }, { connected: true }]);
    env.control.onStart();
    assert.equal(env.element.hidden, true);
    assert.equal(env.pending.size, 0);
    env.setPads([]);
    env.control.onStart();
    assert.equal(env.element.hidden, true);
    env.control.destroy();
    const xr = fixture();
    xr.control.onStart(true);
    assert.equal(xr.element.hidden, true);
    xr.control.destroy();
});

test('missing Gamepad API suppresses advice without scheduling a notification', () => {
    const env = fixture();
    Object.defineProperty(env.view.navigator, 'getGamepads', { value: undefined });
    env.control.onStart();
    assert.equal(env.element.hidden, true);
    assert.equal(env.pending.size, 0);
    env.control.destroy();
});

test('advice fades after five seconds and connection/pagehide cancel its timer', () => {
    const expiry = fixture();
    expiry.control.onStart();
    const timeout = [...expiry.pending.values()][0];
    assert.equal(timeout.duration, 5000);
    timeout.callback();
    assert.equal(expiry.element.hidden, false);
    const fade = [...expiry.pending.values()][0];
    assert.equal(fade.duration, 200);
    fade.callback();
    assert.equal(expiry.element.hidden, true);
    assert.equal(expiry.pending.size, 0);
    expiry.control.destroy();
    for (const type of ['gamepadconnected', 'pagehide']) {
        const env = fixture();
        env.control.onStart();
        env.view.dispatchEvent(new Event(type));
        if (type === 'gamepadconnected') {
            assert.equal(env.element.hidden, false);
            [...env.pending.values()][0].callback();
        }
        assert.equal(env.element.hidden, true);
        assert.equal(env.pending.size, 0);
        env.control.destroy();
    }
});

test('unavailable gamepad access does not block advice and disposed callbacks cannot touch the old UI', () => {
    const env = fixture();
    env.view.navigator.getGamepads = () => {
        throw new Error('Blocked');
    };
    env.control.onStart();
    assert.equal(env.element.hidden, false);
    const stale = [...env.pending.values()][0].callback;
    stale();
    const staleFade = [...env.pending.values()][0].callback;
    env.control.destroy();
    assert.equal(env.pending.size, 0);
    env.element.hidden = false;
    stale();
    staleFade();
    env.button.dispatchEvent(new Event('click'));
    env.view.dispatchEvent(new Event('gamepadconnected'));
    env.control.onStart();
    assert.equal(env.element.hidden, false);
    assert.equal(env.pending.size, 0);
});
