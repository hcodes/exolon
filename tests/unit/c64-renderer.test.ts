import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createC64Surface,
    putC64Cell,
    blitC64Sprite,
    toC64Rgba,
} from '../../src/view/c64-bitmap.ts';

test('native C64 cells decode four packed colors as double-width pixels', () => {
    const surface = createC64Surface();
    putC64Cell(surface, {
        x: 0,
        y: 0,
        bitmap: [0x1b, 0, 0, 0, 0, 0, 0, 0],
        color: 0x61,
        ramColor: 14,
    });
    assert.deepEqual([...surface.pixels.slice(0, 8)], [0, 0, 6, 6, 1, 1, 14, 14]);
    assert.equal(toC64Rgba(surface).length, 256 * 192 * 4);
    assert.equal(toC64Rgba(surface)[3], 255);
});

test('C64 enemy pairs retain transparent backgrounds and hires hero pixels stay narrow', () => {
    const surface = createC64Surface();
    surface.pixels.fill(9);
    blitC64Sprite(surface, [0x1b], 8, 1, 0, 0, 5, { multicolor: true, foreground: false });
    assert.deepEqual([...surface.pixels.slice(0, 8)], [9, 9, 2, 2, 5, 5, 1, 1]);
    blitC64Sprite(surface, [0x80], 8, 1, 0, 1, 1, { foreground: false });
    assert.deepEqual([...surface.pixels.slice(256, 264)], [1, 9, 9, 9, 9, 9, 9, 9]);
    blitC64Sprite(surface, [0x80], 8, 1, 0, 2, 1, { mirror: true, foreground: false });
    assert.deepEqual([...surface.pixels.slice(512, 520)], [9, 9, 9, 9, 9, 9, 9, 1]);
});

test('C64 foreground cells hide sprites without erasing exposed parts', () => {
    const surface = createC64Surface();
    surface.allowed[0] = 0;
    blitC64Sprite(surface, [0xff, 0xff], 16, 1, 0, 0, 1);
    assert.deepEqual(
        [...surface.pixels.slice(0, 16)],
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
    );
    blitC64Sprite(surface, [0xff], 8, 1, -4, 1, 7, { foreground: false });
    assert.deepEqual([...surface.pixels.slice(256, 264)], [7, 7, 7, 7, 0, 0, 0, 0]);
});
