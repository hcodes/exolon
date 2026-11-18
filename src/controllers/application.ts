import type { PlatformMode } from '../constants/platforms.ts';
import { createApplicationLoop } from './application-loop.ts';
import { createFpsControl } from './fps.ts';
import { createTitleNavigation } from './title-navigation.ts';
import { createApplicationSession } from './application-session.ts';
import { createOptionalGraphicsInstaller } from './optional-graphics.ts';
import { createCheatSession } from './cheat-session.ts';
import { createGamepadNavigation } from './gamepad-navigation.ts';
import { createApplicationInteractions } from './application-interactions.ts';
import type { ApplicationSessionView } from '../types/application.ts';
import { createNotifications } from './notifications.ts';
import type { World } from '../types/game.ts';
import { gameElement } from '../utils/dom.ts';
import { createState } from '../model/state.ts';
import { readGameIdentity } from '../utils/game-launch.ts';
import { createPlatformPicker } from './platform-picker.ts';
import { createGameMenusControl } from './game-menus.ts';
import { createActivityPause } from './activity-pause.ts';
import { createInput } from '../input/index.ts';
import { createEventScope } from '../lib/events.ts';
import { createFullscreenControl } from './fullscreen.ts';
import { createSplitControl } from './split.ts';
import { createRenderer } from '../view/renderer.ts';
import { createAudio } from '../view/audio.ts';
import { createScoreAttract } from '../model/high-scores.ts';
import { SCREEN_COUNT, getSimulationInterval } from '../constants/game.ts';
import { readLaunchOptions } from '../utils/settings.ts';
import { createControlMenuController } from './control-menu.ts';
import { loadGameResources } from '../services/resources.ts';
import { preferences } from '../services/preferences.ts';
import { createScoreController } from './scores.ts';
import { createMusicController } from './music.ts';
import { createGraphicsController } from './graphics.ts';
import { createGamepadNotifications } from './gamepad-notifications.ts';
import { createGamepadHint } from './gamepad-hint.ts';
import { createHud } from './hud.tsx';
import { createScoreView } from './score-view.tsx';
import { createSoundControl } from './sound.ts';
import { isMobileBrowser } from '../utils/mobile.ts';

