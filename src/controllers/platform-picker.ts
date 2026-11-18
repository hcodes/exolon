import type { PlatformMode } from '../constants/platforms.ts';
import { LAUNCH_CHOICES } from '../utils/game-launch.ts';
import type { EventScope } from '../lib/events.ts';
import { isTvBrowser, tvKey } from '../utils/tv.ts';
import { createPs4MouseControl } from './ps4.ts';

export function createPlatformPicker({
    document,
    window,
    events,
    shell,
    preferred,
    onChoose,
    onChooseAmiga,
    onChooseAtariSt,
    onChooseVr,
    onChooseClassic,
}: {
    document: Document;
    window: Window & typeof globalThis;
    events: EventScope;
    shell: HTMLElement;
    preferred: string;
    onChoose: (mode: PlatformMode) => void;
    onChooseAmiga?: () => void;
    onChooseAtariSt?: () => void;
    onChooseVr?: () => void;
    onChooseClassic?: () => void;
}) {
    const element = document.getElementById('platform-picker')!;
    const status = document.getElementById('platform-status')!;
    const links = [...element.querySelectorAll<HTMLAnchorElement>('[data-platform]')];
    const urls: string[] = [];
    const tv = isTvBrowser(window.navigator.userAgent);
    let availableModes: readonly string[] = [];
    let modes: readonly string[] = [];
    let vrSupported = false;
    let vrReason = 'Checking VR support…';
    let selected = Math.max(
        0,
        LAUNCH_CHOICES.findIndex((item) => item.mode === preferred),
    );
    let previousDirection = 0;
    function updateAvailability() {
        modes = [
            ...availableModes.filter((mode) => mode !== 'vr'),
            ...(onChooseAmiga ? ['amiga'] : []),
            ...(onChooseAtariSt ? ['atari-st'] : []),
            ...(onChooseVr && vrSupported ? ['vr'] : []),
        ];
        for (const [index, link] of links.entries()) {
            const disabled = !modes.includes(LAUNCH_CHOICES[index].mode);
            link.setAttribute('aria-disabled', String(disabled));
            if (LAUNCH_CHOICES[index].mode !== 'vr') continue;
            link.classList.toggle('platform-picker__banner_disabled', disabled);
            link.tabIndex = disabled ? -1 : 0;
            link.title = disabled ? vrReason : '';
            if (disabled) link.removeAttribute('href');
            else link.href = urls[index];
        }
    }
    function choose(index: number) {
        const mode = LAUNCH_CHOICES[index].mode;
        if (element.hidden || !modes.includes(mode)) return;
        if (mode === 'amiga') onChooseAmiga?.();
        else if (mode === 'atari-st') onChooseAtariSt?.();
        else if (mode === 'vr') onChooseVr?.();
        else {
            onChooseClassic?.();
            onChoose(mode);
        }
    }
    function move(direction: number) {
        for (let i = 0; i < links.length; i++) {
            selected = (selected + direction + links.length) % links.length;
            if (modes.includes(LAUNCH_CHOICES[selected].mode)) break;
        }
        links[selected].focus({ preventScroll: true });
    }
    for (const [index, link] of links.entries()) {
        const url = new URL(window.location.href);
        if (
            LAUNCH_CHOICES[index].mode === 'amiga' ||
            LAUNCH_CHOICES[index].mode === 'atari-st' ||
            LAUNCH_CHOICES[index].mode === 'vr'
        ) {
            url.searchParams.delete('graphics');
            url.searchParams.set('game', LAUNCH_CHOICES[index].mode);
        } else {
            url.searchParams.delete('game');
            url.searchParams.set('graphics', LAUNCH_CHOICES[index].query);
        }
        urls[index] = url.pathname + url.search + url.hash;
        link.href = urls[index];
        function handleLinkFocus() {
            selected = index;
        }
        events.on(link, 'focus', handleLinkFocus);
        function handleLinkClick(event: MouseEvent) {
            if (!modes.includes(LAUNCH_CHOICES[index].mode)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.shiftKey ||
                event.button !== 0
            )
                return;
            event.preventDefault();
            event.stopPropagation();
            choose(index);
        }
        events.on(link, 'click', handleLinkClick);
    }
    function handleKeyDown(event: KeyboardEvent) {
        if (element.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
        const key = tvKey(event, tv);
        // The page-level Fullscreen button owns its Enter/Space activation.
        if (
            (key === 'Enter' || event.code === 'Space') &&
            (event.target as Element | null)?.closest?.('#fullscreen')
        )
            return;
        if (
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(key || '') &&
            event.code !== 'Space'
        )
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        if (key === 'Enter' || event.code === 'Space') choose(selected);
        else move(key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1);
    }
    events.on(document, 'keydown', handleKeyDown, true);
    function handlePs4Press() {
        if (element.hidden) return false;
        if (document.activeElement?.id === 'fullscreen')
            (document.activeElement as HTMLElement).click();
        else choose(selected);
        return true;
    }
    createPs4MouseControl({ document, events, onPress: handlePs4Press, onRelease: () => {} });
    return {
        get active() {
            return !element.hidden;
        },
        setAvailable(available: readonly string[], ready = true) {
            availableModes = available;
            updateAvailability();
            status.textContent = ready ? '' : 'Could not load the game. Reload to try again.';
        },
        setVrSupported(
            supported: boolean,
            {
                reason = 'VR requires a compatible headset, WebXR and WebGL 2 support.',
                pending = false,
            }: { reason?: string; pending?: boolean } = {},
        ) {
            vrSupported = supported;
            vrReason = reason;
            updateAvailability();
            const card = links.find((link) => link.dataset.platform === 'vr');
            if (!supported && !pending && card === document.activeElement) move(1);
        },
        setUnavailable(mode: string) {
            const link = links.find((item) => item.dataset.platform === mode);
            if (link) {
                link.dataset.unavailable = 'true';
                link.title = 'Platform graphics unavailable. Choose another platform.';
            }
        },
        open() {
            element.hidden = false;
            shell.classList.add('game-app_selecting');
        },
        close() {
            element.hidden = true;
            shell.classList.remove('game-app_selecting');
        },
        gamepad(direction: number, confirm: boolean) {
            if (element.hidden) return;
            if (direction && direction !== previousDirection) move(direction);
            previousDirection = direction;
            if (confirm) choose(selected);
        },
    };
}
