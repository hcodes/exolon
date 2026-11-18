import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    cpcHardwareRgb,
    decodeCpcBlock,
    decodeCpcByte,
    decodeCpcPixels,
    extractCpcGraphics,
} from '../../tools/graphics/cpc.mjs';
import {
    readCpcDisk,
    unpackCpcDisk,
    unpackCpcLoadingScreen,
    verifyCpcCommercialTape,
} from '../../tools/recovery/cpc.mjs';
import { createCpcLoadingSurface } from '../../src/view/cpc-bitmap.ts';
import { fromScr } from '../../src/view/spectrum.ts';

import type { CpcGraphics, GraphicTile, Graphics } from '../../src/types/graphics.ts';
import type { GameScreen, Placement } from '../../src/types/game.ts';
type SourceTile = GraphicTile & { collision: number; overlay: number; font: number; glyph: number };
type SourceGraphics = Omit<CpcGraphics, 'blocks' | 'compatibilityBlocks'> & {
    blocks: { id: number; tiles: SourceTile[]; actions: unknown[] }[];
    compatibilityBlocks: Record<string, { tiles: SourceTile[] }>;
    memorySha256: string;
    mapPlacementsSha256: string;
    width: number;
    nativeWidth: number;
    tableSha256: Record<string, string>;
};
type Provenance = {
    artifact: { sha256: string };
    source: { commercialVerification: { sha256: string } };
    loading: { sha256: string };
};

const sha = (bytes: ArrayLike<number>) =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const fixture = (commands: number[]) => {
    const memory = new Uint8Array(65536);
    memory.set([0xe6, 0, 0x20, ...commands], 0x1000);
    memory.set([0x80, 0x40, 0x08, 0x04, 0x20, 0x10, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0], 0x2010);
    return memory;
};

test('CPC Mode 0 uses interleaved planes and two native pixels per byte', () => {
    for (let pen = 0; pen < 16; pen++) {
        const left =
            ((pen & 1) << 7) |
            (((pen >> 1) & 1) << 3) |
            (((pen >> 2) & 1) << 5) |
            (((pen >> 3) & 1) << 1);
        assert.deepEqual(decodeCpcByte(left), [pen, 0]);
        assert.deepEqual(decodeCpcByte(left >> 1), [0, pen]);
    }
    assert.deepEqual(
        decodeCpcPixels([0x88, 0x55, ...Array(14).fill(0)]).slice(0, 8),
        [3, 3, 0, 0, 0, 0, 15, 15],
    );
    assert.throws(() => decodeCpcPixels([0]), /sixteen/);
});

test('CPC hardware palette maps original gate-array inks to RGB', () => {
    assert.deepEqual(cpcHardwareRgb(0x54), [0, 0, 0]);
    assert.deepEqual(cpcHardwareRgb(0x4b), [255, 255, 255]);
    assert.deepEqual(cpcHardwareRgb(0x5c), [128, 0, 0]);
    assert.deepEqual(cpcHardwareRgb(0x52), [0, 255, 0]);
    assert.throws(() => cpcHardwareRgb(1), /Unsupported/);
});

test('CPC E0 consumes one attribute byte and never recolors stored Mode 0 pixels', () => {
    const { cells } = decodeCpcBlock(fixture([0xe0, 0x46, 1, 0xe0, 0x12, 1, 0xff]), 0x1000);
    assert.deepEqual(
        cells.map((cell) => cell.color),
        [0x46, 0x12],
    );
    assert.deepEqual(cells[0].bitmap, cells[1].bitmap);
    assert.equal(cells[0].bitmap.length, 16);
    assert.deepEqual(decodeCpcPixels(cells[0].bitmap).slice(0, 8), [1, 1, 0, 0, 0, 0, 1, 1]);
});

test('CPC SPACE uses ASCII 32 from the main font and restores the selected font', () => {
    const { cells } = decodeCpcBlock(fixture([0xe7, 1, 0xff]), 0x1000);
    assert.deepEqual(
        cells.map(({ font, glyph, x }) => [font, glyph, x]),
        [
            [0x69dd, 32, 0],
            [0x2000, 1, 1],
        ],
    );
});

