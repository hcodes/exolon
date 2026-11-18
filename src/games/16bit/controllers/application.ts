import { createNotifications } from '../../../controllers/notifications.ts';
import { createGamepadHint } from '../../../controllers/gamepad-hint.ts';
import { versionAssetUrl } from '../../../services/asset-url.ts';
import { createCheatSettingsControl } from '../../../controllers/cheat-settings.ts';
import type { Cheats } from '../../../types/game.ts';
import type { NativeState, NativeOptions, NativeCommands, NativeStep } from '../types/index.ts';
import type { NativeGraphics } from '../types/graphics.ts';
import type { NativeWorld } from '../types/world.ts';
import type { NativePresentation } from '../view/renderer.ts';
import {
    normalizeNativeOptions,
    readNativeRows,
    readNativeLevel,
    qualifiesNativeScore,
    insertNativeScore,
    isOriginalNativeCheatName,
} from './preferences.ts';
import { createEventScope } from '../../../lib/events.ts';
import type { ScopedPointerEvent } from '../../../lib/events.ts';
import { createInput } from '../../../input/index.ts';
import { createClock } from '../../../lib/clock.ts';
import { createFullscreenControl } from '../../../controllers/fullscreen.ts';
import { createTvController } from '../../../controllers/tv.ts';
import { isTvBrowser } from '../../../utils/tv.ts';
import { isMobileBrowser } from '../../../utils/mobile.ts';
import { createGamepadNotifications } from '../../../controllers/gamepad-notifications.ts';
import { createGameMenusControl } from '../../../controllers/game-menus.ts';
import { createFpsControl } from '../../../controllers/fps.ts';
import { createActivityPause } from '../../../controllers/activity-pause.ts';
import { preferences } from '../../../services/preferences.ts';
import { getLocalStorageItem, setLocalStorageItem } from '../../../lib/LocalStorage/index.ts';

