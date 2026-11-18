import type { createGameMenusControl } from './game-menus.ts';
import type { createInput } from '../input/index.ts';
import type { EventScope, ScopedPointerEvent } from '../lib/events.ts';
import type { createAudio } from '../view/audio.ts';
import type { createSoundControl } from './sound.ts';
import type { createMusicController } from './music.ts';
import type { createPlatformPicker } from './platform-picker.ts';
import type { createControlMenuController } from './control-menu.ts';
import type { createSplitControl } from './split.ts';
import type { createScoreAttract } from '../model/high-scores.ts';
import type { ApplicationSessionView } from '../types/application.ts';
import { canvasPoint } from '../utils/canvas.ts';
import { createTvController } from './tv.ts';
import { isTvBrowser } from '../utils/tv.ts';

interface ApplicationInteractionOptions {
    document: Document;
    window: Window & typeof globalThis;
    gestures: EventScope;
    shell: HTMLElement;
    canvas: HTMLCanvasElement;
    touch: HTMLElement;
    graphicsSelect: HTMLSelectElement;
    menus: ReturnType<typeof createGameMenusControl>;
    nameForm: HTMLFormElement;
    nameInput: HTMLInputElement;
    input: ReturnType<typeof createInput>;
    audio: ReturnType<typeof createAudio>;
    music: ReturnType<typeof createMusicController>;
    soundControl: ReturnType<typeof createSoundControl>;
    platformPicker: ReturnType<typeof createPlatformPicker>;
    controlMenu: ReturnType<typeof createControlMenuController>;
    splitControl: ReturnType<typeof createSplitControl>;
    attract: ReturnType<typeof createScoreAttract>;
    session: ApplicationSessionView;
    hasRenderer(): boolean;
    activateTitle(): void;
    play(reset?: boolean): void;
    pause(): void;
    returnToTitle(): void;
}

function isKeyboardEvent(event: MouseEvent | KeyboardEvent): event is KeyboardEvent {
    return event.type === 'keydown';
}

