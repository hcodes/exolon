import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createState, step } from '../../src/model/state.ts';
import type { Graphics } from '../../src/types/graphics.ts';
import type { GameScreen } from '../../src/types/game.ts';
import { extractGraphics } from '../../tools/graphics/zx.mjs';
import { decodeBlock } from '../../tools/recovery/world.mjs';

const graphics: Graphics = JSON.parse(
    await readFile(
        new URL('../../src/assets/graphics/zx-spectrum/graphics.json', import.meta.url),
        'utf8',
    ),
);
const flat = (): GameScreen => ({
    id: 0,
    placements: [],
    actions: [],
    objects: [],
    tiles: Array.from({ length: 768 }, (_, index) =>
        index >= 576 ? { collision: 1, block: 33 } : null,
    ),
});

test('shipped graphics contain byte-identical source sprite, font and loading tables', () => {
    for (const [name, length, hash] of [
        ['player', 2400, '14ccd49c4c5a6d00f1f166c971c5859f4d56f078fd8d0b832836cf097e238154'],
        ['small', 1440, '5eaf36b784bc5f99356e21adbbceae60e7cef03b80dd505def42c42b7525138d'],
        ['shifted', 576, '0ef273ea1edb496db44d73f495006d9f9a14bb0102c68dfba0b7ac0fd5ebe0cb'],
        ['font', 472, '2b03e94e2b98d8512e1e836c3694f16331a5c45321b11ba3280abb91ef9083fd'],
        ['mine', 32, '7682dae0ab2934df213832effe5aa40bda30d40b5d43f6d4eff5a3738b021330'],
        ['star', 8, '48443c868f27fd5d4e1749506108b7419f6c508bd93fa3cb4f99b5745241e476'],
        ['loading', 6912, '327fa6c5d945415fe627e5c86478e69162cc6317f4a7acfc0512727c8f375654'],
    ] as const) {
        assert.equal(graphics[name].length, length);
        assert.equal(createHash('sha256').update(Buffer.from(graphics[name])).digest('hex'), hash);
    }
    assert.equal(graphics.shapes.length, 483);
    assert.throws(
        () => extractGraphics(new Uint8Array(65536), new Uint8Array(6912), {}),
        /Unsupported/,
    );
});

test('source walking advances exactly one original frame per successful step and uses idle frame 5', () => {
    let state = createState(flat());
    assert.equal(state.player.sprite, 5);
    const frames = [];
    for (let tick = 0; tick < 12; tick++) {
        state = step(state, { right: true }).state;
        frames.push(state.player.sprite);
    }
    assert.deepEqual(frames, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1]);
    const phase = state.player.walkPhase;
    state = step(state, {}).state;
    assert.equal(state.player.sprite, 5);
    assert.equal(state.player.walkPhase, phase);
    state = step(state, { left: true }).state;
    assert.equal(state.player.sprite, 5);
    assert.equal(state.player.direction, -1);
    assert.equal(state.player.walkPhase, phase);
});

test('jump, fall, duck and death use source poses while preserving the original physics', () => {
    let state = createState(flat());
    state = step(state, { duck: true }).state;
    assert.equal(state.player.sprite, 10);
    state = step(state, { jump: true }).state;
    assert.equal(state.player.sprite, 3);
    assert.equal(state.player.y, 108);
    state = step(state, {}).state;
    assert.equal(state.player.sprite, 3);
    const falling = createState(flat());
    falling.player.y = 80;
    falling.player.walk = 0;
    assert.equal(step(falling, {}).state.player.sprite, 9);
    const hit = createState(flat());
    hit.enemyBullets = [{ x: 18, y: 120, dx: 0 }];
    const killed = step(hit, {}).state;
    assert.equal(killed.death, 46);
    assert.equal(killed.player.sprite, 11);
});

test('xMSG SPACE temporarily selects the source main font and restores the previous font', () => {
    const memory = new Uint8Array(65536);
    memory.set([0xe6, 0, 0xe0, 0xe7, 1, 0xff], 0x9000);
    memory[0xd8e0] = 0x80;
    memory[0xe008] = 0x40;
    const { cells } = decodeBlock(memory, 0x9000, { x: 0, y: 0 });
    assert.equal(cells[0].font, 0xd7e0);
    assert.equal(cells[0].bitmap[0], 0x80);
    assert.equal(cells[1].font, 0xe000);
    assert.equal(cells[1].bitmap[0], 0x40);
});

test('turret recoil uses the eight byte-identical original barrel glyph pairs', () => {
    assert.equal(Array.isArray(graphics.turret), true);
    assert.equal(graphics.turret.length, 128);
    assert.equal(
        createHash('sha256').update(Buffer.from(graphics.turret)).digest('hex'),
        'b92d1ecfc310e8229c420dce1026c4e02cc7cb60f49eb99b6c177f0c029150cc',
    );
});

test('a real turret shot starts recoil and the existing simulation returns it over eight steps', () => {
    const world = flat();
    world.objects = [{ id: 1, type: 3, x: 20, y: 14 }];
    let state = createState(world);
    state.objects[0].phase = 1;
    state.seed = 5000;
    const shot = step(state, {});
    state = shot.state;
    assert.equal(shot.events.filter((event) => event.type === 'turret').length, 1);
    const phases = [state.objects[0].phase];
    for (let tick = 0; tick < 8; tick++) {
        state = step(state, {}).state;
        phases.push(state.objects[0].phase);
    }
    assert.deepEqual(phases, [9, 8, 7, 6, 5, 4, 3, 2, 1]);
});
