import { createEventScope } from '../lib/events.ts';
import type { GameCommands } from '../input/gamepad.ts';
import { tvKey, type TvKey } from '../utils/tv.ts';
import { isPs4Browser } from '../utils/ps4.ts';
import { createPs4MouseControl } from './ps4.ts';

type Action = keyof GameCommands;
type RemoteEvent = (KeyboardEvent | MouseEvent) & { repeat?: boolean };
interface TvOptions {
    enabled: boolean;
    shell: HTMLElement;
    canvas: HTMLCanvasElement;
    isPlaying: () => boolean;
    onConfirm: () => void;
    onSplitAdjust: (direction: number) => void;
    onBack: () => boolean;
    onPause: () => boolean;
    onActivity: () => void;
    onClearCommands: () => void;
    onCommand: (action: Action, pressed: boolean, jumpDirection?: 'left' | 'right') => void;
}

export function createTvController(options: TvOptions) {
    const { shell, canvas, enabled, onCommand } = options;
    const doc = shell.ownerDocument,
        view = doc.defaultView;
    const events = createEventScope(view);
    const ps4 = isPs4Browser(view?.navigator.userAgent || '');
    const consumed = new Set<TvKey>();
    const held = new Map<TvKey, Action[]>();
    const commands = new Set<Action>();
    let recentDirection: { action: 'left' | 'right'; released: number } | null = null;
    const actions: Partial<Record<TvKey, Action>> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'jump',
        ArrowDown: 'duck',
        Enter: 'fire',
    };
    function syncCommands() {
        const next = new Set([...held.values()].flatMap((combination) => combination));
        for (const action of commands) if (!next.has(action)) onCommand(action, false);
        for (const action of next)
            if (!commands.has(action)) {
                const direction = held
                    .get('ArrowUp')
                    ?.find((value) => value === 'left' || value === 'right');
                onCommand(action, true, ps4 && action === 'jump' ? direction : undefined);
            }
        commands.clear();
        for (const action of next) commands.add(action);
    }
    function clear() {
        held.clear();
        commands.clear();
        options.onClearCommands();
        recentDirection = null;
        consumed.clear();
    }
    function consume(event: RemoteEvent, key: TvKey) {
        event.preventDefault();
        event.stopPropagation();
        consumed.add(key);
    }
    function focusables() {
        const dialog = shell.querySelector<HTMLElement>('.modal:not([hidden])');
        const scope = dialog || shell;
        function isFocusable(element: HTMLElement) {
            if (element.matches(':disabled') || element.closest('[hidden]')) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1;
        }
        return [...scope.querySelectorAll<HTMLElement>('button, select, input')].filter(
            isFocusable,
        );
    }
    function change(control: HTMLElement, direction: number) {
        if (control.id === 'split-divider') {
            options.onSplitAdjust(direction);
            return true;
        }
        if (control.tagName === 'SELECT') {
            const select = control as HTMLSelectElement;
            const available = [...select.options].filter((option) => !option.disabled);
            const index = available.findIndex((option) => option.selected);
            const next = Math.max(0, Math.min(available.length - 1, index + direction));
            if (available[next] && !available[next].selected) {
                select.value = available[next].value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
        }
        if (control.tagName === 'INPUT' && (control as HTMLInputElement).type === 'range') {
            const input = control as HTMLInputElement;
            const step = Number(input.step) || 1;
            input.value = String(
                Math.max(
                    Number(input.min) || 0,
                    Math.min(Number(input.max) || 100, Number(input.value) + step * direction),
                ),
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
        return false;
    }
    if (enabled) {
        shell.classList.add('game-app_tv');
        // The legacy layout ran before App's controller; TV CSS now owns the geometry.
        if (shell.classList.contains('game-app_legacy')) {
            shell.style.removeProperty('padding');
            shell.style.removeProperty('height');
            for (const element of [
                canvas,
                canvas.parentElement!,
                canvas.parentElement!.parentElement!,
            ]) {
                element.style.removeProperty('height');
                element.style.removeProperty('width');
            }
            doc.querySelector<HTMLElement>('.game-footer__options')?.style.removeProperty(
                'max-height',
            );
        }
    }
    if ((enabled || ps4) && view) {
        function handleSystemKey(event: RemoteEvent, key: TvKey) {
            if (key === 'Back') {
                if (!event.repeat && options.onBack()) {
                    clear();
                    consume(event, key);
                }
                return true;
            }
            if (key === 'Pause') {
                if (!event.repeat && options.onPause()) {
                    clear();
                    consume(event, key);
                }
                return true;
            }
            return false;
        }
        function handleGameplayKey(event: RemoteEvent, key: TvKey) {
            const action = actions[key];
            if (!action) return;
            event.preventDefault();
            event.stopPropagation();
            if (!held.has(key)) {
                const combination: Action[] = [action];
                if (ps4) {
                    // PS4 can serialize D-pad directions instead of reporting a
                    // chord. Carry a quick horizontal -> Up transition until Up
                    // is released, without delaying normal walking releases.
                    if (action === 'jump') {
                        const direction = held.has('ArrowLeft')
                            ? 'left'
                            : held.has('ArrowRight')
                              ? 'right'
                              : recentDirection && Date.now() - recentDirection.released <= 250
                                ? recentDirection.action
                                : null;
                        if (direction) combination.push(direction);
                    } else if (action === 'left' || action === 'right' || action === 'duck') {
                        recentDirection = null;
                        if (held.has('ArrowUp')) held.set('ArrowUp', ['jump']);
                    }
                }
                held.set(key, combination);
                syncCommands();
            }
            return;
        }
        function navigateMenu(
            event: RemoteEvent,
            key: TvKey,
            active: HTMLElement | null,
            gameFocus: boolean,
        ) {
            clear();
            consume(event, key);
            if (event.repeat) return;
            if (key === 'Enter') {
                if (gameFocus) options.onConfirm();
                else if (active?.tagName === 'SELECT') change(active, 1);
                else active?.click();
                return;
            }
            if (
                active &&
                ['ArrowLeft', 'ArrowRight'].includes(key) &&
                change(active, key === 'ArrowLeft' ? -1 : 1)
            )
                return;
            const candidates = focusables();
            const index = candidates.indexOf(active!);
            const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
            candidates[
                index < 0 ? 0 : (index + direction + candidates.length) % candidates.length
            ]?.focus();
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
            const key = tvKey(event, enabled);
            if (!key) return;
            const active = doc.activeElement as HTMLElement | null;
            // Let the TV's native IME edit and submit the in-game name field.
            if (
                active?.tagName === 'INPUT' &&
                !['checkbox', 'range'].includes((active as HTMLInputElement).type)
            ) {
                if (ps4) clear();
                // Keep native cancellation, but do not let the global Escape shortcut hide the form.
                if (key === 'Back' || event.isComposing) event.stopPropagation();
                return;
            }
            if (consumed.has(key)) {
                consume(event, key);
                return;
            }
            options.onActivity();
            if (handleSystemKey(event, key)) return;
            const gameFocus = active === canvas || active === doc.body || !active;
            if (options.isPlaying() && gameFocus) {
                handleGameplayKey(event, key);
                return;
            }
            navigateMenu(event, key, active, gameFocus);
        }
        events.on(doc, 'keydown', handleKeyDown, true);
        function handleKeyUp(event: KeyboardEvent) {
            const key = tvKey(event, enabled);
            if (!key) return;
            const combination = held.get(key);
            if (combination || consumed.has(key)) {
                event.preventDefault();
                event.stopPropagation();
                if (ps4 && combination) {
                    if (key === 'ArrowLeft' || key === 'ArrowRight')
                        recentDirection = {
                            action: key === 'ArrowLeft' ? 'left' : 'right',
                            released: Date.now(),
                        };
                    else if (key === 'ArrowUp') recentDirection = null;
                }
                held.delete(key);
                syncCommands();
                consumed.delete(key);
            }
        }
        events.on(doc, 'keyup', handleKeyUp, true);
        function handlePs4Press(event: MouseEvent) {
            const active = doc.activeElement as HTMLElement | null;
            const gameFocus = active === canvas || active === doc.body || !active;
            options.onActivity();
            if (options.isPlaying() && gameFocus) handleGameplayKey(event, 'Enter');
            else navigateMenu(event, 'Enter', active, gameFocus);
            return true;
        }
        function releasePs4() {
            held.delete('Enter');
            syncCommands();
            consumed.delete('Enter');
        }
        createPs4MouseControl({
            document: doc,
            events,
            onPress: handlePs4Press,
            onRelease: releasePs4,
        });
        function handleFocus() {
            if (ps4 && doc.activeElement !== canvas && doc.activeElement !== doc.body) clear();
        }
        events.on(doc, 'focusin', handleFocus);
        for (const type of ['blur', 'pagehide']) events.on(view, type, clear);
        function handleVisibilityChange() {
            if (doc.hidden) clear();
        }
        events.on(doc, 'visibilitychange', handleVisibilityChange);
    }
    return {
        destroy() {
            clear();
            events.destroy();
            shell.classList.remove('game-app_tv');
        },
    };
}