export function createApplicationInteractions(options: ApplicationInteractionOptions) {
    const {
        document,
        window,
        gestures,
        shell,
        canvas,
        touch,
        graphicsSelect,
        menus,
        nameForm,
        nameInput,
        input,
        audio,
        music,
        soundControl,
        platformPicker,
        controlMenu,
        splitControl,
        attract,
        session,
        hasRenderer,
        activateTitle,
        play,
        pause,
        returnToTitle,
    } = options;
    let canvasPointerType = '';
    function handleCanvasPointerDown(event: ScopedPointerEvent) {
        canvasPointerType = event.pointerType;
    }
    gestures.on(canvas, 'pointerdown', handleCanvasPointerDown);
    function handleCanvasClick(event: MouseEvent) {
        if (menus.active) return;
        if (!nameForm.hidden) {
            nameInput.focus({ preventScroll: true });
            return;
        }
        if (event.isTrusted && session.mode === 'paused') {
            play();
            return;
        }
        if (event.isTrusted && session.mode === 'title' && hasRenderer()) {
            const box = canvas.getBoundingClientRect();
            const image = window.getComputedStyle(canvas).objectFit === 'contain' ? canvas : box;
            const point = canvasPoint(box, event.clientX, event.clientY, image);
            if (!point) return;
            const { x, y } = point;
            if (graphicsSelect.value !== 'split' || x < splitControl.position * 256) {
                // A title tap starts directly; only a visible control menu owns
                // touch row selection. Remember the pointer for older Safari,
                // whose compatibility click does not expose pointerType.
                if (controlMenu.available && (canvasPointerType !== 'touch' || controlMenu.active))
                    controlMenu.click(x, y);
                else if (session.menuPage === 'title') play(true);
            }
        }
        if (event.isTrusted && session.running && !soundControl.muted) void audio.unlock();
    }
    gestures.on(canvas, 'click', handleCanvasClick);
    function titleAudioGesture(event: MouseEvent | KeyboardEvent) {
        if (
            event.isTrusted &&
            isKeyboardEvent(event) &&
            session.running &&
            !soundControl.muted &&
            !document.hidden &&
            !event.repeat &&
            ['Space', 'KeyM'].includes(event.code) &&
            ['CANVAS', 'BODY'].includes((event.target as HTMLElement | null)?.tagName || '')
        ) {
            void audio.unlock();
            return;
        }
        if (
            platformPicker.active ||
            !event.isTrusted ||
            session.mode !== 'title' ||
            document.hidden
        )
            return;
        if (
            isKeyboardEvent(event) &&
            (event.repeat ||
                ['Enter', 'Digit1', 'Space', 'KeyM'].includes(event.code) ||
                ['Escape', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(
                    event.key,
                ) ||
                ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
                    (event.target as HTMLElement | null)?.tagName || '',
                ))
        )
            return;
        activateTitle();
        void music.play();
    }
    // Bubble after Start/Mute handlers so the first game click cannot start music.
    gestures.on(document, 'click', titleAudioGesture);
    gestures.on(document, 'keydown', titleAudioGesture);
    function handleTitleActivity(action: Event) {
        if (action.isTrusted && session.mode === 'title') attract.activity();
    }
    for (const event of ['pointerdown', 'keydown'])
        gestures.on(document, event, handleTitleActivity);
    function adjustSplit(direction: number) {
        input.reset();
        attract.activity();
        splitControl.setPosition(splitControl.position + direction * 0.02);
    }
    function handleRemoteActivity() {
        attract.activity();
        if (!platformPicker.active && !soundControl.muted) void audio.unlock();
    }
    function confirmRemoteAction() {
        if (!session.state || session.mode === 'error') return;
        if (session.mode === 'paused') play();
        else if (session.mode === 'title' && controlMenu.confirm()) return;
        else if (session.mode === 'title' || session.mode === 'over' || session.mode === 'won')
            play(true);
    }
    function handleRemoteBack() {
        if (platformPicker.active) return false;
        if (!session.state || session.mode === 'error') return false;
        if (session.mode === 'title' && session.menuPage === 'title' && !menus.active) return false;
        returnToTitle();
        canvas.focus();
        return true;
    }
    function toggleRemotePause() {
        if (menus.active || !['playing', 'paused'].includes(session.mode)) return false;
        if (session.running) pause();
        else play();
        return true;
    }
    const tvControl = createTvController({
        enabled: isTvBrowser(window.navigator.userAgent),
        shell,
        canvas,
        isPlaying: () => session.running && !menus.active && Boolean(nameForm.hidden),
        onCommand: input.setRemoteCommand,
        onClearCommands: input.clearRemoteCommands,
        onSplitAdjust: adjustSplit,
        onActivity: handleRemoteActivity,
        onConfirm: confirmRemoteAction,
        onBack: handleRemoteBack,
        onPause: toggleRemotePause,
    });
    function handleKeyDown(event: KeyboardEvent) {
        if (menus.active) return;
        if (platformPicker.active || !session.state) return;
        if (event.code === 'Escape') {
            event.preventDefault();
            if (!event.repeat) returnToTitle();
            return;
        }
        if (event.code === 'Pause' && ['playing', 'paused'].includes(session.mode)) {
            event.preventDefault();
            if (!event.repeat) {
                if (session.running) pause();
                else play();
            }
            return;
        }
        if (
            ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(
                (event.target as HTMLElement | null)?.tagName || '',
            )
        )
            return;
        if (
            session.mode === 'paused' &&
            !event.isComposing &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            ['Enter', 'Space', 'KeyM'].includes(event.code)
        ) {
            event.preventDefault();
            if (!event.repeat) play();
            return;
        }
        if (session.mode === 'title' && ['Digit1', 'Enter', 'Space', 'KeyM'].includes(event.code)) {
            event.preventDefault();
            if (!event.repeat) void play(true);
        }
    }
    gestures.on(window, 'keydown', handleKeyDown);

    function touchFire(event: ScopedPointerEvent | (MouseEvent & { pointerType?: string })) {
        if (
            event.type === 'click' &&
            (('detail' in event && event.detail !== 0) || event.pointerType)
        )
            return;
        if (
            (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]')?.dataset
                .action !== 'fire' ||
            (typeof event.button === 'number' && event.button !== 0) ||
            !session.state ||
            menus.active ||
            !nameForm.hidden
        )
            return;
        if (session.mode === 'paused') play();
        else if (session.mode === 'title' && !controlMenu.confirm() && !controlMenu.defining)
            play(true);
        else if (session.running && !soundControl.muted && event.isTrusted) void audio.unlock();
    }
    gestures.on(touch, 'pointerdown', touchFire);
    gestures.on(touch, 'click', touchFire);

    function handleBlur() {
        audio.stopCheatConfirmation();
        controlMenu.cancel();
    }
    gestures.on(window, 'blur', handleBlur);
    function handleVisibilityChange() {
        attract.suspend();
        if (document.hidden) {
            audio.stopCheatConfirmation();
            controlMenu.cancel();
            if (session.mode === 'title') {
                music.invalidate();
                audio.stopMusic();
            }
        } else if (session.mode === 'title') void music.play({ autoplay: true });
    }
    gestures.on(document, 'visibilitychange', handleVisibilityChange);
    return { destroy: () => tvControl.destroy() };
}
