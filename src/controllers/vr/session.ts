import {
    createState,
    restartState,
    selectCheatScreen,
    setCheats,
    step,
} from '../../model/state.ts';
import type { InputCommands, World } from '../../types/game.ts';

export type VrSessionMode = 'title' | 'scores' | 'playing' | 'paused' | 'over' | 'won';

export function createVrSession(
    world: World,
    {
        screenIndex = 0,
        selectedLevel = false,
        cheats = {},
    }: {
        screenIndex?: number;
        selectedLevel?: boolean;
        cheats?: unknown;
    } = {},
) {
    let state = createState(world, { screenIndex, cheats });
    let mode: VrSessionMode = 'title';
    const selectedStart = selectedLevel || screenIndex > 0;
    state.cheatUsed ||= selectedStart;
    return {
        get state() {
            return state;
        },
        get mode() {
            return mode;
        },
        get running() {
            return mode === 'playing';
        },
        start(reset = false) {
            if (reset || mode !== 'paused') {
                state = restartState(state, {
                    initialScreen: screenIndex,
                    selectedScreen: state.screenIndex,
                });
                state.cheatUsed ||= selectedStart;
            }
            mode = 'playing';
        },
        pause() {
            if (mode === 'playing') mode = 'paused';
        },
        title() {
            mode = 'title';
        },
        scores() {
            mode = 'scores';
        },
        configure(value: unknown) {
            state = setCheats(state, value);
        },
        selectScreen(index: number) {
            const next = selectCheatScreen(state, index);
            if (next === state) return;
            state = next;
            state.cheatUsed = true;
            mode = 'paused';
        },
        tick(commands: InputCommands) {
            if (mode !== 'playing') return [];
            const result = step(state, commands);
            state = result.state;
            if (state.status === 'over' || state.status === 'won') mode = state.status;
            return result.events;
        },
    };
}
