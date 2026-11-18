import { Raycaster, Vector2 } from 'three';
import { createVrView } from '../../games/vr/view/index.ts';
import { createEventScope } from '../../lib/events.ts';
import type { ScopedPointerEvent } from '../../lib/events.ts';
import { createClock } from '../../lib/clock.ts';
import { createInput } from '../../input/index.ts';
import { createAudio } from '../../view/audio.ts';
import { createMusicController } from '../music.ts';
import { createSoundControl } from '../sound.ts';
import { createFullscreenControl } from '../fullscreen.ts';
import { createGameMenusControl } from '../game-menus.ts';
import { createFpsControl } from '../fps.ts';
import { createActivityPause } from '../activity-pause.ts';
import { createGamepadHint } from '../gamepad-hint.ts';
import { createCheatSettingsControl } from '../cheat-settings.ts';
import { normalizeCheats } from '../../model/state.ts';
import { preferences } from '../../services/preferences.ts';
import { versionAssetUrl } from '../../services/asset-url.ts';
import { readLaunchOptions } from '../../utils/settings.ts';
import type { Cheats, World } from '../../types/game.ts';
import { createVrSession } from './session.ts';
import { createVrPreferences } from './preferences.ts';
import { createVrXr } from './xr.ts';
import { createVrRunScores } from './scores.ts';
import { readVrPreviewAction } from './preview-actions.ts';
import { isMobileBrowser } from '../../utils/mobile.ts';

