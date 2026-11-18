import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseTap, inspectTap } from '../../tools/recovery/tap.mjs';
import {
    relocateGame,
    readPlacements,
    decodeBlock,
    browserWorld,
} from '../../tools/recovery/world.mjs';
import type { World, Tile } from '../../src/types/game.ts';
import { traceContours } from '../../tools/graphics/contours.mjs';

function signedArea(loop: number[][]) {
    return (
        loop.slice(1).reduce((area, point, index) => {
            const previous = loop[index];
            return area + previous[0] * point[1] - point[0] * previous[1];
        }, 0) / 2
    );
}

// Sample the default Canvas nonzero winding rule at each source pixel centre.
function rasterizeContours(loops: number[][][]) {
    return Array.from({ length: 8 }, (_, y) => {
        let row = 0;
        for (let x = 0; x < 8; x++) {
            let winding = 0;
            for (const loop of loops) {
                for (let i = 1; i < loop.length; i++) {
                    const [ax, ay] = loop[i - 1];
                    const [bx, by] = loop[i];
                    const cross = (bx - ax) * (y + 0.5 - ay) - (x + 0.5 - ax) * (by - ay);
                    if (ay <= y + 0.5 && by > y + 0.5 && cross > 0) winding++;
                    if (ay > y + 0.5 && by <= y + 0.5 && cross < 0) winding--;
                }
            }
            if (winding) row |= 128 >> x;
        }
        return row;
    });
}

function assertSimpleContours(loops: number[][][]) {
    for (const loop of loops) {
        assert.ok(loop.length >= 5);
        assert.deepEqual(loop[0], loop.at(-1));
        assert.equal(
            new Set(loop.slice(0, -1).map((point) => point.join(','))).size,
            loop.length - 1,
        );
        for (let i = 1; i < loop.length; i++) {
            const [x, y] = loop[i];
            const [previousX, previousY] = loop[i - 1];
            assert.ok(Number.isInteger(x) && x >= 0 && x <= 8);
            assert.ok(Number.isInteger(y) && y >= 0 && y <= 8);
            assert.ok((x === previousX) !== (y === previousY));
        }
    }
}

test('source contours keep empty cells, solid silhouettes and opposite hole winding', () => {
    assert.deepEqual(traceContours(Array(8).fill(0)), []);
    const solid = traceContours(Array(8).fill(255));
    assert.deepEqual(solid, [
        [
            [0, 0],
            [8, 0],
            [8, 8],
            [0, 8],
            [0, 0],
        ],
    ]);
    assert.equal(signedArea(solid[0]), 64);
    const ringBitmap = [255, 129, 129, 129, 129, 129, 129, 255];
    const ring = traceContours(ringBitmap);
    assertSimpleContours(ring);
    assert.deepEqual(
        ring.map(signedArea).sort((a, b) => a - b),
        [-36, 64],
    );
    assert.deepEqual(rasterizeContours(ring), ringBitmap);
});

test('corner-touching source pixels and holes have separate simple boundary loops', () => {
    const diagonal = [128, 64, 0, 0, 0, 0, 0, 0];
    const diagonalLoops = traceContours(diagonal);
    assertSimpleContours(diagonalLoops);
    assert.deepEqual(diagonalLoops.map(signedArea), [1, 1]);
    assert.deepEqual(rasterizeContours(diagonalLoops), diagonal);
    const touchingHole = [127, 191, 255, 255, 255, 255, 255, 255];
    const touchingLoops = traceContours(touchingHole);
    assertSimpleContours(touchingLoops);
    assert.deepEqual(
        touchingLoops.map(signedArea).sort((a, b) => a - b),
        [-1, 63],
    );
    assert.deepEqual(rasterizeContours(touchingLoops), touchingHole);
});

