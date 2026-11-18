import { createEventScope } from '../lib/events.ts';
import { GAMEPAD_HINT_DURATION, GAMEPAD_HINT_FADE_DURATION } from '../constants/interface.ts';

export function createGamepadHint({
    element,
    button,
    canvas,
    view,
}: {
    element: HTMLElement;
    button: HTMLButtonElement;
    canvas: HTMLCanvasElement;
    view: Window;
}) {
    const doc = element.ownerDocument;
    // #app survives platform replacement; reloading the page creates a fresh launch.
    const root = doc.getElementById('app') || element;
    const events = createEventScope(view);
    let timer: number | undefined;
    let disposed = false;
    function hide() {
        if (timer !== undefined) view.clearTimeout(timer);
        timer = undefined;
        if (disposed) return;
        if (element.contains(doc.activeElement)) canvas.focus({ preventScroll: true });
        element.hidden = true;
        element.classList.remove('gamepad-hint_dismissing');
    }
    function dismiss() {
        if (disposed || element.hidden || element.classList.contains('gamepad-hint_dismissing'))
            return;
        if (timer !== undefined) view.clearTimeout(timer);
        if (element.contains(doc.activeElement)) canvas.focus({ preventScroll: true });
        button.disabled = true;
        element.classList.add('gamepad-hint_dismissing');
        timer = view.setTimeout(hide, GAMEPAD_HINT_FADE_DURATION);
    }
    function connected() {
        try {
            return (
                typeof view.navigator.getGamepads === 'function' &&
                Array.from(view.navigator.getGamepads() || []).some((pad) => pad?.connected)
            );
        } catch {
            return false;
        }
    }
    events.on(button, 'click', dismiss);
    events.on(view, 'gamepadconnected', dismiss);
    events.on(view, 'pagehide', hide);
    return {
        onStart(controllerConnected = false) {
            if (disposed || root.hasAttribute('data-gamepad-hint-checked')) return;
            root.setAttribute('data-gamepad-hint-checked', '');
            if (
                typeof view.navigator.getGamepads !== 'function' ||
                controllerConnected ||
                connected()
            )
                return;
            button.disabled = false;
            element.hidden = false;
            timer = view.setTimeout(dismiss, GAMEPAD_HINT_DURATION);
        },
        destroy() {
            if (disposed) return;
            hide();
            disposed = true;
            events.destroy();
        },
    };
}