test('CPC drawing loops restore attributes and retain signed relative coordinates', () => {
    const { cells } = decodeCpcBlock(
        fixture([0xdf, 255, 254, 0xe0, 0x46, 0xe1, 2, 1, 0xe0, 0x12, 0xe2, 1, 0xff]),
        0x1000,
        { x: 0, y: 0 },
        { clip: false },
    );
    assert.deepEqual(
        cells.map((cell) => [cell.x, cell.y, cell.color]),
        [
            [254, 255, 0x46],
            [255, 255, 0x46],
            [0, 255, 0x46],
        ],
    );
});

test('CPC data readers reject truncation, invalid archives and drawing recursion', () => {
    assert.throws(() => readCpcDisk(Buffer.alloc(256)), /extended/);
    assert.throws(() => unpackCpcDisk(Buffer.alloc(194816)), /Unsupported/);
    assert.throws(() => unpackCpcLoadingScreen(Buffer.alloc(108)), /Unsupported/);
    assert.throws(
        () => verifyCpcCommercialTape(Buffer.alloc(100), Buffer.alloc(65536)),
        /Unsupported/,
    );
    const memory = fixture([0xe3, 0, 0x10, 0xff]);
    assert.throws(() => decodeCpcBlock(memory, 0x1000), /recursion/);
    memory[65535] = 0xe0;
    assert.throws(() => decodeCpcBlock(memory, 65535), /address/);
    assert.throws(() => extractCpcGraphics(memory), /Unsupported/);
});

