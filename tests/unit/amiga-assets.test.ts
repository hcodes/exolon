import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    decodeAmigaPlanar,
    mirrorAmigaFrame,
    extractAmigaGraphics,
} from '../../tools/graphics/amiga.mjs';

test('Amiga native planar decoder preserves bitplane weight and 16 pixel word order', () => {
    const source = new Uint8Array([0x80, 0, 0x40, 0, 0x20, 0, 0x10, 0, 0, 1, 0, 2, 0, 4, 0, 8]);
    const pixels = decodeAmigaPlanar(source, 32, 1);
    assert.deepEqual(pixels.slice(0, 5), [1, 2, 4, 8, 0]);
    assert.deepEqual(pixels.slice(27), [0, 8, 4, 2, 1]);
    assert.deepEqual(mirrorAmigaFrame([1, 2, 3, 4, 5, 6], 3, 2), [3, 2, 1, 6, 5, 4]);
    assert.throws(() => decodeAmigaPlanar(new Uint8Array(1), 32, 1), /incomplete/i);
});

test('Amiga source extraction rejects unverified disk data', () => {
    assert.throws(() => extractAmigaGraphics(new Uint8Array(100)), /size/i);
});

test('Amiga campaign and loading title retain original decoded golden data', async () => {
    const read = async (path: string) =>
        JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
    const world = await read('../../src/games/amiga/data/world.json');
    const graphics = await read('../../src/assets/graphics/amiga/resources.json');
    assert.equal(world.screens.length, 125);
    assert.ok(world.screens.every((screen: { tiles: number[] }) => screen.tiles.length === 920));
    assert.equal(
        new Set(world.screens.map((screen: { tiles: number[] }) => screen.tiles.join(','))).size,
        125,
    );
    assert.deepEqual(graphics.title.palette[0], [0, 0, 0]);
    assert.deepEqual(graphics.title.palette[1], [119, 102, 68]);
    assert.equal(graphics.title.pixels.length, 64000);
    assert.equal(graphics.resources.player.frames.length, 30);
    assert.ok(graphics.resources.player.frames.every((frame: number[]) => frame.length === 1280));
    const first = graphics.resources.player.frames[0];
    assert.deepEqual(
        graphics.resources.player.frames[15].slice(0, 32),
        first.slice(0, 32).reverse(),
    );
    assert.deepEqual(world.screens[0].static[0], {
        address: 269936,
        x: 176,
        y: 0,
        width: 64,
        height: 64,
        transparent: false,
        resource: 'static-41e70-64-64',
    });
});

test('Amiga decoded campaign, title and hero match independently recovered source goldens', async () => {
    const graphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    );
    const world = JSON.parse(
        await readFile(new URL('../../src/games/amiga/data/world.json', import.meta.url), 'utf8'),
    );
    const sha = (bytes: number[]) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    assert.equal(
        sha(world.screens.flatMap((s: { tiles: number[] }) => s.tiles)),
        'fab04c626a33f11ee79bc7a7ec5d7952b2a4036824ae7306e66f0462bc04694b',
    );
    assert.equal(
        sha(graphics.resources.player.frames.flat()),
        'ca42edefaa0f39f618b8e936b18dce5574db2a3b937cba4d1db8ec5a27dd53d3',
    );
    assert.equal(
        sha(graphics.title.pixels),
        '2c52773d205452ca1da83556d1f5a97048555cf91aaf74aded028b3acc1bf743',
    );
    assert.equal(
        sha(graphics.tilesets[0].flat()),
        'fc5f8c733e29f563303697c50a4fa67b9da99c810ee84ec7e1a90cafd116728f',
    );
    assert.equal(
        sha(graphics.tilesets[1].flat()),
        'd0b3e65033adbfa3c6c65612f6bb518df8b0a1b71f8c57ce11339a46578fbfe9',
    );
});

test('Amiga menu keeps its native credit coordinates and independent hall of fame names', async () => {
    const graphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    );
    assert.deepEqual(graphics.text.menu[0], {
        address: 64527,
        x: 80,
        y: 70,
        text: 'program by m.j. bysh',
    });
    assert.equal(graphics.highScores.length, 34);
    assert.deepEqual(graphics.highScores[0], { name: 'guy', score: 1000 });
    assert.deepEqual(graphics.highScores[1], { name: 'jodowein', score: 1000 });
    assert.equal(graphics.resources.death.width, 48);
    assert.equal(graphics.resources.death.height, 48);
    assert.equal(graphics.resources.death.frames.length, 30);
    assert.equal(graphics.resources.rocket.width, 32);
    assert.equal(graphics.resources.rocket.height, 15);
});

test('Amiga spike and pod particle resources use their native source draw dimensions', async () => {
    const graphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(graphics.resources['pod-particles'].address, 0x16210);
    assert.equal(graphics.resources['pod-particles'].width, 16);
    assert.equal(graphics.resources['pod-particles'].frames.length, 1);
    assert.equal(graphics.resources.spikes.address, 0x18102);
    assert.equal(graphics.resources.spikes.width, 32);
    assert.equal(graphics.resources.spikes.height, 49);
    assert.ok(
        graphics.resources.spikes.frames[0].some((ink: number) => ink !== 0),
        'late-loaded piston graphics must not be an empty startup-RAM region',
    );
});

test('Amiga finish gate decodes the original interleaved byte plane order', async () => {
    const graphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    );
    const gate = graphics.resources['exit-gate'];
    assert.equal(gate.frames.length, 2);
    assert.equal(gate.width, 16);
    assert.equal(gate.height, 64);
    assert.deepEqual(
        gate.frames[0].slice(0, 16),
        [15, 8, 15, 8, 15, 8, 15, 8, 4, 11, 7, 3, 3, 11, 4, 11],
    );
});