export function createVrApplication({
    document,
    window,
    audioContext,
    onPlatforms,
}: {
    document: Document;
    window: Window & typeof globalThis;
    audioContext?: AudioContext;
    onPlatforms(): void;
}) {
    function element<T extends HTMLElement>(id: string): T {
        const value = document.getElementById(id);
        if (!value) throw new Error(`Missing VR control: ${id}`);
        return value as T;
    }
    const canvas = element<HTMLCanvasElement>('game');
    const gamepadHint = createGamepadHint({
        element: element('gamepad-hint'),
        button: element<HTMLButtonElement>('gamepad-hint-dismiss'),
        canvas,
        view: window,
    });
    const shell = canvas.closest<HTMLElement>('.vr-game')!;
    const status = element('vr-status');
    const enter = element<HTMLButtonElement>('vr-enter');
    const scale = element<HTMLInputElement>('vr-scale');
    const nameForm = element<HTMLFormElement>('vr-name-entry');
    const nameInput = element<HTMLInputElement>('vr-player-name');
    const events = createEventScope(window);
    const fps = createFpsControl(document, events);
    shell.classList.toggle(
        'game-app_touch',
        isMobileBrowser(window.navigator.userAgent, window.navigator.maxTouchPoints),
    );
    const storage = createVrPreferences();
    const runScores = createVrRunScores(storage.scores);
    const scores = runScores.records;
    const input = createInput(window, element('touch'));
    const audio = createAudio({ graphicsMode: 'remastered', context: audioContext });
    const abort = new window.AbortController();
    let disposed = false;
    let contextLost = false;
    let view: ReturnType<typeof createVrView> | undefined;
    let session: ReturnType<typeof createVrSession> | undefined;
    let xr: ReturnType<typeof createVrXr> | undefined;
    let bonusFire = false;
    let panelKey = '';
    let previousMode = '';
    let inputPadReady = false;
    const pointer = new Vector2();
    const raycaster = new Raycaster();
    let pointerStart = { x: 0, y: 0 };
    const sound = createSoundControl({
        button: element('sound'),
        volume: element('volume'),
        audio,
        events,
        onUnmute: unlockSound,
        onInteraction: focusCanvas,
    });
    const music = createMusicController({
        audio,
        status: element('mission-status'),
        graphicsMode: 'remastered',
        isEligible: () =>
            !disposed &&
            !document.hidden &&
            !contextLost &&
            Boolean(session && ['title', 'scores'].includes(session.mode)),
        isMuted: () => sound.muted,
    });
    const clock = createClock(tick, 1000 / 30);
    const fullscreen = createFullscreenControl(shell, element('fullscreen'), {
        onEscape: showTitle,
    });
    const menus = createGameMenusControl({
        document,
        storage: preferences,
        events,
        onToggle: clearInput,
        isRunning: () => Boolean(session?.running),
        pause,
        resume: startGame,
        canResume: () =>
            !disposed &&
            !contextLost &&
            session?.mode === 'paused' &&
            !ownsNativeInput() &&
            (!xr?.active || xr.active.visibilityState === 'visible'),
    });
    const cheatSettings = createCheatSettingsControl({
        document,
        events,
        options: normalizeCheats(storage.cheats),
        onChange: changeCheats,
    });
    const activity = createActivityPause({
        document,
        events,
        isEnabled: () => !xr?.active,
        isRunning: () => Boolean(session?.running),
        pause,
        resume: startGame,
        canResume: () =>
            !disposed &&
            !contextLost &&
            session?.mode === 'paused' &&
            !menus.active &&
            !ownsNativeInput(),
    });

    function focusCanvas() {
        if (!disposed) canvas.focus({ preventScroll: true });
    }
    function ownsNativeInput() {
        return !nameForm.hidden;
    }
    function clearInput() {
        input.reset();
        xr?.reset();
        view?.hover([]);
        bonusFire = false;
    }
    function unlockSound() {
        void audio.unlock();
        if (session && ['title', 'scores'].includes(session.mode)) void music.play();
    }
    function pause() {
        if (disposed || !session) return;
        activity.revokeResume();
        menus.revokeResume();
        session.pause();
        clock.pause();
        clearInput();
        music.invalidate();
        audio.stop();
        refresh();
    }
    function startGame(reset = false) {
        if (disposed || !session || !view || contextLost || ownsNativeInput()) return;
        if (!xr?.active && document.hidden) return;
        if (xr?.active && xr.active.visibilityState !== 'visible') return;
        activity.revokeResume();
        music.invalidate();
        audio.stop();
        clearInput();
        const resuming = session.mode === 'paused' && !reset;
        session.start(reset);
        gamepadHint.onStart(Boolean(xr?.active?.inputSources.length));
        if (!resuming) {
            clock.reset();
            runScores.reset();
        }
        clock.resume();
        panelKey = '';
        void audio.unlock();
        focusCanvas();
        refresh();
    }
    function showTitle() {
        if (disposed || !session) return;
        activity.revokeResume();
        scores.save(session.state);
        session.title();
        clock.pause();
        clearInput();
        nameForm.hidden = true;
        panelKey = '';
        audio.stop();
        refresh();
        void music.play();
    }
    function showScores() {
        if (!session) return;
        pause();
        session.scores();
        panelKey = '';
        refresh();
        void music.play();
    }
    function setPanel(
        title: string,
        lines: readonly string[],
        actions: readonly { id: string; label: string }[],
    ) {
        const key = JSON.stringify([title, lines, actions]);
        if (key === panelKey || !view) return;
        panelKey = key;
        view.panel(title, lines, actions);
    }
    function refresh() {
        if (disposed || !view || !session) return;
        const state = session.state;
        Object.assign(canvas.dataset, {
            xr: xr?.active ? 'immersive' : 'preview',
            mode: session.mode,
            tick: String(state.tick),
            ammo: String(state.ammo),
            grenades: String(state.grenades),
            score: String(state.score),
            screen: String(state.screenIndex + 1),
        });
        const paused = session.mode === 'paused';
        element('vr-name-open').hidden = !(
            ['over', 'won'].includes(session.mode) && runScores.canSubmit(state)
        );
        const pauseButton = element<HTMLButtonElement>('pause');
        pauseButton.hidden = false;
        pauseButton.disabled = !['playing', 'paused'].includes(session.mode) || contextLost;
        pauseButton.textContent = paused ? 'Resume' : 'Pause';
        pauseButton.setAttribute('aria-pressed', String(paused));
        for (const id of ['new-game', 'restart', 'menu', 'vr-scores', 'vr-recenter']) {
            const button = element<HTMLButtonElement>(id);
            button.disabled = contextLost;
            button.hidden = false;
        }
        element('vr-screen-navigation').hidden = !state.cheats.levelSelection;
        element('vr-screen-number').textContent =
            `${String(state.screenIndex + 1).padStart(3, '0')} / 125`;
        cheatSettings.update(state.cheats);
        cheatSettings.setEnabled(!contextLost);
        const extras = xr?.active
            ? [
                  { id: 'recenter', label: 'Recenter' },
                  { id: 'exit-vr', label: 'Exit VR' },
              ]
            : [{ id: 'recenter', label: 'Recenter' }];
        if (!nameForm.hidden) {
            setPanel(
                'YOUR SCORE',
                [String(state.score), 'Enter your name using the keyboard below.'],
                [],
            );
        } else if (session.mode === 'title') {
            setPanel(
                'EXOLON VR',
                [
                    'REMASTERED · VOLUMETRIC DIORAMA',
                    'Five worlds · 125 screens',
                    'Right controller · Trigger: rocket · B: bullets · A: jump',
                ],
                [
                    { id: 'start', label: 'Start game' },
                    { id: 'scores', label: 'Scores' },
                    ...extras,
                    { id: 'platforms', label: 'Platforms' },
                ],
            );
        } else if (session.mode === 'scores') {
            setPanel(
                'HALL OF FAME',
                scores.rows
                    .slice(0, 7)
                    .map(
                        (row, index) =>
                            `${index + 1}. ${row.name.padEnd(8)}  ${String(row.score).padStart(6, '0')}`,
                    ),
                [{ id: 'title', label: 'Title' }, ...extras],
            );
        } else if (session.mode === 'paused') {
            setPanel(
                'PAUSED',
                [
                    `ZONE ${state.screenIndex + 1} / 125`,
                    'Your position and progress are preserved.',
                ],
                [
                    { id: 'resume', label: 'Resume' },
                    { id: 'restart', label: 'Restart' },
                    { id: 'title', label: 'Title' },
                    ...extras,
                    { id: 'platforms', label: 'Platforms' },
                ],
            );
        } else if (session.mode === 'over' || session.mode === 'won') {
            setPanel(
                session.mode === 'won' ? 'MISSION COMPLETE' : 'GAME OVER',
                [
                    `SCORE ${String(state.score).padStart(6, '0')}`,
                    `PERSONAL BEST ${scores.bestScore}`,
                ],
                [
                    { id: 'start', label: 'New game' },
                    ...(runScores.canSubmit(state)
                        ? [{ id: 'name', label: 'Save your name' }]
                        : []),
                    { id: 'scores', label: 'Scores' },
                    ...extras,
                    { id: 'platforms', label: 'Platforms' },
                ],
            );
        } else if (state.status === 'bonus') {
            const bonus = state.bonus!;
            setPanel(
                'STAGE BONUS',
                [
                    `LIVES ${bonus.lives} · BRAVERY ${bonus.bravery}`,
                    `BONUS ${bonus.total} · ROULETTE ${[0, 1000, 0, 3000, 0, 5000, 0, 7000][bonus.cursor]}`,
                    'Press fire to stop the roulette and continue.',
                ],
                [{ id: 'bonus', label: 'Stop roulette' }, ...extras],
            );
        } else setPanel('', [], []);
    }
    function tick() {
        if (!session?.running || !view || disposed || contextLost) return;
        const commands = xr?.active ? xr.consumeCommands() : input.sample();
        if (bonusFire && session.state.status === 'bonus' && session.state.bonus?.armed) {
            commands.fire = true;
            bonusFire = false;
        }
        const gameEvents = session.tick(commands);
        input.handleEvents(gameEvents);
        audio.handle(gameEvents);
        if (!session.running) {
            clock.pause();
            clearInput();
            scores.save(session.state);
        }
        refresh();
    }
    function resize() {
        if (!view || xr?.active || disposed) return;
        const width = canvas.clientWidth,
            height = canvas.clientHeight;
        if (width < 1 || height < 1) return;
        if (
            canvas.width !== Math.round(width * view.renderer.getPixelRatio()) ||
            canvas.height !== Math.round(height * view.renderer.getPixelRatio())
        )
            view.renderer.setSize(width, height, false);
        view.camera.aspect = width / height;
        view.camera.updateProjectionMatrix();
    }
    function frame(now: number, xrFrame?: XRFrame) {
        if (disposed || !view || !session || contextLost) return;
        xr?.sample(xrFrame);
        if (!xr?.active) {
            const owned = ownsNativeInput();
            const pad = input.pollGamepad(!document.hidden && document.hasFocus() && !owned);
            if (pad.lost && inputPadReady) pause();
            if (pad.status !== 'inactive') inputPadReady = pad.status === 'ready';
            if (!menus.gamepad(pad)) {
                const next = readVrPreviewAction(session.mode, pad.pressed, owned);
                if (next) action(next);
                else if (!owned && session.mode === 'paused' && pad.commands.fire) action('resume');
            }
        }
        if (disposed || !view || !session) return;
        if (session.running && !clock.frame(now)) pause();
        if (previousMode !== session.mode) {
            previousMode = session.mode;
            refresh();
        }
        resize();
        const visualTime = ((session.state.tick + clock.fraction) * 1000) / 30;
        view.update(session.state, clock.fraction, visualTime);
        view.renderer.render(view.scene, view.camera);
        fps.frame(now);
    }
    function handleXrChange() {
        if (disposed || !view) return;
        refresh();
        if (!view.renderer.xr.isPresenting && !contextLost && !document.hidden)
            view.renderer.setAnimationLoop(frame);
    }
    function togglePause() {
        if (ownsNativeInput()) return;
        if (session?.mode === 'paused') startGame();
        else pause();
    }
    function restart() {
        startGame(true);
    }
    function begin() {
        startGame();
    }
    function recenter() {
        view?.recenter();
    }
    function changeScale() {
        storage.setScale(Number(scale.value));
        view?.setScale(storage.scale);
        clearInput();
    }
    async function openName() {
        if (
            disposed ||
            !session ||
            !runScores.canSubmit(session.state) ||
            !['over', 'won'].includes(session.mode)
        )
            return;
        await xr?.exit();
        if (disposed) return;
        nameForm.hidden = false;
        nameInput.value = scores.playerName;
        nameInput.focus({ preventScroll: true });
        nameInput.select();
        refresh();
    }
    function closeName() {
        nameForm.hidden = true;
        clearInput();
        refresh();
        focusCanvas();
    }
    function saveName(event: Event) {
        event.preventDefault();
        if (session) runScores.submit(nameInput.value, session.state);
        closeName();
    }
    function changeCheats(options: Cheats) {
        if (disposed || !session || contextLost) return;
        session.configure(options);
        storage.setCheats(session.state.cheats);
        refresh();
    }
    function previousScreen() {
        changeScreen(-1);
    }
    function handleNameOpen() {
        void openName();
    }
    function returnPlatforms() {
        if (session) scores.save(session.state);
        onPlatforms();
    }
    function nextScreen() {
        changeScreen(1);
    }
    function changeScreen(direction: number) {
        if (!session) return;
        pause();
        session.selectScreen(session.state.screenIndex + direction);
        clock.reset();
        panelKey = '';
        refresh();
    }
    function action(id: string) {
        if (disposed || menus.active) return;
        // A remains jump while playing. In menus it starts/resumes without
        // requiring a precisely aimed controller ray.
        if (id === 'confirm' && session?.mode === 'playing') return;
        clearInput();
        if (id === 'start' || id === 'resume') startGame();
        else if (id === 'pause') pause();
        else if (id === 'toggle-pause') togglePause();
        else if (id === 'confirm') {
            if (session?.mode === 'scores') showTitle();
            else startGame();
        } else if (id === 'restart') restart();
        else if (id === 'scores') showScores();
        else if (id === 'title') showTitle();
        else if (id === 'recenter') recenter();
        else if (id === 'exit-vr') void xr?.exit();
        else if (id === 'platforms') returnPlatforms();
        else if (id === 'name') void openName();
        else if (id === 'bonus') bonusFire = true;
    }
    function handleKey(event: KeyboardEvent) {
        if (menus.active) return;
        if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
        if (
            !nameForm.hidden ||
            ['INPUT', 'SELECT', 'TEXTAREA'].includes(
                (event.target as Element | null)?.tagName ?? '',
            )
        )
            return;
        if (event.code === 'Escape') {
            event.preventDefault();
            showTitle();
        } else if (event.code === 'Pause') {
            if (!event.repeat) {
                event.preventDefault();
                togglePause();
            }
        } else if (
            ['Enter', 'Space', 'KeyM'].includes(event.code) &&
            event.target === canvas &&
            !session?.running
        ) {
            event.preventDefault();
            if (!event.repeat) startGame();
        }
    }
    function handlePointerDown(event: { clientX: number; clientY: number }) {
        pointerStart = { x: event.clientX, y: event.clientY };
    }
    function pickPointer(event: { clientX: number; clientY: number }) {
        if (!view || xr?.active || menus.active || ownsNativeInput()) return undefined;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return undefined;
        pointer.set(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1,
        );
        raycaster.setFromCamera(pointer, view.camera);
        return view.pick(raycaster.ray.origin, raycaster.ray.direction);
    }
    function handlePointerMove(event: ScopedPointerEvent) {
        if (!view || xr?.active) return;
        const id = event.pointerType === 'touch' ? undefined : pickPointer(event);
        view.hover(id ? [id] : []);
    }
    function clearHover() {
        view?.hover([]);
    }
    function handlePointerUp(event: { clientX: number; clientY: number }) {
        if (
            !view ||
            xr?.active ||
            Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8
        )
            return;
        const id = pickPointer(event);
        if (id) action(id);
        else if (!menus.active && !ownsNativeInput() && session?.mode === 'paused') startGame();
        focusCanvas();
    }
    function handleTouchFire(event: ScopedPointerEvent | (MouseEvent & { pointerType?: string })) {
        if (
            xr?.active ||
            menus.active ||
            ownsNativeInput() ||
            session?.mode !== 'paused' ||
            (typeof event.button === 'number' && event.button !== 0) ||
            (event.type === 'click' &&
                (('detail' in event && event.detail !== 0) || event.pointerType)) ||
            (event.target as Element | null)?.closest<HTMLElement>('[data-action]')?.dataset
                .action !== 'fire'
        )
            return;
        startGame();
    }
    function handleHidden() {
        if (!document.hidden) return;
        clearHover();
        if (xr?.active) pause();
        else {
            music.invalidate();
            audio.stop();
        }
    }
    function handlePageHide() {
        pause();
        view?.renderer.setAnimationLoop(null);
    }
    function handlePageShow() {
        if (!disposed && !contextLost) view?.renderer.setAnimationLoop(frame);
    }
    function handleContextLost(event: Event) {
        event.preventDefault();
        contextLost = true;
        canvas.dataset.ready = 'false';
        pause();
        void xr?.exit();
        view?.renderer.setAnimationLoop(null);
        status.textContent =
            'Graphics context lost. Your game is paused; waiting for graphics recovery.';
    }
    function handleContextRestored() {
        if (disposed || !view || !session) return;
        // Three.js restores its GPU resources from the retained scene data.
        contextLost = false;
        canvas.dataset.ready = 'true';
        status.textContent = 'Graphics restored. Select Resume to continue.';
        view.renderer.setAnimationLoop(frame);
        refresh();
    }
    for (const [id, callback] of [
        ['new-game', begin],
        ['pause', togglePause],
        ['restart', restart],
        ['menu', showTitle],
        ['vr-scores', showScores],
        ['vr-recenter', recenter],
        ['vr-name-cancel', closeName],
        ['vr-previous-screen', previousScreen],
        ['vr-next-screen', nextScreen],
        ['vr-platforms', returnPlatforms],
        ['vr-name-open', handleNameOpen],
    ] as const)
        events.on(element(id), 'click', callback);
    events.on(scale, 'input', changeScale);
    events.on(nameForm, 'submit', saveName);
    events.on(window, 'keydown', handleKey);
    events.on(canvas, 'pointerdown', handlePointerDown);
    events.on(element('touch'), 'pointerdown', handleTouchFire);
    events.on(element('touch'), 'click', handleTouchFire);
    events.on(canvas, 'pointerup', handlePointerUp);
    events.on(canvas, 'pointermove', handlePointerMove);
    events.on(canvas, 'pointerleave', clearHover);
    events.on(canvas, 'pointercancel', clearHover);
    events.on(document, 'visibilitychange', handleHidden);
    events.on(window, 'pagehide', handlePageHide);
    events.on(window, 'pageshow', handlePageShow);
    events.on(window, 'resize', resize);
    events.on(canvas, 'webglcontextlost', handleContextLost);
    events.on(canvas, 'webglcontextrestored', handleContextRestored);
    return {
        async start() {
            try {
                view = createVrView(canvas);
                view.setScale(storage.scale);
                scale.value = String(storage.scale);
                const response = await window.fetch(versionAssetUrl('./data/world.json'), {
                    signal: abort.signal,
                });
                if (!response.ok) throw new Error('Maps unavailable');
                const world: World = await response.json();
                if (disposed) return;
                if (
                    world.screens?.length !== 125 ||
                    world.screens.some((screen) => !Array.isArray(screen.tiles))
                )
                    throw new Error('Invalid game maps');
                const launch = readLaunchOptions(window.location.search, 'remastered');
                const query = new URLSearchParams(window.location.search);
                const selectedLevel = query.has('level') || query.get('debug') === '1';
                session = createVrSession(world, {
                    screenIndex: launch.screenIndex,
                    selectedLevel,
                    cheats: storage.cheats,
                });
                xr = createVrXr({
                    window,
                    view,
                    button: enter,
                    status,
                    pause,
                    changed: handleXrChange,
                    action,
                });
                scale.disabled = false;
                canvas.dataset.ready = 'true';
                refresh();
                resize();
                view.renderer.setAnimationLoop(frame);
                void music.play();
            } catch {
                if (disposed) return;
                status.textContent = view
                    ? 'Could not load the VR game maps. Return to Platforms and try again.'
                    : 'Exolon VR requires WebGL 2. This browser cannot display the diorama. Choose another platform.';
                canvas.dataset.ready = 'false';
                cheatSettings.setEnabled(false);
                view?.destroy();
                view = undefined;
                audio.destroy();
            }
        },
        destroy() {
            if (disposed) return;
            disposed = true;
            abort.abort();
            music.invalidate();
            clock.destroy();
            const currentView = view;
            currentView?.renderer.setAnimationLoop(null);
            const xrTeardown = xr?.destroy();
            if (xrTeardown) void xrTeardown.then(() => currentView?.destroy());
            else currentView?.destroy();
            input.destroy();
            audio.destroy();
            events.destroy();
            fullscreen.destroy();
            gamepadHint.destroy();
        },
    };
}