test('shipped CPC data retains original 62 blocks, colorful artwork and native table strides', async () => {
    const bytes = await readFile(
        new URL('../../src/assets/graphics/amstrad-cpc/cpc-graphics.json', import.meta.url),
    );
    const graphics: SourceGraphics = JSON.parse(bytes.toString());
    const provenance: Provenance = JSON.parse(
        await readFile(
            new URL(
                '../../originals/graphics/amstrad-cpc/cpc-graphics-provenance.json',
                import.meta.url,
            ),
            'utf8',
        ),
    );
    assert.equal(provenance.artifact.sha256, sha(bytes));
    assert.equal(
        graphics.memorySha256,
        '496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec',
    );
    assert.equal(
        provenance.source.commercialVerification.sha256,
        '32f84af268431975f72847f1cd2d53bcfd1d4db1de0c04eed3f62532b8e2cf30',
    );
    const world: { screens: (GameScreen & { placements: Placement[] })[] } = JSON.parse(
        await readFile(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    assert.equal(
        graphics.mapPlacementsSha256,
        sha(Buffer.from(JSON.stringify(world.screens.map((screen) => screen.placements)))),
    );
    assert.deepEqual(graphics.menuUnsupportedRows, [13, 17]);
    assert.equal(graphics.width, 256);
    assert.equal(graphics.nativeWidth, 128);
    assert.equal(graphics.blocks.length, 62);
    assert.deepEqual(
        graphics.blocks.map((block) => block.id),
        Array.from({ length: 62 }, (_, id) => id),
    );
    assert.deepEqual(
        graphics.blocks
            .filter((block) => !block.tiles.length && !block.actions.length)
            .map((block) => block.id),
        [18, 41, 48, 49, 51],
    );
    for (const block of graphics.blocks) {
        assert.ok(block.tiles.every((tile) => tile.bitmap.length === 16));
    }
    const inks = new Set(
        graphics.blocks.flatMap((block) =>
            block.tiles.flatMap((tile) => decodeCpcPixels(tile.bitmap)),
        ),
    );
    assert.equal(inks.size, 16);
    for (const [name, length, hash] of [
        ['player', 4800, 'b8ec3a654fe7764da6499b977f9ea2ab1772128bf6c5cfd4ec295fc4dda73c12'],
        ['small', 2880, '2f2dcdd21e695be48565a01d1d25b50779022767bc6d2e52d32efc769d7fb1f8'],
        ['shifted', 432, '0300b6219f7f72efc8c2358bfa30e285ba1de3d03e9c6fcaf290ce03531bdb1a'],
        ['font', 944, '7ccd90849becfc1f081c3b59610b36e00e7d42a6ed5caa3556b709137758529f'],
        ['torch', 96, 'c56e0377ed6dd3bb82c9b86c1ce6f85d86621c8e4ffa959b70e4568894164dee'],
        ['mine', 64, '145baf7d82802600bf211d69b479a5cf5d6a3ea2c0f1290b5a02292af1fef722'],
        ['beam', 16, 'ea53b60e1b3450b019b80a2fa5f73f588d83d4aded11e1dab302d4a514daf729'],
        ['turret', 256, 'db0c0bef3171360d638b8294e09b8b4a91dec06ac7d2db85ebca9cbcea3eae16'],
    ] as const) {
        assert.equal(graphics[name].length, length);
        assert.equal(sha(graphics[name]), hash);
        assert.equal(graphics.tableSha256[name], hash);
    }
    assert.equal(graphics.palette.length, 16);
    assert.deepEqual(graphics.palette[0], [0, 0, 0]);
    assert.ok(graphics.screens.menu.length > 100);
    assert.ok(graphics.screens.scores.length > 300);
    assert.ok(graphics.screens.hud.length > 0);
    assert.ok(graphics.screens.gameOver.length > 0);
    assert.ok(graphics.blocks[13].tiles.some((tile) => tile.x < 0));
    assert.ok(graphics.blocks[2].tiles.some((tile) => tile.y < 0));
    assert.deepEqual(
        graphics.beam,
        [...Array(8)].flatMap(() => [0x55, 0xaa]),
    );
    assert.deepEqual(graphics.proceduralPixels.enemyBullet, {
        address: 0x1d9a,
        width: 4,
        height: 2,
        even: [0x8a, 0x88],
        odd: [0x45, 0x44],
    });
    assert.deepEqual(Object.keys(graphics.compatibilityBlocks), ['41', '48', '49', '51']);
    for (const [id, compatibility] of Object.entries(graphics.compatibilityBlocks)) {
        assert.equal(graphics.blocks[Number(id)].tiles.length, 0);
        const placement = world.screens
            .flatMap((screen) => screen.placements)
            .find((placement) => placement.block === Number(id));
        assert.ok(placement);
        assert.ok(compatibility.tiles.every((tile) => tile.collision === 1));
        const sourceTiles = graphics.blocks.flatMap((block) => block.tiles);
        for (const tile of compatibility.tiles) {
            const source = sourceTiles.find(
                (source) => source.font === tile.font && source.glyph === tile.glyph,
            );
            assert.ok(source, `Missing original CPC glyph ${tile.font.toString(16)}:${tile.glyph}`);
            assert.deepEqual(tile.bitmap, source.bitmap);
        }
        const screen = world.screens.find((screen) =>
            screen.placements.some((placement) => placement.block === Number(id)),
        );
        const instance = screen!.placements.findIndex(
            (placement) => placement.block === Number(id),
        );
        const origin = screen!.placements[instance];
        const expected = screen!.tiles.flatMap((tile, index) =>
            tile?.instance === instance && tile.block === Number(id) && tile.collision === 1
                ? [[(index % 32) - origin.x, (index >> 5) - origin.y, tile.collision, tile.overlay]]
                : [],
        );
        const order = (a: (number | undefined)[], b: (number | undefined)[]) =>
            a[1]! - b[1]! || a[0]! - b[0]!;
        assert.deepEqual(
            compatibility.tiles
                .map((tile) => [tile.x, tile.y, tile.collision, tile.overlay])
                .sort(order),
            expected.sort(order),
        );
    }
    assert.equal(graphics.loading.length, 16384);
    assert.equal(sha(graphics.loading), provenance.loading.sha256);
    const zx: Graphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/zx-spectrum/graphics.json', import.meta.url),
            'utf8',
        ),
    );
    const loading = createCpcLoadingSurface(graphics.loading),
        source = fromScr(zx.loading);
    assert.deepEqual(
        [...new Set(loading.pixels)].sort((a, b) => a - b),
        [0, 5, 11, 15],
    );
    for (let i = 0; i < 256 * 184; i++)
        assert.equal(
            Boolean(loading.pixels[i]),
            Boolean(source.bits[i]),
            `CPC planet/title pixel ${i}`,
        );
});
