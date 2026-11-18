import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAtariStState, stepAtariSt } from '../../src/games/atari-st/model/index.ts';
import { ATARI_ST_NATIVE, ATARI_ST_TICK_HZ } from '../../src/games/atari-st/constants/index.ts';
import { validateAtariStResources } from '../../src/games/atari-st/controllers/resources.ts';
import type { NativeWorld } from '../../src/games/16bit/types/index.ts';
import * as keys from '../../src/lib/LocalStorage/keys.ts';
const fixture = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const world = (): NativeWorld => ({
    screens: Array.from({ length: 125 }, () => ({
        tiles: Array.from({ length: 920 }, (_, i) => (i >= 880 ? 0x79 : 0)),
    })),
});

test('Atari original hunter appears at update300 and moves at301, independently of browser refresh', () => {
    let state = createAtariStState(world());
    state.entities = [];
    for (let tick = 1; tick <= 301; tick++) {
        state = stepAtariSt(state, {}).state;
        const hunter = state.entities.find((e) => e.kind === 'hunter');
        if (tick === 299) assert.equal(hunter, undefined);
        if (tick === 300)
            assert.deepEqual([hunter?.x, hunter ? hunter.y + 40 : undefined], [320, 176]);
        if (tick === 301)
            assert.deepEqual([hunter?.x, hunter ? hunter.y + 40 : undefined], [315, 176]);
    }
    assert.equal(300 / ATARI_ST_TICK_HZ, 18);
});

test('Atari native pistons kill unarmored players only while raised', () => {
    for (const armored of [false, true])
        for (const height of [0, 8, 16, 24, 32, 40, 48]) {
            const state = createAtariStState(world());
            state.player.x = 100;
            state.player.armored = armored;
            state.entities = [
                {
                    id: 900,
                    kind: 'spike',
                    x: 96,
                    y: 175 - height,
                    width: 32,
                    height,
                    frame: height,
                    phase: 2,
                    type: 0,
                    dx: 0,
                    dy: 0,
                    alive: true,
                },
            ];
            const next = stepAtariSt(state, {}).state;
            assert.equal(
                next.player.deathTick < 15,
                !armored && height > 0,
                `${armored}/${height}`,
            );
        }
});

test('Atari independently decoded campaign supports every entry and cycles the final stage', () => {
    const original = fixture('../../src/games/atari-st/data/world.json') as NativeWorld;
    assert.equal(original.screens.length, 125);
    for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
        const state = createAtariStState(original, { screenIndex, invulnerable: true });
        const next = stepAtariSt(state, {}).state;
        assert.equal(next.screenIndex, screenIndex);
        assert.ok(next.player.y >= 40 && next.player.y <= 200);
    }
    assert.deepEqual(ATARI_ST_NATIVE.stageEnds, [24, 49, 74, 99, 124]);
    let final = createAtariStState(world(), { screenIndex: 124 });
    final.player.x = 190;
    final = stepAtariSt(final, { fire: true }).state;
    assert.equal(final.status, 'bonus');
    assert.equal(final.bonusPhase, 'summary');
    final = stepAtariSt(final, {}).state;
    final = stepAtariSt(final, { fire: true }).state;
    assert.equal(final.bonusPhase, 'ending');
    final = stepAtariSt(final, {}).state;
    final = stepAtariSt(final, { fire: true }).state;
    assert.equal(final.bonusPhase, 'roulette');
    final = stepAtariSt(final, {}).state;
    final = stepAtariSt(final, { fire: true }).state;

    assert.equal(final.screenIndex, 0);
    assert.equal(final.status, 'playing');
});

test('Atari has distinct storage and validates its original ASCII font and text inks', () => {
    for (const suffix of ['CHEATS', 'SCORES', 'NAME'] as const)
        assert.notEqual(
            keys[`LOCAL_STORAGE_KEY_ATARI_ST_${suffix}`],
            keys[`LOCAL_STORAGE_KEY_AMIGA_${suffix}`],
        );
    const original = fixture('../../src/games/atari-st/data/world.json');
    const graphics = fixture('../../src/assets/graphics/atari-st/resources.json') as Record<
        string,
        unknown
    >;
    assert.equal(validateAtariStResources(original, graphics).world.screens.length, 125);
    assert.throws(
        () => validateAtariStResources(original, { ...graphics, asciiFont: undefined }),
        /font/,
    );
    assert.throws(
        () => validateAtariStResources(original, { ...graphics, asciiFont: [[0]] }),
        /corrupt/,
    );
    assert.throws(
        () =>
            validateAtariStResources(original, {
                ...graphics,
                text: {
                    ...(graphics.text as object),
                    menu: [{ text: 'BAD', x: 0, y: 0, ink: 16 }],
                },
            }),
        /corrupt/,
    );
    assert.throws(() => validateAtariStResources({ screens: [] }, graphics), /Atari ST/);
});

test('Atari model tables exactly reproduce the independent canonical executable extraction', async () => {
    const { readAtariStModelTables } = await import('../../tools/recovery/atari-st-model.mjs');
    const main = readFileSync(
        new URL('../../research/atari-st-original-main.bin', import.meta.url),
    );
    const before = Buffer.from(main);
    assert.deepEqual(readAtariStModelTables(main), ATARI_ST_NATIVE);
    assert.deepEqual(main, before);
    assert.throws(() => readAtariStModelTables(main.subarray(0, -1)), /size/);
    const corrupt = Buffer.from(main);
    corrupt[0] ^= 1;
    assert.throws(() => readAtariStModelTables(corrupt), /checksum/);
});

test('Atari names preserve native printable ASCII while Amiga defaults stay uppercase', async () => {
    const { readNativeRows } = await import('../../src/games/16bit/controllers/preferences.ts');
    const rows = JSON.stringify([{ name: 'a.B-3' + String.fromCharCode(10), score: 1234 }]);
    assert.equal(readNativeRows(rows, true)[0]?.name, 'a.B-3');
    assert.equal(readNativeRows(JSON.stringify([{ name: 'orbit', score: 42 }]))[0]?.name, 'ORBIT');
});

test('Atari rejects valid-sized sprites whose native animation sequence was truncated', () => {
    const world = fixture('../../src/games/atari-st/data/world.json');
    const graphics = fixture('../../src/assets/graphics/atari-st/resources.json') as {
        resources: Record<string, { frames: number[][] }>;
    };
    const stars = graphics.resources['game-stars'];
    assert.throws(
        () =>
            validateAtariStResources(world, {
                ...graphics,
                resources: {
                    ...graphics.resources,
                    'game-stars': { ...stars, frames: stars.frames.slice(0, 1) },
                },
            }),
        /corrupt/,
    );
});
