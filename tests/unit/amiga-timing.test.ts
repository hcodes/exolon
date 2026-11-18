import assert from 'node:assert/strict';
import test from 'node:test';
import { createClock } from '../../src/lib/clock.ts';
import { AMIGA_TICK_HZ } from '../../src/games/amiga/constants/index.ts';
import { createAmigaState, stepAmiga } from '../../src/games/amiga/model/index.ts';

test('Amiga advances fifty gameplay steps in three seconds at every display refresh rate', () => {
    for (const refreshHz of [50, 60, 120, 144, 240]) {
        let state = createAmigaState({
            screens: [{ tiles: Array.from({ length: 920 }, (_, i) => (i >= 880 ? 0x79 : 0)) }],
        });
        const clock = createClock(() => {
            state = stepAmiga(state, { right: true }).state;
        }, 1000 / AMIGA_TICK_HZ);
        clock.resume();
        clock.frame(0);
        for (let frame = 1; frame <= refreshHz * 3; frame++)
            clock.frame((frame * 1000) / refreshHz);
        assert.equal(state.tick, 50, `${refreshHz} Hz display`);
        assert.equal(state.player.x, 153, `${refreshHz} Hz preserves native three-pixel steps`);
    }
});
