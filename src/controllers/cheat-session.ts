import { createCheatSettingsControl } from './cheat-settings.ts';
import { normalizeCheats, selectCheatScreen, setCheats } from '../model/state.ts';
import { SCREEN_COUNT } from '../constants/game.ts';
import { gameElement } from '../utils/dom.ts';
import { readObject } from '../utils/settings.ts';
import type { GameState, World } from '../types/game.ts';
import type { ApplicationMode, PreferenceStore } from '../types/ui.ts';
import type { EventScope } from '../lib/events.ts';
import type { createInput } from '../input/index.ts';
import type { createClock } from '../lib/clock.ts';
import type { createAudio } from '../view/audio.ts';
import type { createRenderer } from '../view/renderer.ts';
import type { createScoreAttract } from '../model/high-scores.ts';

interface CheatSessionOptions {
    document: Document;
    gestures: EventScope;
    preferences: PreferenceStore;
    input: ReturnType<typeof createInput>;
    clock: ReturnType<typeof createClock>;
    audio: ReturnType<typeof createAudio>;
    attract: ReturnType<typeof createScoreAttract>;
    getState(): GameState;
    setState(state: GameState): void;
    getWorld(): World;
    getRenderer(): ReturnType<typeof createRenderer>;
    getMode(): ApplicationMode;
    pause(): void;
    play(): void;
    updateHud(): void;
    updateGameOverControls(): void;
    clearBonus(): void;
}

export function createCheatSession(options: CheatSessionOptions) {
    const {
        document,
        gestures,
        preferences,
        input,
        clock,
        audio,
        attract,
        getState,
        setState,
        getWorld,
        getRenderer,
        getMode,
        pause,
        play,
        updateHud,
        updateGameOverControls,
        clearBonus,
    } = options;
    const byId = <K extends string>(id: K) => gameElement(document, id);
    let cheatOptions = normalizeCheats(readObject(preferences.get('cheats')));
    let selectedScreen: number | undefined;
    const cheatControl = createCheatSettingsControl({
        document,
        events: gestures,
        options: cheatOptions,
        onChange: changeCheatOptions,
    });
    function updateCheatControls() {
        cheatControl.update(cheatOptions);
        byId('cheat-navigation').hidden = !cheatOptions.levelSelection;
        byId('cheat-screen').textContent =
            `SCREEN ${String((getState()?.screenIndex || 0) + 1).padStart(3, '0')} / ${SCREEN_COUNT}`;
        byId('previous-screen').disabled = !getState() || getState().screenIndex <= 0;
        byId('next-screen').disabled =
            !getState() || getState().screenIndex >= getWorld().screens.length - 1;
    }

    function changeCheatOptions(options: typeof cheatOptions) {
        cheatOptions = normalizeCheats(options);
        preferences.set('cheats', JSON.stringify(cheatOptions));
        if (cheatOptions.levelSelection && getState()) selectedScreen = getState().screenIndex;
        if (getState()) setState(setCheats(getState(), cheatOptions));
        input.reset();
        attract.activity();
        updateHud();
        if (getMode() === 'over') updateGameOverControls();
    }
    function changeCheatScreen(direction: number) {
        if (!getState()?.cheats.levelSelection) return;
        const next = selectCheatScreen(getState(), getState().screenIndex + direction);
        if (next === getState()) return;
        setState(next);
        selectedScreen = getState().screenIndex;
        clearBonus();
        input.reset();
        clock.reset();
        if (getMode() !== 'title') audio.stop();
        getRenderer().destroy();
        getRenderer().addEvents([], getState());
        updateHud();
        if (getMode() === 'paused') pause();
        else if (getMode() !== 'title') play();
    }
    gestures.on(byId('previous-screen'), 'click', () => changeCheatScreen(-1));
    gestures.on(byId('next-screen'), 'click', () => changeCheatScreen(1));

    return {
        get options() {
            return cheatOptions;
        },
        get selectedScreen() {
            return selectedScreen;
        },
        set selectedScreen(value: number | undefined) {
            selectedScreen = value;
        },
        control: cheatControl,
        update: updateCheatControls,
        toggleInfiniteLives() {
            cheatOptions = { ...cheatOptions, infiniteLives: !cheatOptions.infiniteLives };
            preferences.set('cheats', JSON.stringify(cheatOptions));
            if (getState()) setState(setCheats(getState(), cheatOptions));
            updateCheatControls();
            updateHud();
            return cheatOptions.infiniteLives;
        },
    };
}
