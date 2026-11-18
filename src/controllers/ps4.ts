import type { EventScope } from '../lib/events.ts';
import { isPs4Browser } from '../utils/ps4.ts';

// The PS4 browser exposes Cross as a primary mouse press rather than a Gamepad button.
export function createPs4MouseControl({
    document,
    events,
    onPress,
    onRelease,
}: {
    document: Document;
    events: EventScope;
    onPress(event: MouseEvent): boolean;
    onRelease(): void;
}) {
    const view = document.defaultView;
    if (!isPs4Browser(view?.navigator.userAgent || '')) return;
    let held = false,
        nativePress = false;
    function textField(active: HTMLElement | null) {
        return (
            active?.tagName === 'TEXTAREA' ||
            (active?.tagName === 'INPUT' &&
                !['checkbox', 'range', 'button', 'submit'].includes(
                    (active as HTMLInputElement).type,
                )) ||
            active?.isContentEditable
        );
    }
    function nativeMouse(event: MouseEvent) {
        return (
            event.button !== 0 ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            textField(document.activeElement as HTMLElement | null) ||
            textField(event.target as HTMLElement | null)
        );
    }
    function consume(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }
    function handleDown(event: MouseEvent) {
        const target = (event.target as Element | null)?.closest?.<HTMLElement>(
            'button, a[data-platform], input, select, label',
        );
        const control = target?.tagName === 'LABEL' ? (target as HTMLLabelElement).control : target;
        if (
            !event.defaultPrevented &&
            event.button === 0 &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            control &&
            !control.matches(':disabled') &&
            !textField(control)
        )
            control.focus({ preventScroll: true });
        nativePress = event.defaultPrevented || Boolean(nativeMouse(event));
        if (nativePress) return;
        if (held) {
            consume(event);
            return;
        }
        held = onPress(event);
        if (held) consume(event);
    }
    function release() {
        if (!held) return;
        held = false;
        onRelease();
    }
    function handleUp(event: MouseEvent) {
        if (event.button !== 0 || !held) return;
        consume(event);
        release();
    }
    function handleClick(event: MouseEvent) {
        // Confirmation already happened on down. Also cover a down in the landing
        // shell followed by a click after the game replaces that shell.
        if (event.isTrusted && !nativePress && !nativeMouse(event)) consume(event);
    }
    function handleVisibility() {
        if (document.hidden) release();
    }
    function handleKeyDown(event: KeyboardEvent) {
        // Native control activation can produce a trusted keyboard click.
        if (
            !held &&
            (['Space', 'Enter', 'NumpadEnter'].includes(event.code) ||
                event.key === ' ' ||
                event.key === 'Enter' ||
                event.keyCode === 32 ||
                event.keyCode === 13)
        )
            nativePress = true;
    }
    events.on(document, 'keydown', handleKeyDown, true);
    events.on(document, 'mousedown', handleDown, true);
    events.on(document, 'mouseup', handleUp, true);
    events.on(document, 'click', handleClick, true);
    events.on(view, 'blur', release);
    events.on(view, 'pagehide', release);
    events.on(document, 'visibilitychange', handleVisibility);
}
