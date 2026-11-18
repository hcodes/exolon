import assert from 'node:assert/strict';
import test from 'node:test';
import * as fullscreen from '../../src/controllers/fullscreen.ts';
interface MockClasses {
    values: Set<string>;
    toggle(name: string, on: boolean): void;
    contains(name: string): boolean;
}
interface MockFullscreenElement {
    ownerDocument: MockFullscreenDocument;
    classList: MockClasses;
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
}
interface MockFullscreenDocument extends EventTarget {
    querySelector(selector: string): HTMLElement | null;
    documentElement: { classList: MockClasses };
    fullscreenElement: MockFullscreenElement | null;
    activeElement?: { tagName: string; type: string };
    webkitFullscreenElement?: MockFullscreenElement | null;
    exitFullscreen: () => Promise<void>;
}
interface MockButton extends EventTarget {
    'aria-pressed'?: string;
    'aria-label'?: string;
    textContent: string;
    setAttribute(name: 'aria-pressed' | 'aria-label', value: string): void;
}
function fixture(native = true) {
    const classes = () => ({
        values: new Set<string>(),
        contains(name: string) {
            return this.values.has(name);
        },
        toggle(name: string, on: boolean) {
            if (on) this.values.add(name);
            else this.values.delete(name);
        },
    });
    const doc = new EventTarget() as MockFullscreenDocument;
    doc.documentElement = { classList: classes() };
    doc.fullscreenElement = null;
    doc.querySelector = () => null;
    const element: MockFullscreenElement = { ownerDocument: doc, classList: classes() },
        button = new EventTarget() as MockButton;
    button.setAttribute = (name, value) => {
        button[name] = value;
    };
    button.textContent = '';
    if (native)
        element.requestFullscreen = async () => {
            doc.fullscreenElement = element;
            doc.dispatchEvent(new Event('fullscreenchange'));
        };
    doc.exitFullscreen = async () => {
        doc.fullscreenElement = null;
        doc.dispatchEvent(new Event('fullscreenchange'));
    };
    return { doc, element, button };
}
test('fullscreen toggle synchronizes native entry, exit and an external browser exit', async () => {
    const { doc, element, button } = fixture();
    const control = fullscreen.createFullscreenControl(
        element as unknown as HTMLElement,
        button as unknown as HTMLButtonElement,
    );
    await control.toggle();
    assert.equal(doc.fullscreenElement, element);
    assert.equal(button['aria-pressed'], 'true');
    assert.equal(element.classList.values.has('game-app_fullscreen'), true);
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
    assert.equal(button['aria-pressed'], 'false');
    assert.equal(button.textContent, '');
    assert.equal(button['aria-label'], 'Fullscreen');
    await control.toggle();
    await control.toggle();
    assert.equal(doc.fullscreenElement, null);
    control.destroy();
});
test('unavailable or rejected native requests use an escapable window mode', async () => {
    for (const rejected of [false, true]) {
        const { doc, element, button } = fixture(false);
        if (rejected) element.requestFullscreen = () => Promise.reject(Error('Denied'));
        const control = fullscreen.createFullscreenControl(
            element as unknown as HTMLElement,
            button as unknown as HTMLButtonElement,
        );
        await control.toggle();
        assert.equal(element.classList.values.has('game-app_fullscreen'), true);
        const escape = new Event('keydown', { cancelable: true });
        Object.defineProperty(escape, 'code', { value: 'Escape' });
        doc.dispatchEvent(escape);
        assert.equal(element.classList.values.has('game-app_fullscreen'), false);
        assert.equal(button['aria-pressed'], 'false');
        control.destroy();
    }
});
test('destroy cancels a pending fullscreen entry and removes event handlers', async () => {
    const { doc, element, button } = fixture(false);
    let finish!: () => void;
    element.requestFullscreen = () =>
        new Promise<void>((resolve) => {
            finish = () => {
                doc.fullscreenElement = element;
                resolve();
            };
        });
    const control = fullscreen.createFullscreenControl(
        element as unknown as HTMLElement,
        button as unknown as HTMLButtonElement,
    );
    const pending = control.toggle();
    control.destroy();
    finish();
    await pending;
    assert.equal(doc.fullscreenElement, null);
    assert.equal(element.classList.values.has('game-app_fullscreen'), false);
    button.dispatchEvent(new Event('click'));
    assert.equal(element.classList.values.has('game-app_fullscreen'), false);
});

