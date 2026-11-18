import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../../src/lib/clock.ts';
import { SIMULATION_INTERVAL, getSimulationInterval } from '../../src/constants/game.ts';
import { createState, step } from '../../src/model/state.ts';
import type { GameScreen } from '../../src/types/game.ts';
const flatScreen = (): GameScreen => ({
    id: 0,
    actions: [],
    tiles: Array.from({ length: 768 }, (_, at) => (at >= 576 ? { collision: 1, block: 33 } : null)),
});

test('classic walking keeps original two-pixel steps and roughly42pixels per second at every display refresh', () => {
    for (const refreshHz of [50, 60, 120, 144, 240]) {
        let state = createState(flatScreen());
        const startX = state.player.x;
        const clock = createClock(() => {
            state = step(state, { right: true }).state;
        }, SIMULATION_INTERVAL);
        clock.resume();
        clock.frame(0);
        for (let frame = 1; frame <= refreshHz; frame++) clock.frame((frame * 1000) / refreshHz);
        assert.equal(
            (state.player.x - startX) * 2,
            42,
            `${refreshHz}Hz display must not accelerate the astronaut`,
        );
        assert.equal(state.player.sprite, 0, 'ten native walking poses advance with movement');
    }
});

test('each original platform follows its measured walking baseline without changing the shared step distance', () => {
    for (const [mode, pixels] of [
        ['retro', 42],
        ['c64', 42],
        ['cpc', 38],
        ['sharp-mz800', 44],
        ['remastered', 60],
        ['gameboy', 60],
        ['gameboy-color', 60],
    ] as const) {
        for (const refreshHz of [50, 60, 120, 144]) {
            let state = createState(flatScreen());
            const clock = createClock(() => {
                state = step(state, { right: true }).state;
            }, getSimulationInterval(mode));
            clock.resume();
            clock.frame(0);
            for (let frame = 1; frame <= refreshHz; frame++)
                clock.frame((frame * 1000) / refreshHz);
            assert.equal((state.player.x - 16) * 2, pixels, `${mode} at ${refreshHz}Hz`);
        }
    }
});