test('contour nonzero fill reconstructs every 4 by 4 source topology exactly', () => {
    for (let mask = 0; mask < 65536; mask++) {
        const bitmap = Array.from({ length: 8 }, (_, y) =>
            y < 4 ? ((mask >> (y * 4)) & 15) << 4 : 0,
        );
        const contours = traceContours(bitmap);
        assert.deepEqual(rasterizeContours(contours), bitmap, `Source mask ${mask}`);
        const pixels = bitmap.reduce(
            (sum, row) => sum + row.toString(2).replaceAll('0', '').length,
            0,
        );
        assert.equal(
            contours.reduce((sum, loop) => sum + signedArea(loop), 0),
            pixels,
        );
    }
});

test('browser world deduplicates source geometry and preserves existing tile data', () => {
    const empty = Array(8).fill(0);
    const bitmap = [255, 129, 129, 129, 129, 129, 129, 255];
    const tile = {
        collision: 3,
        block: 11,
        instance: 2,
        color: 69,
        overlay: 255,
        glyph: 4,
        font: 0xe000,
        bitmap,
    };
    const world = {
        screens: [
            {
                id: 0,
                tiles: [null, { ...tile, bitmap: empty }, tile, { ...tile, bitmap: [...bitmap] }],
            },
        ],
        enemies: [{ screen: 0 }],
        blockNames: ['gate'],
        pump: { width: 24, height: 32, tiles: [{ x: 1, y: 2, color: 68, bitmap }] },
    };
    const result = browserWorld(world);
    assert.equal(result.contours.length, 2);
    assert.deepEqual(result.contours[0], []);
    assert.deepEqual(
        result.screens[0].tiles.map((value: (Tile & { shape: number }) | null) => value?.shape),
        [undefined, 0, 1, 1],
    );
    assert.deepEqual(result.screens[0].tiles[2], {
        collision: 3,
        block: 11,
        instance: 2,
        color: 69,
        overlay: 255,
        glyph: 4,
        ink: true,
        shape: 1,
    });
    assert.deepEqual(rasterizeContours(result.contours[1]), bitmap);
    assert.equal(result.enemies, world.enemies);
    assert.equal(result.blockNames, world.blockNames);
    assert.deepEqual(result.pump, {
        width: 24,
        height: 32,
        tiles: [{ x: 1, y: 2, color: 68, ink: true, shape: 1 }],
    });
    assert.equal(world.screens[0].tiles[2]!.bitmap, bitmap);
    assert.equal('contours' in world, false);
});