export function createApplication({
    document,
    window,
    onChooseAmiga,
    onChooseAtariSt,
    onChooseClassic,
    onPlatforms,
    skipPlatformPicker = false,
    audioContext,
}: {
    document: Document;
    window: Window & typeof globalThis;
    onChooseAmiga?: () => void;
    onChooseAtariSt?: () => void;
    onChooseClassic?: (mode?: string) => void;
    onPlatforms?: () => void;
    skipPlatformPicker?: boolean;
    audioContext?: AudioContext;
}) {
    const byId = <K extends string>(id: K) => gameElement(document, id);
    const canvas = byId('game');
    const gamepadHint = createGamepadHint({
        element: byId('gamepad-hint'),
        button: byId('gamepad-hint-dismiss'),
        canvas,
        view: window,
    });
    const shell = document.querySelector<HTMLElement>('.game-app')!;
    const touch = byId('touch');
    const gestures = createEventScope(window);
    const grayscale = byId('monochrome');
    grayscale.checked = preferences.get('monochrome') === 'true';
    function updateGrayscale() {
        canvas.classList.toggle('game-viewport__canvas_grayscale', grayscale.checked);
    }
    function handleGrayscaleChange() {
        updateGrayscale();
        preferences.set('monochrome', grayscale.checked);
    }
    updateGrayscale();
    gestures.on(grayscale, 'change', handleGrayscaleChange);
    if (onPlatforms) gestures.on(byId('platforms'), 'click', onPlatforms);
    const resourceRequest =
        typeof window.AbortController === 'function' ? new window.AbortController() : undefined;
    const launch = readLaunchOptions(window.location.search, preferences.get('graphics'));
    const graphicsSelect = byId('graphics-mode');
    graphicsSelect.value = launch.graphicsMode;
    const overlay = byId('overlay');
    const pauseButton = byId('pause');
    const restart = byId('restart');
    const status = byId('mission-status');
    const title = byId('title-screen');
    const newGame = byId('new-game');
    const nameForm = byId('name-entry');
    const nameInput = byId('player-name');
    const audio = createAudio({ graphicsMode: graphicsSelect.value, context: audioContext });
    const input = createInput(window, touch);
    shell.classList.toggle(
        'game-app_touch',
        isMobileBrowser(window.navigator.userAgent, window.navigator.maxTouchPoints),
    );
    let renderer: ReturnType<typeof createRenderer>;
    let world: World;
    let disposed = false;
    let bonusFire = false;
    function handleMenuToggle(collapsed: boolean) {
        if (!collapsed) controlMenu.cancel();
        input.reset();
        if (session.running && collapsed) canvas.focus({ preventScroll: true });
    }
    const menus = createGameMenusControl({
        document,
        storage: preferences,
        events: gestures,
        onToggle: handleMenuToggle,
        isRunning: () => session.running,
        pause: () => session.pause(),
        resume: () => session.play(),
        canResume: () => !disposed && session.mode === 'paused',
    });
    const fps = createFpsControl(document, gestures);
    const scores = createScoreController(preferences);
    function handleBonusStop() {
        bonusFire = true;
        canvas.focus({ preventScroll: true });
    }
    const hud = createHud(document, handleBonusStop),
        scoreView = createScoreView(document);
    function handleUnmute() {
        if (session.running) void audio.unlock();
        else void music.play();
    }
    const soundControl = createSoundControl({
        button: byId('sound'),
        volume: byId('volume'),
        audio,
        events: gestures,
        onUnmute: handleUnmute,
        onInteraction: () => {
            if (session.running) canvas.focus({ preventScroll: true });
        },
    });
    const music = createMusicController({
        audio,
        status: byId('music-status'),
        graphicsMode: graphicsSelect.value,
        isEligible: () =>
            !platformPicker.active &&
            session.mode === 'title' &&
            !document.hidden &&
            !title.hidden &&
            session.titleActivated,
        isMuted: () => soundControl.muted,
    });
    const notifications = createNotifications(byId('notifications'), window);
    const gamepadNotifications = createGamepadNotifications({
        view: window,
        notifications,
        events: gestures,
    });
    const attract = createScoreAttract();
    function openControlMenu() {
        attract.showMenu();
        titleNavigation.showPage('menu');
    }
    function startControlMenuGame(fromGamepad = false) {
        gamepadNavigation.setSession(fromGamepad);
        void session.play(true);
    }
    function handleOriginalCheat(mode: string) {
        const enabled = cheats.toggleInfiniteLives();
        notifications.show(enabled ? 'Infinite lives enabled' : 'Infinite lives disabled');
        audio.stopCheatConfirmation();
        if (enabled && !soundControl.muted) void audio.playCheatConfirmation(mode);
    }
    const controlMenu = createControlMenuController({
        canvas,
        button: byId('show-controls'),
        events: gestures,
        input,
        isTitle: () => session.mode === 'title' && !platformPicker.active,
        isActive: () =>
            session.mode === 'title' &&
            (titleNavigation.page === 'menu' ||
                (titleNavigation.page === 'title' &&
                    (renderer?.graphicsMode === 'sharp-mz800' ||
                        (renderer?.graphicsMode === 'split' &&
                            renderer.splitModes.left === 'sharp-mz800')))) &&
            !menus.active,
        open: openControlMenu,
        start: startControlMenuGame,
        activity: () => attract.activity(),
        onCheat: handleOriginalCheat,
    });
    function handleSplitInteraction() {
        input.reset();
        attract.activity();
    }
    const splitControl = createSplitControl(byId('split-divider'), canvas, {
        onChange: (position) => {
            renderer?.setSplitPosition(position);
        },
        onInteraction: handleSplitInteraction,
    });
    let ensureGraphics: ((modes: readonly string[]) => Promise<void>) | undefined;
    function chooseNativeGame(mode: 'amiga' | 'atari-st') {
        if (mode === 'amiga') onChooseAmiga?.();
        else onChooseAtariSt?.();
    }
    function handleGraphicsActivity() {
        audio.stopCheatConfirmation();
        if (controlMenu.defining) controlMenu.cancel();
        attract.activity();
    }
    function changeSimulationMode(value: string) {
        clock.setInterval(getSimulationInterval(value));
        controlMenu.setMode(value, session.running);
    }
    function changeAudioMode(value: string) {
        music.setGraphicsMode(value);
        if (session.mode === 'title' && session.state) void music.play();
    }
    const graphicsControl = createGraphicsController({
        loadModes: (modes) => ensureGraphics?.(modes),
        onChooseClassic,
        onChooseNative: chooseNativeGame,
        select: graphicsSelect,
        options: byId('split-options'),
        left: byId('split-left'),
        right: byId('split-right'),
        splitControl,
        storage: preferences,
        events: gestures,
        onActivity: handleGraphicsActivity,
        onInteraction: () => {
            if (session.running) canvas.focus({ preventScroll: true });
        },
        onTimingMode: changeSimulationMode,
        onAudioMode: changeAudioMode,
    });
    function chooseClassicPlatform(mode: PlatformMode) {
        graphicsSelect.value = mode;
        graphicsSelect.dispatchEvent(new Event('change', { bubbles: true }));
        platformPicker.close();
        session.titleActivated = true;
        renderer.renderTitle(0);
        void music.play();
        canvas.focus({ preventScroll: true });
        window.dispatchEvent(new Event('resize'));
    }
    const platformPicker = createPlatformPicker({
        document,
        window,
        events: gestures,
        shell,
        preferred:
            readGameIdentity(window.location.search) !== 'classic'
                ? readGameIdentity(window.location.search)
                : launch.graphicsMode,
        onChooseAmiga,
        onChooseAtariSt,
        onChooseClassic,
        onChoose: chooseClassicPlatform,
    });
    platformPicker.setAvailable([]);
    // Original game-loop duration is variable; simulation and drawing remain separate.
    function consumeBonusFire() {
        const fire = bonusFire;
        bonusFire = false;
        return fire;
    }
    const loop = createApplicationLoop({
        window,
        input,
        audio,
        attract,
        splitControl,
        status,
        nameForm,
        nameInput,
        getSession: () => session,
        getRenderer: () => renderer,
        getTitleNavigation: () => titleNavigation,
        isPickingPlatform: () => platformPicker.active,
        isDisposed: () => disposed,
        pollGamepad: () => gamepadNavigation.poll(),
        updateHud,
        consumeBonusFire: consumeBonusFire,
        onRender: fps.frame,
    });
    const clock = loop.clock;

    const cheats = createCheatSession({
        document,
        gestures,
        preferences,
        input,
        clock,
        audio,
        attract,
        getState: () => session.state,
        setState: (next) => {
            session.state = next;
        },
        getWorld: () => world,
        getRenderer: () => renderer,
        getMode: () => session.mode,
        pause: () => session.pause(),
        play: () => session.play(),
        updateHud,
        updateGameOverControls: () => session.updateGameOverControls(),
        clearBonus: () => {
            bonusFire = false;
        },
    });
    const session = createApplicationSession({
        document,
        initialScreen: launch.screenIndex,
        input,
        clock,
        audio,
        music,
        scores,
        cheats,
        attract,
        hud,
        controlMenu,
        getWorld: () => world,
        getRenderer: () => renderer,
        isPickingPlatform: () => platformPicker.active,
        updateHud,
        showMenuPage: (page) => titleNavigation.showPage(page),
        onTitle() {
            activity.revokeResume();
            gamepadNavigation.setSession(false);
        },
        onPause: () => activity.revokeResume(),
        onStart() {
            activity.revokeResume();
            gamepadHint.onStart();
        },
        clearBonus: () => {
            bonusFire = false;
        },
    });
    const activity = createActivityPause({
        document,
        events: gestures,
        isRunning: () => session.running,
        pause: session.pause,
        resume: session.play,
        canResume: () =>
            !disposed &&
            session.mode === 'paused' &&
            !menus.active &&
            Boolean(nameForm.hidden) &&
            !platformPicker.active,
    });
    const titleNavigation = createTitleNavigation({
        document,
        gestures,
        attract,
        scores,
        scoreView,
        controlMenu,
        getSession: () => session,
        getRenderer: () => renderer,
    });
    const fullscreenControl = createFullscreenControl(shell, byId('fullscreen'), {
        onEscape: returnToTitle,
        onChange() {
            if (session.running) canvas.focus({ preventScroll: true });
            else if (!nameForm.hidden) nameInput.focus({ preventScroll: true });
        },
    });
    if (skipPlatformPicker) {
        platformPicker.close();
        session.titleActivated = true;
        // Unlock within the selector gesture, before resource loading.
        if (!soundControl.muted) void audio.unlock();
    }
    function updateHud() {
        cheats.update();
        hud.render(session.state, session.mode);
    }
    function saveScore() {
        scores.save(session.state);
    }
    gestures.on(newGame, 'click', () => void session.play(true));
    gestures.on(byId('menu'), 'click', session.showTitle);
    gestures.on(restart, 'click', () => void session.play(true));
    gestures.on(pauseButton, 'click', () =>
        session.running ? session.pause() : void session.play(),
    );
    function returnToTitle() {
        if (platformPicker.active) return;
        if (controlMenu.defining) {
            controlMenu.cancel();
            return;
        }
        if (!session.state || session.mode === 'error') return;
        if (session.mode === 'title') {
            if (titleNavigation.page !== 'title') {
                titleNavigation.closeScores();
                canvas.focus({ preventScroll: true });
            }
        } else session.showTitle();
    }
    const sessionView: ApplicationSessionView = {
        get state() {
            return session.state;
        },
        get running() {
            return session.running;
        },
        get mode() {
            return session.mode;
        },
        get menuPage() {
            return titleNavigation.page;
        },
    };
    const gamepadNavigation = createGamepadNavigation({
        menus,
        document,
        input,
        gamepadNotifications,
        platformPicker,
        controlMenu,
        attract,
        nameForm,
        saveName: byId('save-name'),
        session: sessionView,
        play: session.play,
        pause: session.pause,
        showTitle: session.showTitle,
        openScores: titleNavigation.openScores,
        closeScores: titleNavigation.closeScores,
        triggerBonus: () => {
            bonusFire = true;
        },
    });
    const interactions = createApplicationInteractions({
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
        session: sessionView,
        play: session.play,
        pause: session.pause,
        returnToTitle,
        hasRenderer: () => Boolean(renderer),
        activateTitle: () => {
            session.titleActivated = true;
        },
    });
    function reloadCached(event: PageTransitionEvent) {
        if (event.persisted) window.location.reload();
    }
    function destroy(preservePageShow = false) {
        if (!preservePageShow) window.removeEventListener('pageshow', reloadCached);
        if (disposed) return;
        disposed = true;
        resourceRequest?.abort();
        interactions.destroy();
        notifications.destroy();
        gamepadHint.destroy();
        hud.destroy();
        titleNavigation.destroy();
        saveScore();
        fullscreenControl.destroy();
        splitControl.destroy();
        graphicsControl.destroy();
        session.running = false;
        music.invalidate();
        loop.destroy();
        input.destroy();
        gestures.destroy();
        audio.destroy();
        renderer?.destroy();
    }
    gestures.on(window, 'pagehide', () => destroy(true));
    // This listener must survive pagehide cleanup to restore a bfcache entry.
    window.addEventListener('pageshow', reloadCached);

    async function initialize() {
        try {
            if (!canvas.getContext || !window.requestAnimationFrame)
                throw new Error('The game requires Canvas and requestAnimationFrame support.');
            loop.start();
            const initialModes =
                graphicsSelect.value === 'split'
                    ? Object.values(graphicsControl.desiredPair)
                    : [graphicsSelect.value];
            const {
                world: maps,
                graphics,
                optional,
            } = await loadGameResources(
                window.fetch.bind(window),
                resourceRequest ? { signal: resourceRequest.signal } : undefined,
                initialModes,
            );
            if (disposed) return;
            world = maps;
            renderer = createRenderer(canvas, graphics);
            graphicsControl.attach(renderer);
            ensureGraphics = createOptionalGraphicsInstaller({
                renderer,
                loaders: optional,
                isDisposed: () => disposed,
                onUnavailable(key) {
                    graphicsControl.setUnavailable(key);
                    platformPicker.setUnavailable(key);
                },
            });
            await graphicsControl.loadCurrent();
            if (disposed) return;
            renderer.setSplitPosition(splitControl.position);
            if (!Array.isArray(world.screens) || world.screens.length !== SCREEN_COUNT)
                throw new Error('Incomplete Exolon map set.');
            session.state = createState(world, {
                screenIndex: cheats.options.levelSelection
                    ? (cheats.selectedScreen ?? launch.screenIndex)
                    : launch.screenIndex,
                cheats: cheats.options,
            });
            updateHud();
            cheats.control.setEnabled(true);
            newGame.disabled = false;
            newGame.textContent = 'Start game';
            byId('show-scores').disabled = false;
            byId('show-controls').disabled = false;
            pauseButton.disabled = false;
            restart.disabled = false;
            byId('menu').disabled = false;
            session.showTitle();
            platformPicker.setAvailable(renderer.graphicsModes);
            if (skipPlatformPicker) {
                preferences.set('graphics', graphicsSelect.value);
                renderer.renderTitle(0);
                void music.play();
                canvas.focus({ preventScroll: true });
            }
        } catch (error) {
            if (disposed) return;
            resourceRequest?.abort();
            session.mode = 'error';
            platformPicker.open();
            platformPicker.setAvailable([], false);
            music.invalidate();
            audio.destroy();
            title.hidden = true;
            overlay.hidden = false;
            byId('overlay-title').textContent = 'Could not start the game.';
            byId('overlay-copy').textContent =
                `${error instanceof Error ? error.message : String(error)} Open the game using npm run dev.`;
            status.textContent = 'STARTUP ERROR';
        }
    }
    return { start: initialize, destroy };
}
