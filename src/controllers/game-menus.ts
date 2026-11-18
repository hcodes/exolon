import type { EventScope } from '../lib/events.ts';
import type { PreferenceStore } from '../types/ui.ts';
import type { createGamepadInput } from '../input/gamepad.ts';
import { createModalControl } from './modal.ts';
import { tvKey } from '../utils/tv.ts';
import { gameElement } from '../utils/dom.ts';

type MenuPad = ReturnType<ReturnType<typeof createGamepadInput>['poll']>;
interface GameMenusOptions {
    document: Document;
    storage: PreferenceStore;
    events: EventScope;
    isRunning(): boolean;
    pause(): void;
    resume(): void;
    canResume(): boolean;
    onToggle(collapsed: boolean): void;
}

export function createGameMenusControl({
    document,
    storage,
    events,
    isRunning,
    pause,
    resume,
    canResume,
    onToggle,
}: GameMenusOptions) {
    const view = document.defaultView;
    const menus = (
        [
            { buttonId: 'home', panelId: 'home-panel', label: 'Home' },
            { buttonId: 'settings-toggle', panelId: 'settings-panel', label: 'settings' },
        ] as const
    ).map(({ buttonId, panelId, label }) => {
        const button = gameElement(document, buttonId);
        const panel = gameElement(document, panelId);
        const modal = createModalControl({ element: panel, events, onCancel: close });
        panel.hidden = true;
        return { button, panel, modal, label };
    });
    type Menu = (typeof menus)[number];
    let current: Menu | undefined;
    let resumeAfterClose = false;
    let previousX = 0,
        previousY = 0;
    const actions = new Set([
        'new-game',
        'pause',
        'restart',
        'menu',
        'show-scores',
        'back-title',
        'show-controls',
        'platforms',
        'vr-scores',
        'vr-platforms',
    ]);
    menus[1].panel.closest('.game-footer')?.classList.add('game-footer_settings-modal');
    for (const menu of menus) updateButton(menu);
    function updateButton({ button, panel, label }: Menu) {
        button.setAttribute('aria-expanded', String(!panel.hidden));
        button.title = `${panel.hidden ? 'Show' : 'Close'} ${label}`;
    }
    function revokeResume() {
        resumeAfterClose = false;
    }
    function open(menu: Menu) {
        if (current === menu) return;
        if (current) {
            current.modal.close(false);
            if (current.panel.id === 'settings-panel') storage.set('settingsCollapsed', true);
            updateButton(current);
        } else {
            const running = isRunning();
            if (running) pause();
            resumeAfterClose = running;
        }
        current = menu;
        previousX = previousY = 0;
        onToggle(false);
        menu.modal.open(menu.button);
        updateButton(menu);
        if (menu.panel.id === 'settings-panel') storage.set('settingsCollapsed', false);
    }
    function close() {
        if (!current) return;
        const menu = current;
        const shouldResume =
            resumeAfterClose && !document.hidden && document.hasFocus() && canResume();
        revokeResume();
        current = undefined;
        menu.modal.close();
        updateButton(menu);
        if (menu.panel.id === 'settings-panel') storage.set('settingsCollapsed', true);
        onToggle(true);
        if (shouldResume) resume();
    }
    for (const menu of menus) {
        const { button, panel } = menu;
        function togglePanel() {
            if (current === menu) close();
            else open(menu);
        }
        events.on(button, 'click', togglePanel);
        let touch: { id: number; x: number; y: number } | null = null;
        function cancelTouch() {
            touch = null;
        }
        function handleTouchStart(event: TouchEvent) {
            event.preventDefault();
            const point = event.changedTouches[0];
            if (touch || !point || button.disabled) return;
            touch = { id: point.identifier, x: point.clientX, y: point.clientY };
        }
        function handleTouchMove(event: TouchEvent) {
            event.preventDefault();
            for (let i = 0; i < event.changedTouches.length; i++) {
                const point = event.changedTouches[i];
                if (
                    point.identifier === touch?.id &&
                    (Math.abs(point.clientX - touch.x) > 10 ||
                        Math.abs(point.clientY - touch.y) > 10)
                )
                    cancelTouch();
            }
        }
        function handleTouchEnd(event: TouchEvent) {
            event.preventDefault();
            for (let i = 0; i < event.changedTouches.length; i++) {
                const point = event.changedTouches[i];
                if (point.identifier !== touch?.id) continue;
                const bounds = button.getBoundingClientRect();
                const tapped =
                    Math.abs(point.clientX - touch.x) <= 10 &&
                    Math.abs(point.clientY - touch.y) <= 10 &&
                    point.clientX >= bounds.left &&
                    point.clientX <= bounds.right &&
                    point.clientY >= bounds.top &&
                    point.clientY <= bounds.bottom;
                cancelTouch();
                // Cancel native zoom/callout recognition and its compatibility click,
                // then activate once, including when another finger holds the stick.
                if (tapped) button.click();
            }
        }
        function preventTouchGesture(event: Event) {
            event.preventDefault();
        }
        events.on(button, 'touchstart', handleTouchStart);
        events.on(button, 'touchmove', handleTouchMove);
        events.on(button, 'touchend', handleTouchEnd);
        events.on(button, 'touchcancel', cancelTouch);
        events.on(button, 'contextmenu', preventTouchGesture);
        events.on(button, 'selectstart', preventTouchGesture);
        events.on(view, 'blur', cancelTouch);
        function handleAction(event: MouseEvent) {
            const target = event.target as Element | null;
            if (current === menu && actions.has(target?.closest('button')?.id || '')) close();
        }
        events.on(panel, 'click', handleAction);
        function stopGameplayKeys(event: KeyboardEvent) {
            event.stopPropagation();
        }
        events.on(panel, 'keydown', stopGameplayKeys);
    }
    function ownsFocus() {
        return (
            current &&
            ![...document.querySelectorAll<HTMLElement>('.modal')].some(
                (other) =>
                    other !== current?.panel &&
                    !other.hidden &&
                    other.contains(document.activeElement),
            )
        );
    }
    function handleKey(event: KeyboardEvent) {
        if (!ownsFocus()) return;
        if (tvKey(event) === 'Back' || tvKey(event) === 'Pause') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.repeat) close();
        } else if (event.key === 'Tab' || event.keyCode === 9) {
            current?.modal.handleKey(event);
            event.stopImmediatePropagation();
        }
    }
    // Capture before Fullscreen and the TV remote adapter consume Escape/Back.
    events.on(view, 'keydown', handleKey, true);
    events.on(view, 'blur', revokeResume);
    function handleVisibilityChange() {
        if (document.hidden) revokeResume();
    }
    events.on(document, 'visibilitychange', handleVisibilityChange);
    function focusables() {
        return [
            ...(current?.panel.querySelectorAll<HTMLElement>('button, input, select, [tabindex]') ||
                []),
        ].filter(
            (node) =>
                node.tabIndex >= 0 &&
                !node.hasAttribute('disabled') &&
                !node.closest('[hidden]') &&
                node.getClientRects().length > 0,
        );
    }
    function adjust(control: HTMLElement | null, direction: number) {
        if (control?.tagName === 'SELECT') {
            const select = control as HTMLSelectElement;
            const choices = [...select.options].filter((option) => !option.disabled);
            const index = choices.findIndex((option) => option.selected);
            const next = choices[Math.max(0, Math.min(choices.length - 1, index + direction))];
            if (next && !next.selected) {
                select.value = next.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }
        if (control?.tagName === 'INPUT' && (control as HTMLInputElement).type === 'range') {
            const input = control as HTMLInputElement;
            input.value = String(
                Math.max(
                    Number(input.min) || 0,
                    Math.min(
                        Number(input.max) || 100,
                        Number(input.value) + direction * (Number(input.step) || 1),
                    ),
                ),
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
        return false;
    }
    function gamepad(pad: MenuPad) {
        if (pad.lost && current) revokeResume();
        if (!ownsFocus()) return false;
        if (pad.status !== 'ready') return true;
        if (pad.pressed.back || pad.pressed.pause) close();
        else if (pad.pressed.confirm) (document.activeElement as HTMLElement | null)?.click();
        else {
            const { x, y } = pad.navigation;
            const active = document.activeElement as HTMLElement | null;
            if ((x && x !== previousX) || (y && y !== previousY)) {
                if (!x || !adjust(active, x)) {
                    const nodes = focusables();
                    const index = nodes.indexOf(active!);
                    const direction = y || x;
                    nodes[
                        index < 0 ? 0 : (index + direction + nodes.length) % nodes.length
                    ]?.focus();
                }
            }
            previousX = x;
            previousY = y;
        }
        return true;
    }
    return {
        revokeResume,
        gamepad,
        get active() {
            return Boolean(current);
        },
    };
}
