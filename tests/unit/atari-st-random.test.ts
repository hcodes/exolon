import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAtariStRandomByte } from '../../src/games/atari-st/utils/random.ts';
import { createAtariStState, stepAtariSt } from '../../src/games/atari-st/model/index.ts';
import type { NativeWorld } from '../../src/games/16bit/types/index.ts';

// Independently executed TOS 1.02 $fc1510/$fc4b82 instructions, not JS-derived vectors.
const originalVectors = [
    {
        seed: 1,
        bytes: [
            230, 202, 48, 58, 69, 129, 216, 45, 202, 136, 6, 247, 99, 91, 132, 114, 186, 54, 223,
            60,
        ],
    },
    {
        seed: 0x19871201,
        bytes: [
            16, 44, 106, 108, 15, 3, 178, 127, 52, 42, 128, 105, 109, 29, 158, 4, 100, 24, 153, 238,
        ],
    },
    {
        seed: 0x80000000,
        bytes: [
            0, 230, 202, 48, 58, 69, 129, 216, 45, 202, 136, 6, 247, 99, 91, 132, 114, 186, 54, 223,
        ],
    },
    {
        seed: 0xffffffff,
        bytes: [
            25, 2, 100, 37, 47, 8, 42, 131, 145, 12, 11, 21, 139, 106, 50, 150, 43, 62, 141, 131,
        ],
    },
];

test('Atari random bytes match original TOS instructions across unsigned overflow', () => {
    for (const { seed, bytes } of originalVectors) {
        const state = { randomSeed: seed };
        const actual = bytes.map(() => nextAtariStRandomByte(state));
        assert.deepEqual(actual, bytes, `initial seed ${seed.toString(16)}`);
    }
});

test('Atari pistons use TOS bytes and finish the native cycle before drawing another byte', () => {
    const world: NativeWorld = {
        screens: Array.from({ length: 125 }, () => ({
            tiles: Array.from({ length: 920 }, (_, index) => (index >= 880 ? 0x79 : 0)),
        })),
    };
    let state = createAtariStState(world, { seed: 0xffffffff, invulnerable: true });
    // Beyond the flyer spawn boundary, only this isolated piston consumes RNG.
    state.player.x = 221;
    state.entities = [
        {
            id: 900,
            kind: 'spike',
            x: 96,
            y: 175,
            width: 32,
            height: 0,
            frame: 0,
            phase: 0,
            type: 0,
            dx: 0,
            dy: 0,
            alive: true,
        },
    ];
    const heights: number[] = [];
    const phases: number[] = [];
    const seeds: number[] = [];
    for (let tick = 0; tick < 16; tick++) {
        state = stepAtariSt(state, {}).state;
        heights.push(state.entities[0].height);
        phases.push(state.entities[0].phase);
        seeds.push(state.randomSeed);
    }
    // TOS bytes25/2 leave the first tick idle, then start the original 13-tick cycle.
    assert.deepEqual(heights, [0, 0, 8, 16, 24, 32, 40, 48, 40, 32, 24, 16, 8, 0, 0, 0]);
    assert.deepEqual(phases, [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 0, 0, 0]);
    assert.ok(seeds.slice(1, 14).every((seed) => seed === seeds[1]));
    assert.notEqual(seeds[14], seeds[13]);
});
