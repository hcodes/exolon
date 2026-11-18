import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const graphicsUrl = new URL('../../src/assets/graphics/atari-st/resources.json', import.meta.url);
const worldUrl = new URL('../../src/games/atari-st/data/world.json', import.meta.url);
const sha = (bytes: number[]) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');

test('Atari ST preserves the canonical loading bitmap, ST DAC colors and native placement', async () => {
    const graphics = JSON.parse(await readFile(graphicsUrl, 'utf8'));
    assert.equal(graphics.title.width, 320);
    assert.equal(graphics.title.height, 200);
    const crop = Array.from({ length: 187 }, (_, y) =>
        graphics.title.pixels.slice(y * 320 + 48, y * 320 + 288),
    ).flat();
    assert.equal(sha(crop), '80dc0fe6989484edea7ff8b84d9a552365baa3a9a60c8981e0adce1ff6bd867f');
    assert.deepEqual(graphics.title.palette[14], [182, 36, 255]);
    assert.deepEqual(graphics.palette[2], [255, 255, 255]);
    assert.deepEqual(
        graphics.text.menu.map((row: { ink: number }) => row.ink),
        [11, 7, 11, 2, 7],
    );
    assert.deepEqual(
        graphics.text.gameOver.map((row: { ink: number }) => row.ink),
        [7, 7],
    );
    assert.equal(graphics.text.menu[0].text, 'PROGRAMMED BY MARTIN J. BYSH');
    assert.deepEqual(graphics.font[0], [24, 60, 102, 102, 126, 102, 102, 0]);
});

test('Atari ST decodes all five canonical map banks and independent source sprite banks', async () => {
    const world = JSON.parse(await readFile(worldUrl, 'utf8'));
    const graphics = JSON.parse(await readFile(graphicsUrl, 'utf8'));
    assert.equal(world.screens.length, 125);
    assert.equal(
        sha(world.screens.flatMap((screen: { tiles: number[] }) => screen.tiles)),
        'fab04c626a33f11ee79bc7a7ec5d7952b2a4036824ae7306e66f0462bc04694b',
    );
    assert.equal(
        sha(graphics.resources.player.frames.flat()),
        'ca42edefaa0f39f618b8e936b18dce5574db2a3b937cba4d1db8ec5a27dd53d3',
    );
    assert.equal(graphics.resources.death.frames.length, 30);
    assert.deepEqual(graphics.highScores.slice(0, 2), [
        { name: 'MARTIN', score: 1000 },
        { name: 'GARY', score: 1000 },
    ]);
    assert.equal(graphics.highScores.length, 34);
});

test('Atari ST respects native turret type heights and the laser bank after the launcher padding', async () => {
    const graphics = JSON.parse(await readFile(graphicsUrl, 'utf8'));
    const world = JSON.parse(await readFile(worldUrl, 'utf8'));
    assert.equal(
        world.screens[0].static.find((shape: { address: number }) => shape.address === 0x3a13e)
            .height,
        64,
    );
    assert.equal(
        sha(graphics.resources['laser-animation'].frames.flat()),
        'ce41c8b01036fd67cae2f5523bf8434ff6fe89db8bc9c113c8c927ad852cdb1d',
    );
    const row = graphics.resources.spikes.frames[0].slice(48 * 32);
    assert.deepEqual(
        row,
        [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0,
        ],
    );
});

test('Atari ST rejects a different executable or substituted system font before decoding', async () => {
    const { extractAtariStGraphics, decodeAtariStFont, atariStRgb } =
        await import('../../tools/graphics/atari-st.mjs');
    assert.throws(
        () => extractAtariStGraphics(new Map(), Buffer.alloc(0xccca), Buffer.alloc(0)),
        /unverified.*main/i,
    );
    assert.throws(() => decodeAtariStFont(Buffer.alloc(2650)), /unverified.*font/i);
    assert.deepEqual(atariStRgb(0x753), [255, 182, 109]);
});

test('Atari ST keeps the complete TOS punctuation glyphs and independent native bitmap differences', async () => {
    const graphics = JSON.parse(await readFile(graphicsUrl, 'utf8'));
    const amiga = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(graphics.asciiFont.length, 256);
    assert.deepEqual(graphics.asciiFont[47], [2, 6, 12, 24, 48, 96, 64, 0]);
    for (const [name, difference] of [
        ['bullets', 25],
        ['energy-beam', 54],
        ['missile', 27],
        ['spikes', 2],
    ] as const) {
        const a: number[] = graphics.resources[name].frames.flat();
        const b: number[] = amiga.resources[name].frames.flat();
        assert.equal(
            a.reduce((count, value, index) => count + Number(value !== b[index]), 0),
            difference,
        );
    }
});