test('legacy void-only requests use window mode so cancellation cannot cause late native entry', async () => {
    const { doc, element, button } = fixture(false);
    let finish!: () => void;
    element.webkitRequestFullscreen = () => {
        finish = () => {
            doc.webkitFullscreenElement = element;
            doc.dispatchEvent(new Event('webkitfullscreenchange'));
        };
    };
    const control = fullscreen.createFullscreenControl(
        element as unknown as HTMLElement,
        button as unknown as HTMLButtonElement,
    );
    await control.toggle();
    assert.equal(element.classList.values.has('game-app_fullscreen'), true);
    control.destroy();
    if (finish) finish();
    assert.equal(doc.webkitFullscreenElement ?? null, null);
    assert.equal(element.classList.values.has('game-app_fullscreen'), false);
});

test('Escape and external native exit notify navigation, while the exit button does not', async () => {
    for (const native of [true, false]) {
        const { doc, element, button } = fixture(native);
        let exits = 0;
        const control = fullscreen.createFullscreenControl(
            element as unknown as HTMLElement,
            button as unknown as HTMLButtonElement,
            {
                onEscape() {
                    exits++;
                },
            },
        );
        await control.toggle();
        await control.toggle();
        assert.equal(exits, 0);
        await control.toggle();
        if (native) {
            doc.fullscreenElement = null;
            doc.dispatchEvent(new Event('fullscreenchange'));
        } else {
            const event = new Event('keydown', { cancelable: true });
            Object.defineProperty(event, 'code', { value: 'Escape' });
            doc.dispatchEvent(event);
        }
        assert.equal(exits, 1);
        control.destroy();
        assert.equal(exits, 1);
    }
});

test('external Escape is recognized when native entry events arrive after the request promise', async () => {
    const { doc, element, button } = fixture();
    let exits = 0;
    element.requestFullscreen = async () => {
        doc.fullscreenElement = element;
    };
    const control = fullscreen.createFullscreenControl(
        element as unknown as HTMLElement,
        button as unknown as HTMLButtonElement,
        {
            onEscape() {
                exits++;
            },
        },
    );
    await control.toggle();
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
    assert.equal(exits, 1);
    assert.equal(button['aria-pressed'], 'false');
    control.destroy();
});

test('a new native entry clears intent from an earlier programmatic exit with delayed events', async () => {
    const { doc, element, button } = fixture();
    let exits = 0;
    element.requestFullscreen = async () => {
        doc.fullscreenElement = element;
    };
    doc.exitFullscreen = async () => {
        doc.fullscreenElement = null;
    };
    const control = fullscreen.createFullscreenControl(
        element as unknown as HTMLElement,
        button as unknown as HTMLButtonElement,
        {
            onEscape() {
                exits++;
            },
        },
    );
    await control.toggle();
    await control.toggle();
    await control.toggle();
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
    assert.equal(exits, 1);
    control.destroy();
});

test('TV name editing retains Escape for the native keyboard while fullscreen is active', async () => {
    const { doc, element, button } = fixture(false);
    let escaped = 0;
    element.classList.values.add('game-app_tv');
    doc.activeElement = { tagName: 'INPUT', type: 'text' };
    const control = fullscreen.createFullscreenControl(
        element as unknown as HTMLElement,
        button as unknown as HTMLButtonElement,
        {
            onEscape: () => {
                escaped++;
            },
        },
    );
    try {
        await control.toggle();
        const key = new Event('keydown', { cancelable: true });
        Object.defineProperty(key, 'code', { value: 'Escape' });
        doc.dispatchEvent(key);
        assert.equal(key.defaultPrevented, false);
        assert.equal(escaped, 0);
        assert.equal(button['aria-pressed'], 'true');
        doc.activeElement = undefined;
        doc.dispatchEvent(key);
        assert.equal(escaped, 1);
    } finally {
        control.destroy();
    }
});