export interface NativeSound {
    unlock(): void;
    playTitle(): Promise<boolean>;
    playGameOver?: () => Promise<boolean>;
    stop(): void;
    setVolume(value: number): void;
    dispose(): void;
}
export interface NativeResources {
    world: NativeWorld;
    graphics: NativeGraphics;
}
export interface NativeRenderer {
    render(state: NativeState, now?: number, presentation?: NativePresentation): void;
}
export interface NativeApplicationProfile {
    readonly id: 'amiga' | 'atari-st';
    readonly name: string;
    readonly palHz: number;
    readonly tickHz: number;
    readonly screenPalFrames?: readonly number[];
    readonly restartMusic?: boolean;
    readonly asciiNames?: boolean;
    readonly storage: { readonly cheats: string; readonly scores: string; readonly name: string };
    readonly worldUrl: string;
    readonly graphicsUrl: string;
    createState(world: NativeWorld, options?: NativeOptions): NativeState;
    step(state: NativeState, commands: NativeCommands): NativeStep;
    validateResources(world: unknown, graphics: unknown): NativeResources;
    createRenderer(
        canvas: HTMLCanvasElement,
        graphics: NativeGraphics,
        world: NativeWorld,
    ): NativeRenderer;
}
export function createNativeApplication({
    document,
    window,
    audio,
    onPlatforms,
    profile,
}: {
    document: Document;
    window: Window & typeof globalThis;
    audio: NativeSound;
    profile: NativeApplicationProfile;
    onPlatforms: () => void;
}) {
    const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const canvas = element<HTMLCanvasElement>('game');
    const gamepadHint = createGamepadHint({
        element: element('gamepad-hint'),
        button: element<HTMLButtonElement>('gamepad-hint-dismiss'),
        canvas,
        view: window,
    });
    const shell = document.querySelector<HTMLElement>('.game-app')!;
    const input = createInput(window, element('touch'));
    const events = createEventScope(window);
    const fps = createFpsControl(document, events);
    const pauseButton = element<HTMLButtonElement>('pause');
    const startButton = element<HTMLButtonElement>('new-game');
    const nameInput = element<HTMLInputElement>(profile.id + '-player-name');
    let options = normalizeNativeOptions(getLocalStorageItem(profile.storage.cheats));
    let initialLevel = readNativeLevel(window.location.search);
    let titleSince: number | undefined;
    let resourceRequest: AbortController | undefined;
    let resources: NativeResources | undefined;
    let renderer: NativeRenderer | undefined;
    let presentationPage: NativePresentation['page'];
    let presentationSince: number | undefined;
    let state: NativeState | undefined;
    let mode: 'title' | 'scores' | 'playing' | 'end' | 'name' = 'title';
    let paused = false,
        disposed = false,
        loading = false,
        muted = false;
    let frameId: number | undefined;
    let rows = readNativeRows(getLocalStorageItem(profile.storage.scores), profile.asciiNames);
    nameInput.value = getLocalStorageItem(profile.storage.name) || 'PLAYER';
    const cleanName = () =>
        (profile.asciiNames ? nameInput.value : nameInput.value.toUpperCase())
            .replace(profile.asciiNames ? /[^\x20-\x7e]/g : /[^A-Z0-9. ]/g, '')
            .slice(0, 10);
    const notifications = createNotifications(element('notifications'), window);
    const padNotice = createGamepadNotifications({
        view: window,
        events,
        notifications,
    });
    function playMusic() {
        if (muted || disposed || document.hidden) return;
        void audio.playTitle();
    }
    function focusGame() {
        canvas.focus({ preventScroll: true });
    }
    function page(): NativePresentation['page'] {
        return mode === 'title' || mode === 'scores' || mode === 'name' ? mode : undefined;
    }
    function draw(now: number) {
        if (!state || !renderer || disposed) return;
        presentationSince ??= now;
        const presentation = {
            page: page(),
            startedAt: presentationSince,
            paused,
            rows,
            name: cleanName(),
        };
        canvas.dataset.graphics = profile.id;
        renderer.render(state, now, presentation);
        fps.frame(now);
    }
    function refresh() {
        const palFrames = state && profile.screenPalFrames?.[state.screenIndex];
        clock.setInterval(palFrames ? (palFrames * 1000) / profile.palHz : 1000 / profile.tickHz);
        const nextPage = page();
        if (nextPage !== presentationPage) {
            presentationPage = nextPage;
            presentationSince = undefined;
        }
        canvas.dataset.menu = mode;
        canvas.dataset.status = paused ? 'paused' : state?.status || 'loading';
        canvas.setAttribute(
            'aria-label',
            `${profile.name} Exolon. ${mode === 'playing' ? (paused ? 'Paused' : `Screen ${(state?.screenIndex || 0) + 1}`) : mode}`,
        );
        startButton.hidden = mode === 'playing';
        if (resources)
            startButton.textContent =
                mode === 'name' ? 'Save name' : mode === 'end' ? 'Continue' : 'Start game';
        element('show-scores').textContent = mode === 'scores' ? 'Back' : 'Scores';
        element('show-scores').hidden = mode === 'playing' || mode === 'name';
        for (const id of ['pause', 'restart', 'menu']) element(id).hidden = mode !== 'playing';
        pauseButton.disabled = !state;
        pauseButton.textContent = paused ? 'Resume' : 'Pause';
        pauseButton.setAttribute('aria-pressed', String(paused));
        cheatSettings.update(readCheats());
        element('cheat-navigation').hidden = !options.levelSelection;
        element('cheat-screen').textContent =
            `SCREEN ${String((state?.screenIndex || 0) + 1).padStart(3, '0')} / 125`;
        nameInput.hidden = mode !== 'name';
    }
    function returnToTitle() {
        activity.revokeResume();
        mode = 'title';
        paused = false;
        initialLevel = 0;
        titleSince = undefined;
        nameInput.blur();
        input.reset();
        clock.reset();
        if (resources) state = profile.createState(resources.world, { ...options });
        playMusic();
        refresh();
        focusGame();
    }
    function begin(restart = false) {
        if (!resources || disposed) return;
        activity.revokeResume();
        if (!state || restart || mode !== 'playing') {
            const screenIndex = restart
                ? 0
                : (mode === 'end' || mode === 'scores') && options.restartSameLevel
                  ? (state?.screenIndex ?? initialLevel)
                  : initialLevel;
            state = profile.createState(resources.world, { ...options, screenIndex });
        }
        mode = 'playing';
        paused = false;
        input.reset();
        if (profile.restartMusic !== false) audio.stop();
        playMusic();
        clock.reset();
        clock.resume();
        refresh();
        focusGame();
        gamepadHint.onStart();
    }
    function togglePause() {
        activity.revokeResume();
        if (mode !== 'playing') return;
        paused = !paused;
        input.reset();
        if (paused) {
            clock.pause();
        } else {
            clock.resume();
            playMusic();
        }
        refresh();
        focusGame();
    }
    function enterName() {
        if (!state) return;
        mode = 'name';

        input.reset();
        clock.pause();
        refresh();
        nameInput.focus({ preventScroll: true });
    }
    function saveName() {
        if (isOriginalNativeCheatName(nameInput.value)) {
            options = { ...options, infiniteLives: true };
            setLocalStorageItem(profile.storage.cheats, JSON.stringify(options));
            if (state) state = { ...state, options: { ...options } };
            notifications.show('Infinite lives enabled');
        }
        const name = cleanName() || 'PLAYER';
        setLocalStorageItem(profile.storage.name, name);
        if (state) {
            rows = insertNativeScore(rows, name, state.score);
            setLocalStorageItem(profile.storage.scores, JSON.stringify(rows));
        }
        nameInput.blur();
        mode = 'scores';

        input.reset();
        refresh();
        playMusic();
        focusGame();
    }
    function confirm() {
        if (mode === 'name') saveName();
        else if (mode === 'end') {
            if (state?.status === 'won') {
                state = profile.step(profile.step(state, {}).state, { fire: true }).state;
                mode = 'playing';
                paused = false;
                input.reset();
                audio.stop();
                clock.reset();
                clock.resume();
                refresh();
                focusGame();
            } else if (state && qualifiesNativeScore(state.score, rows)) enterName();
            else if (options.restartSameLevel) begin();
            else {
                mode = 'scores';

                input.reset();
                refresh();
                playMusic();
                focusGame();
            }
        } else if (mode !== 'playing') begin();
        else if (paused) togglePause();
    }
    const clock = createClock(() => {
        if (!state || mode !== 'playing' || paused) return;
        const result = profile.step(state, input.sample());
        state = result.state;
        if (
            profile.restartMusic !== false &&
            result.events.some((event) => event.type === 'screen') &&
            state.screenIndex % 25 === 0
        ) {
            audio.stop();
            playMusic();
        }

        if (state.status === 'won' || state.status === 'over') {
            mode = 'end';
            if (state.status === 'over' && audio.playGameOver) void audio.playGameOver();
            clock.pause();
            input.reset();
            refresh();
        } else if (result.events.some((event) => event.type === 'screen')) refresh();
    }, 1000 / profile.tickHz);
    const fullscreen = createFullscreenControl(shell, element('fullscreen'), {
        onEscape: returnToTitle,
        onChange: () => input.reset(),
    });
    const menus = createGameMenusControl({
        document,
        storage: preferences,
        events,
        onToggle: () => input.reset(),
        isRunning: () => mode === 'playing' && !paused,
        pause: togglePause,
        resume: togglePause,
        canResume: () => !disposed && mode === 'playing' && paused,
    });
    const tv = createTvController({
        enabled: isTvBrowser(window.navigator.userAgent),
        shell,
        canvas,
        isPlaying: () => mode === 'playing' && !paused,
        onConfirm: confirm,
        onSplitAdjust: () => {},
        onBack: () => {
            returnToTitle();
            return true;
        },
        onPause: () => {
            togglePause();
            return true;
        },
        onActivity: () => {},
        onCommand: input.setRemoteCommand,
        onClearCommands: input.clearRemoteCommands,
    });
    shell.classList.toggle(
        'game-app_touch',
        isMobileBrowser(window.navigator.userAgent, window.navigator.maxTouchPoints),
    );
    events.on(startButton, 'click', () => {
        if (!resources) void start();
        else confirm();
    });
    events.on(element('restart'), 'click', () => begin(true));
    events.on(pauseButton, 'click', togglePause);
    events.on(element('menu'), 'click', returnToTitle);
    events.on(element('platforms'), 'click', onPlatforms);
    events.on(element('show-scores'), 'click', () => {
        mode = mode === 'scores' ? 'title' : 'scores';

        input.reset();
        refresh();
        focusGame();
    });
    events.on(canvas, 'click', () => {
        if (menus.active) return;
        if (mode === 'name') nameInput.focus();
        else if (mode !== 'playing' || paused) confirm();
    });
    function handleTouchFire(event: ScopedPointerEvent | (MouseEvent & { pointerType?: string })) {
        if (
            menus.active ||
            !paused ||
            mode !== 'playing' ||
            (typeof event.button === 'number' && event.button !== 0) ||
            (event.type === 'click' &&
                (('detail' in event && event.detail !== 0) || event.pointerType)) ||
            (event.target as Element | null)?.closest<HTMLElement>('[data-action]')?.dataset
                .action !== 'fire'
        )
            return;
        togglePause();
    }
    events.on(element('touch'), 'pointerdown', handleTouchFire);
    events.on(element('touch'), 'click', handleTouchFire);
    events.on(element('volume'), 'input', () =>
        audio.setVolume(muted ? 0 : Number(element<HTMLInputElement>('volume').value)),
    );
    events.on(element('sound'), 'click', () => {
        muted = !muted;
        const button = element('sound');
        button.setAttribute('aria-pressed', String(muted));
        button.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        audio.setVolume(muted ? 0 : Number(element<HTMLInputElement>('volume').value));
        audio.stop();
        if (!muted) playMusic();
    });
    function readCheats(): Cheats {
        return {
            infiniteLives: Boolean(options.infiniteLives),
            infiniteRockets: Boolean(options.infiniteGrenades),
            infiniteAmmo: Boolean(options.infiniteAmmo),
            invulnerable: Boolean(options.invulnerable),
            levelSelection: Boolean(options.levelSelection),
            retryLevel: Boolean(options.restartSameLevel),
        };
    }
    function changeCheats(value: Cheats) {
        if (disposed || !resources) return;
        options = normalizeNativeOptions({
            infiniteLives: value.infiniteLives,
            infiniteGrenades: value.infiniteRockets,
            infiniteAmmo: value.infiniteAmmo,
            invulnerable: value.invulnerable,
            levelSelection: value.levelSelection,
            restartSameLevel: value.retryLevel,
        });
        setLocalStorageItem(profile.storage.cheats, JSON.stringify(options));
        if (state) state = { ...state, options: { ...options } };
        refresh();
    }
    const cheatSettings = createCheatSettingsControl({
        document,
        events,
        options: readCheats(),
        onChange: changeCheats,
    });
    for (const [id, delta] of [
        ['previous-screen', -1],
        ['next-screen', 1],
    ] as const)
        events.on(element(id), 'click', () => {
            if (!resources || !state || !options.levelSelection) return;
            const index = (state.screenIndex + delta + 125) % 125;
            state = profile.createState(resources.world, { ...options, screenIndex: index });
            initialLevel = index;
            input.reset();
            refresh();
            focusGame();
        });
    events.on(nameInput, 'input', () => {
        // Retain raw case for the original secret; display and records still use cleanName().
        nameInput.value = nameInput.value
            .replace(profile.asciiNames ? /[^\x20-\x7e]/g : /[^A-Za-z0-9. ]/g, '')
            .slice(0, 10);
    });
    events.on(nameInput, 'keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            saveName();
        }
    });
    events.on(window, 'keydown', (event) => {
        if (menus.active || (event.defaultPrevented && mode === 'playing' && !paused)) return;
        if (event.code === 'Escape') {
            event.preventDefault();
            returnToTitle();
            return;
        }
        if (
            mode === 'name' ||
            event.repeat ||
            ['INPUT', 'BUTTON', 'SELECT'].includes((event.target as Element | null)?.tagName || '')
        )
            return;
        if (event.code === 'KeyF') {
            event.preventDefault();
            element('sound').click();
        } else if (event.code === 'Pause' || (event.code === 'KeyP' && event.ctrlKey)) {
            event.preventDefault();
            togglePause();
        } else if (
            (mode !== 'playing' || paused) &&
            !event.isComposing &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            ['Space', 'KeyM', 'Enter', 'Digit1'].includes(event.code)
        ) {
            event.preventDefault();
            confirm();
        }
    });
    const activity = createActivityPause({
        document,
        events,
        isRunning: () => mode === 'playing' && !paused,
        pause: togglePause,
        resume: togglePause,
        canResume: () => !disposed && mode === 'playing' && paused && !menus.active,
    });
    events.on(document, 'visibilitychange', () => {
        if (document.hidden) {
            audio.stop();
        } else playMusic();
    });
    events.on(window, 'pagehide', () => {
        if (mode === 'playing' && !paused) togglePause();
        audio.stop();
    });
    function frame(now: number) {
        if (disposed) return;
        const pad = input.pollGamepad(!document.hidden && document.hasFocus());
        padNotice.update(pad);
        if (pad.lost) activity.revokeResume();
        if (pad.lost && mode === 'playing' && !paused) togglePause();
        if (!menus.gamepad(pad) && pad.status === 'ready') {
            if (pad.pressed.pause) {
                if (mode === 'playing') togglePause();
                else confirm();
            } else if (pad.pressed.back) returnToTitle();
            else if (pad.pressed.confirm || ((mode !== 'playing' || paused) && pad.commands.fire))
                confirm();
            else if (pad.pressed.scores && mode === 'title') {
                mode = 'scores';

                refresh();
            }
        }
        if (!menus.active) {
            if (mode === 'playing' && !paused && !clock.frame(now)) togglePause();
            else if (mode !== 'playing' && mode !== 'name' && input.sample().fire) confirm();
        }
        if (mode === 'title' && !menus.active) {
            titleSince ??= now;
            if (now - titleSince >= 0x500 * (1000 / profile.palHz)) {
                mode = 'scores';

                refresh();
            }
        } else titleSince = undefined;
        if (disposed) return;
        draw(now);
        frameId = window.requestAnimationFrame(frame);
    }
    async function start() {
        if (disposed || loading) return;
        loading = true;
        resourceRequest =
            typeof window.AbortController === 'function' ? new window.AbortController() : undefined;
        startButton.disabled = true;
        playMusic();
        try {
            const responses = await Promise.all(
                [profile.worldUrl, profile.graphicsUrl].map((url) =>
                    window.fetch(
                        versionAssetUrl(url),
                        resourceRequest ? { signal: resourceRequest.signal } : undefined,
                    ),
                ),
            );
            if (disposed) return;
            if (responses.some((response) => !response.ok))
                throw new Error(profile.name + ' resources unavailable');
            const values: unknown[] = await Promise.all(
                responses.map((response) => response.json()),
            );
            if (disposed) return;
            const nextResources = profile.validateResources(values[0], values[1]);
            const nextState = profile.createState(nextResources.world, {
                ...options,
                screenIndex: initialLevel,
            });
            const nextRenderer = profile.createRenderer(
                canvas,
                nextResources.graphics,
                nextResources.world,
            );
            nextRenderer.render(nextState, 0, { page: 'title' });
            resources = nextResources;
            state = nextState;
            renderer = nextRenderer;
            if (!rows.length)
                rows = resources.graphics.highScores.map((row) => ({
                    name: profile.asciiNames ? row.name : row.name.toUpperCase(),
                    score: row.score,
                }));
            startButton.disabled = false;
            startButton.textContent = 'Start game';
            element<HTMLButtonElement>('show-scores').disabled = false;
            cheatSettings.setEnabled(true);
            element<HTMLButtonElement>('restart').disabled = false;
            element<HTMLButtonElement>('menu').disabled = false;
            refresh();
            focusGame();
            if (frameId === undefined) frameId = window.requestAnimationFrame(frame);
        } catch {
            if (disposed) return;
            cheatSettings.setEnabled(false);
            resources = undefined;
            renderer = undefined;
            state = undefined;
            audio.stop();
            startButton.textContent = 'Retry';
            startButton.disabled = false;
            const context = canvas.getContext('2d');
            if (context) {
                context.fillStyle = '#000';
                context.fillRect(0, 0, 320, 200);
                context.fillStyle = '#fff';
                context.font = '12px monospace';
                context.fillText(profile.name + ' resources could not be loaded.', 12, 90);
                context.fillText('Choose Retry or Platforms below.', 12, 110);
            }
        } finally {
            loading = false;
        }
    }
    return {
        start,
        destroy() {
            if (disposed) return;
            disposed = true;
            resourceRequest?.abort();
            if (frameId !== undefined) window.cancelAnimationFrame(frameId);
            clock.destroy();
            input.destroy();
            tv.destroy();
            fullscreen.destroy();
            notifications.destroy();
            gamepadHint.destroy();
            events.destroy();
            audio.dispose();
        },
    };
}