test('every shipped source shape has simple loops and reconstructs its contour geometry', async () => {
    const world: Required<World> = JSON.parse(
        await readFile(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    const masks = new Set();
    for (const loops of world.contours) {
        assertSimpleContours(loops);
        const bitmap = rasterizeContours(loops);
        assert.deepEqual(traceContours(bitmap), loops);
        assert.equal(
            masks.has(bitmap.join(',')),
            false,
            'Shipped shape masks must be deduplicated',
        );
        masks.add(bitmap.join(','));
    }
    for (const tile of [...world.screens.flatMap((screen) => screen.tiles), ...world.pump.tiles]) {
        if (!tile) continue;
        assert.ok(
            Number.isInteger(tile.shape) && tile.shape! >= 0 && tile.shape! < world.contours.length,
        );
        assert.equal(tile.ink, world.contours[tile.shape!].length > 0);
        assert.equal('bitmap' in tile, false);
        assert.equal('font' in tile, false);
    }
});

// Literal bytes: flag 0xff, payload 0x12/0x34, XOR checksum 0xd9.
test('TAP exposes checked payloads and offsets across blocks', () => {
    const bytes = Uint8Array.from([4, 0, 255, 18, 52, 217, 2, 0, 0, 0]);
    const blocks = parseTap(bytes);
    assert.deepEqual(
        blocks.map(({ offset, flag, payload }) => ({ offset, flag, payload: [...payload] })),
        [
            { offset: 0, flag: 255, payload: [18, 52] },
            { offset: 6, flag: 0, payload: [] },
        ],
    );
});

test('game relocation preserves the entire final 0x6d60..0xffff region', () => {
    const payload = new Uint8Array(37536);
    payload.set([243, 49, 0, 0]);
    payload[37535] = 93;
    const memory = relocateGame(payload);
    assert.equal(memory.length, 65536);
    assert.equal(memory[0x6d5f], 0);
    assert.deepEqual([...memory.slice(0x6d60, 0x6d64)], [243, 49, 0, 0]);
    assert.equal(memory[65535], 93);
    assert.throws(() => relocateGame(payload.slice(1)), /size/i);
    assert.throws(() => relocateGame(new Uint8Array(37536)), /entry/i);
});

test('screen lists preserve offscreen unsigned coordinates and reject invalid pointers', () => {
    const memory = new Uint8Array(65536);
    memory.set([19, 0, 0, 11, 231, 1, 255], 0xc900);
    assert.deepEqual(readPlacements(memory, 0xc900), [
        { y: 19, x: 0, block: 0 },
        { y: 11, x: 231, block: 1 },
    ]);
    assert.throws(() => readPlacements(memory, 0x4000), /address/i);
    memory[65535] = 1;
    assert.throws(() => readPlacements(memory, 65535), /truncated/i);
});

test('block decoder interprets repeats, collision markers and glyphs independently', () => {
    const memory = new Uint8Array(65536);
    memory.set([0xe6, 0, 0xe0, 0xe8, 0, 0xe1, 2, 0, 0xe2, 0xe8, 3, 1, 0xe4, 2, 2, 255], 0xd000);
    memory.set([128, 64, 32, 16, 8, 4, 2, 1], 0xe000);
    const result = decodeBlock(memory, 0xd000, { x: 2, y: 4 });
    assert.deepEqual(
        result.cells.map((c) => [c.x, c.y, c.collision, c.glyph]),
        [
            [2, 4, 0, 0],
            [3, 4, 0, 0],
            [4, 4, 3, 1],
            [5, 4, 3, 2],
            [6, 4, 3, 2],
        ],
    );
    assert.deepEqual(result.cells[0].bitmap, [128, 64, 32, 16, 8, 4, 2, 1]);
});

test('block decoder bounds corrupt loops and recursive calls', () => {
    const memory = new Uint8Array(65536);
    memory.set([0xe3, 0, 0xd0], 0xd000);
    assert.throws(() => decodeBlock(memory, 0xd000, { x: 0, y: 0 }), /recursion/i);
    memory.set([0xe2, 255], 0xd000);
    assert.throws(() => decodeBlock(memory, 0xd000, { x: 0, y: 0 }), /loop/i);
});

test('TAP rejects incomplete length and truncated blocks', () => {
    assert.throws(() => parseTap(Uint8Array.from([4])), /length/i);
    assert.throws(() => parseTap(Uint8Array.from([4, 0, 255, 18])), /truncated/i);
});

test('TAP rejects missing flag/checksum and invalid XOR', () => {
    assert.throws(() => parseTap(Uint8Array.from([0, 0])), /size/i);
    assert.throws(() => parseTap(Uint8Array.from([1, 0, 255])), /size/i);
    assert.throws(() => parseTap(Uint8Array.from([4, 0, 255, 18, 52, 0])), /checksum/i);
});

test('TAP inspector decodes standard little-endian header fields', () => {
    // CODE "TEST      ", length 2, start 0x8000, parameter2 0x8000.
    const bytes = Uint8Array.from([
        19, 0, 0, 3, 84, 69, 83, 84, 32, 32, 32, 32, 32, 32, 2, 0, 0, 128, 0, 128, 23,
    ]);
    assert.deepEqual(inspectTap(bytes), [
        {
            offset: 0,
            flag: 0,
            size: 19,
            header: { type: 3, name: 'TEST', length: 2, parameter1: 32768, parameter2: 32768 },
        },
    ]);
});
