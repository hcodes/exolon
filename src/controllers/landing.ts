import { createEventScope } from '../lib/events.ts';
import { createGamepadInput } from '../input/gamepad.ts';
import { createFullscreenControl } from './fullscreen.ts';
import { createPlatformPicker } from './platform-picker.ts';
import { PLATFORM_CHOICES } from '../constants/platforms.ts';
import { isTvBrowser } from '../utils/tv.ts';
import { isPs4Browser } from '../utils/ps4.ts';
import { canUseVr } from '../utils/vr-support.ts';
import { supportsVrGame } from '../services/game-loader.ts';
import { createPickerShip } from './picker-ship.ts';
import { createPickerStars } from './picker-stars.ts';
import { createPickerTitle } from './picker-title.ts';

export function createLanding({
    document,
    window,
    preferred,
    onChoose,
}: {
    document: Document;
    window: Window & typeof globalThis;
    preferred: string;
    onChoose: (mode: string) => void;
}) {
    const shell = document.querySelector<HTMLElement>('.game-app')!;
    const userAgent = window.navigator.userAgent;
    const tv = isTvBrowser(userAgent);
    const animated = !tv && !isPs4Browser(userAgent);
    document
        .querySelector<HTMLElement>('.platform-picker')!
        .classList.toggle('platform-picker_static', !animated);
    const events = createEventScope(window);
    const gamepad = createGamepadInput(window.navigator);
    const destroyShip = createPickerShip({ document, window, animated });
    const destroyStars = createPickerStars({ document, window, animated });
    const destroyTitle = createPickerTitle({ document, window, animated });
    shell.classList.toggle('game-app_tv', tv);
    const picker = createPlatformPicker({
        document,
        window,
        events,
        shell,
        preferred,
        onChoose,
        onChooseAmiga: () => onChoose('amiga'),
        onChooseAtariSt: () => onChoose('atari-st'),
        onChooseVr: () => onChoose('vr'),
    });
    picker.setAvailable(PLATFORM_CHOICES.map(({ mode }) => mode));
    const fullscreen = createFullscreenControl(
        shell,
        document.querySelector<HTMLButtonElement>('#fullscreen')!,
    );
    let disposed = false;
    let frame: number | undefined;
    let supportRevision = 0;
    function hasWebGl2() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('webgl2');
        if (!context) return false;
        context.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    }
    async function updateVrSupport() {
        const revision = ++supportRevision;
        picker.setVrSupported(false, { reason: 'Checking VR support…', pending: true });
        function hasCurrentWebGl2() {
            return !disposed && revision === supportRevision && hasWebGl2();
        }
        const supported = await canUseVr({
            modern: supportsVrGame,
            secure: Boolean(window.isSecureContext),
            xr: window.navigator.xr,
            hasWebGl2: hasCurrentWebGl2,
        });
        if (disposed || revision !== supportRevision) return;
        picker.setVrSupported(supported);
    }
    function handleVrDeviceChange() {
        void updateVrSupport();
    }
    events.on(window.navigator.xr, 'devicechange', handleVrDeviceChange);
    void updateVrSupport();
    function poll() {
        frame = undefined;
        if (disposed) return;
        const pad = gamepad.poll(!document.hidden && document.hasFocus());
        if (pad.status === 'ready') {
            picker.gamepad(
                pad.navigation.x || pad.navigation.y,
                pad.pressed.confirm || pad.pressed.pause,
            );
        }
        if (!disposed) frame = window.requestAnimationFrame(poll);
    }
    function handlePageHide() {
        supportRevision++;
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        frame = undefined;
        gamepad.reset();
    }
    events.on(window, 'pagehide', handlePageHide);
    function handlePageShow(event: PageTransitionEvent) {
        if (!disposed && frame === undefined) frame = window.requestAnimationFrame(poll);
        if (event.persisted && !disposed) void updateVrSupport();
    }
    events.on(window, 'pageshow', handlePageShow);
    frame = window.requestAnimationFrame(poll);
    function destroy() {
        disposed = true;
        supportRevision++;
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        gamepad.reset();
        events.destroy();
        destroyShip();
        destroyStars();
        destroyTitle();
        fullscreen.destroy();
    }
    return destroy;
}
