import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeC64Block, decodeC64Pixels, extractC64Graphics } from '../../tools/graphics/c64.mjs';

import type { GraphicTile, NativeGraphics } from '../../src/types/graphics.ts';
type SourceGraphics = Omit<NativeGraphics, 'blocks'> & {
    blocks: { id: number; tiles: (GraphicTile & { ramColor: number })[]; actions: unknown[] }[];
};

const sha = (bytes: ArrayLike<number>) =>
    createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const fixture = (bytes: number[]) => {
    const memory = new Uint8Array(65536);
    memory.set(
        [0, 0xe6, 0xa2, 0x94, 0xd5, 0xe3, 0x87, 0x1c, 0, 0x6e, 0x2a, 0x94, 0x5d, 0xe3, 0x87, 0xc1],
        0x3a9e,
    );
    memory.set([0xe6, 0, 0x20, ...bytes], 0x1000);
    memory.set([0x1b, 0x55, 0xaa, 0xff, 0, 0, 0, 0], 0x2008);
    return memory;
};

test('C64 E0 consumes the screen byte and color RAM byte before the glyph', () => {
    const { cells } = decodeC64Block(fixture([0xe0, 0xa2, 0x0d, 1, 0xff]), 0x1000);
    assert.equal(cells.length, 1);
    assert.deepEqual([cells[0].color, cells[0].ramColor, cells[0].glyph], [0xa2, 0x0d, 1]);
    assert.equal(cells[0].bitmap[0], 0x1b);
});

test('C64 multicolor pairs use background, screen high, screen low and color RAM', () => {
    const pixels = decodeC64Pixels([0x1b, 0, 0, 0, 0, 0, 0, 0], 0xa2, 0x8d);
    assert.deepEqual(pixels.slice(0, 8), [0, 0, 10, 10, 2, 2, 13, 13]);
    assert.equal(pixels.length, 64);
    assert.throws(() => decodeC64Pixels([0x1b], 0, 0), /eight/i);
});

test('C64 compact attributes use the original lookup table', () => {
    const { cells } = decodeC64Block(fixture([0xd1, 1, 0xff]), 0x1000);
    assert.equal(cells[0].color, 0xa2);
});

test('C64 repeat restores the screen attribute while color RAM persists', () => {
    const { cells } = decodeC64Block(
        fixture([0xe0, 0x12, 4, 0xe1, 2, 1, 0xe0, 0x34, 5, 0xe2, 1, 0xff]),
        0x1000,
    );
    assert.deepEqual(
        cells.map(({ color, ramColor }) => [color, ramColor]),
        [
            [0x12, 4],
            [0x12, 5],
            [0x12, 5],
        ],
    );
});

test('C64 SPACE uses glyph zero in the main font and restores the current font', () => {
    const memory = fixture([0xe7, 1, 0xff]);
    memory[0x91ad] = 0x80;
    const { cells } = decodeC64Block(memory, 0x1000);
    assert.deepEqual(
        cells.map(({ font, glyph }) => [font, glyph]),
        [
            [0x91ad, 0],
            [0x2000, 1],
        ],
    );
    assert.deepEqual(
        cells.map(({ bitmap }) => bitmap[0]),
        [0x80, 0x1b],
    );
});

test('C64 decoder accepts low RAM but rejects truncated commands and glyphs', () => {
    const memory = fixture([1, 0xff]);
    assert.equal(decodeC64Block(memory, 0x1000).cells.length, 1);
    memory[0xffff] = 0xe0;
    assert.throws(() => decodeC64Block(memory, 0xffff), /address/i);
    memory.set([0xe6, 0xff, 0xff, 1, 0xff], 0x1000);
    assert.throws(() => decodeC64Block(memory, 0x1000), /address/i);
    assert.throws(() => extractC64Graphics(new Uint8Array(65536)), /Unsupported/);
    assert.throws(() => extractC64Graphics(new Uint8Array(65535)), /Unsupported/);
});

test('shipped C64 assets preserve all 62 source blocks and original actor tables', async () => {
    const bytes = await readFile(
        new URL('../../src/assets/graphics/c64/c64-graphics.json', import.meta.url),
    );
    const graphics: SourceGraphics = JSON.parse(bytes.toString());
    const provenance: { artifact: { sha256: string } } = JSON.parse(
        await readFile(
            new URL('../../originals/graphics/c64/c64-graphics-provenance.json', import.meta.url),
            'utf8',
        ),
    );
    assert.equal(provenance.artifact.sha256, sha(bytes));
    assert.equal(graphics.blocks.length, 62);
    assert.deepEqual(
        graphics.blocks.map(({ id }) => id),
        Array.from({ length: 62 }, (_, i) => i),
    );
    for (const block of graphics.blocks) {
        assert.ok(block.tiles.length > 0 || block.actions.length > 0, `Block ${block.id} is empty`);
        assert.ok(
            block.tiles.every(
                (tile) => tile.bitmap.length === 8 && Number.isInteger(tile.ramColor),
            ),
        );
    }
    for (const [name, length, hash] of [
        ['player', 2400, '14ccd49c4c5a6d00f1f166c971c5859f4d56f078fd8d0b832836cf097e238154'],
        ['small', 1440, '75eabedd076e340c11e9da9f9fc44c723639781ab0d09a645062d39c52efecda'],
        ['shifted', 576, 'ed8df247bfdcf85e4ee825637a7a8a0e037ed9961ed1245609d980f63cab76b5'],
        ['font', 472, '017bd5afe69082bbad6b71cd44d72e58bebeed47538373f5e2209fef6c000134'],
        ['torch', 48, '710c7a0a64d6b326709b4f915bae8a3bd17065958e42ac3a2e205a1d7d77c7b1'],
        ['mine', 32, '2aa8f6e38cf71665c0e7eb162b4f694d2b28805466de40ee47ef9c585a17be2d'],
        ['beam', 8, '8f20243961ba021bf10ab855778bfa4e23d007b8646913d28f2a21211e20d220'],
        ['turret', 128, '84c0f17bbcf0b239f4f770d13a7446488db7958620ac8d6205f9a08efce14e27'],
    ] as const) {
        assert.equal(graphics[name].length, length);
        assert.equal(sha(graphics[name]), hash);
    }
    assert.ok(graphics.screens.menu.length > 100);
    assert.ok(graphics.screens.hud.length > 0);
    assert.ok(graphics.screens.scores.length > 100);
    assert.ok(graphics.screens.gameOver.length > 0);
    assert.ok(graphics.blocks[13].tiles.some((tile) => tile.x < 0));
    assert.ok(graphics.blocks[2].tiles.some((tile) => tile.y < 0));
});
