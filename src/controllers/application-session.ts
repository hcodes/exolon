import type { GameState, World } from '../types/game.ts';
import type { ApplicationMode } from '../types/ui.ts';
import type { createInput } from '../input/index.ts';
import type { createClock } from '../lib/clock.ts';
import type { createAudio } from '../view/audio.ts';
import type { createRenderer } from '../view/renderer.ts';
import type { createMusicController } from './music.ts';
import type { createScoreController } from './scores.ts';
import type { createCheatSession } from './cheat-session.ts';
import type { createScoreAttract } from '../model/high-scores.ts';
import type { createHud } from './hud.tsx';
import type { createControlMenuController } from './control-menu.ts';
import { createState, restartState } from '../model/state.ts';
import { SCREEN_COUNT } from '../constants/game.ts';
import { gameElement } from '../utils/dom.ts';

interface ApplicationSessionOptions {
    document: Document;
    initialScreen: number;
    input: ReturnType<typeof createInput>;
    clock: ReturnType<typeof createClock>;
    audio: ReturnType<typeof createAudio>;
    music: ReturnType<typeof createMusicController>;
    scores: ReturnType<typeof createScoreController>;
    cheats: ReturnType<typeof createCheatSession>;
    attract: ReturnType<typeof createScoreAttract>;
    hud: ReturnType<typeof createHud>;
    controlMenu: ReturnType<typeof createControlMenuController>;
    getWorld(): World;
    getRenderer(): ReturnType<typeof createRenderer>;
    isPickingPlatform(): boolean;
    updateHud(): void;
    showMenuPage(page: 'title'): void;
    onTitle(): void;
    onPause(): void;
    onStart(): void;
    clearBonus(): void;
}

export function createApplicationSession(options: ApplicationSessionOptions) {
    const {
        document,
        input,
        clock,
        audio,
        music,
        scores,
        cheats,
        attract,
        hud,
        controlMenu,
        getWorld,
        getRenderer,
        isPickingPlatform,
        updateHud,
        showMenuPage,
        onTitle,
        onPause,
        onStart,
        clearBonus,
    } = options;
    const byId = <K extends string>(id: K) => gameElement(document, id);
    const canvas = byId('game'),
        pauseButton = byId('pause'),
        restart = byId('restart'),
        status = byId('mission-status'),
        overlay = byId('overlay'),
        title = byId('title-screen'),
        nameForm = byId('name-entry'),
        nameInput = byId('player-name');
    let state: GameState;
    let running = false;
    let mode: ApplicationMode = 'title';
    let hasPlayed = false;
    let titleActivated = false;
    let initialScreen = options.initialScreen;
    const saveScore = () => scores.save(state);
    function updateGameOverControls() {
        const retry = cheats.options.retryLevel;
        byId('overlay-copy').textContent = retry
            ? `No lives left. Retry from screen ${state.screenIndex + 1}.`
            : '';
        pauseButton.textContent = retry ? 'Retry screen' : 'New game';
    }

    function pause(heading = '', copy = '', nextMode: ApplicationMode = 'paused') {
        onPause();
        saveScore();
        running = false;
        clock.pause();
        input.reset();
        audio.stop();
        byId('bonus-screen').hidden = true;
        mode = nextMode;
        music.invalidate();
        state = { ...state, fireTicks: 0 };
        overlay.hidden = false;
        byId('overlay-title').textContent = heading;
        byId('overlay-copy').textContent = copy;
        nameForm.hidden = !(nextMode === 'won' || (nextMode === 'over' && state.score > 1000));
        if (!nameForm.hidden) {
            nameInput.value = '';
            nameInput.setCustomValidity('');
            byId('name-hint').textContent =
                'Up to 8 letters or digits. Remastered supports international letters. Enter — save.';
            nameInput.focus({ preventScroll: true });
            nameInput.select();
        }
        pauseButton.textContent = ['won', 'over'].includes(nextMode) ? 'New game' : 'Resume';
        pauseButton.setAttribute('aria-pressed', String(nextMode === 'paused'));
        if (nextMode === 'over') updateGameOverControls();
        if (nextMode === 'over') audio.handle([{ type: 'game-over' }]);
        status.textContent =
            state.status === 'playing' ? 'PAUSED / AWAITING COMMAND' : 'SESSION ENDED';
    }

    function play(reset = false) {
        if (isPickingPlatform() || !getWorld() || !state) return;
        controlMenu.cancel();
        titleActivated = true;
        const epoch = music.invalidate();
        running = false;
        clock.pause();
        audio.stopMusic();
        audio.stop();
        if (reset || !['playing', 'bonus'].includes(state.status)) {
            saveScore();
            clock.reset();
            state = restartState(state, { initialScreen, selectedScreen: cheats.selectedScreen });
            getRenderer().destroy();
            getRenderer().addEvents([], state);
            updateHud();
        }
        input.reset();
        overlay.hidden = true;
        nameForm.hidden = true;
        title.hidden = true;
        byId('hud').hidden = false;
        mode = 'playing';
        hasPlayed = true;
        running = true;
        clock.resume();
        delete canvas.dataset.menu;
        for (const button of [pauseButton, restart, byId('menu')]) {
            button.disabled = false;
            button.hidden = false;
        }
        updateHud();
        pauseButton.textContent = 'Pause';
        pauseButton.setAttribute('aria-pressed', 'false');
        canvas.focus({ preventScroll: true });
        onStart();
        status.textContent = `STAGE ${state.stage} / SCREEN ${state.screenIndex + 1} OF ${SCREEN_COUNT}${state.cheatMode ? ' / CHEAT MODE' : ''}`;
        // A browser audio permission must not hold the game clock hostage.
        function handleAudioUnlock(hasAudio: boolean) {
            if (!hasAudio && music.isCurrent(epoch) && mode === 'playing')
                status.textContent = 'MISSION / AUDIO UNAVAILABLE';
        }
        void audio.unlock().then(handleAudioUnlock);
    }

    function showTitle() {
        if (cheats.options.levelSelection && !cheats.options.retryLevel && state)
            cheats.selectedScreen = state.screenIndex;
        onTitle();
        saveScore();
        attract.reset();
        showMenuPage('title');
        running = false;
        clock.pause();
        input.reset();
        audio.stop();
        music.invalidate();
        nameForm.hidden = true;
        pauseButton.setAttribute('aria-pressed', 'false');
        mode = 'title';
        title.hidden = false;
        overlay.hidden = true;
        byId('hud').hidden = true;
        for (const button of [pauseButton, restart, byId('menu')]) {
            button.disabled = true;
            button.hidden = true;
        }
        byId('bonus-screen').hidden = true;
        clearBonus();
        if (cheats.options.retryLevel && state && hasPlayed) {
            initialScreen = 0;
            cheats.selectedScreen = 0;
            state = createState(getWorld(), { cheats: cheats.options });
            clock.reset();
            getRenderer().destroy();
            getRenderer().addEvents([], state);
            updateHud();
        }
        status.textContent = '';
        if (state) hud.render(state, mode);
        void music.play({ autoplay: true });
    }

    return {
        get state() {
            return state;
        },
        set state(next: GameState) {
            state = next;
        },
        get running() {
            return running;
        },
        set running(next: boolean) {
            running = next;
        },
        get mode() {
            return mode;
        },
        set mode(next: ApplicationMode) {
            mode = next;
        },
        get titleActivated() {
            return titleActivated;
        },
        set titleActivated(next: boolean) {
            titleActivated = next;
        },
        pause,
        play,
        showTitle,
        updateGameOverControls,
    };
}
