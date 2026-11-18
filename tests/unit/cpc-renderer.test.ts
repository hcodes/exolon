import assert from 'node:assert/strict';
import test from 'node:test';
import {
    decodeCpcMode0Byte,
    createCpcSurface,
    createCpcLoadingSurface,
    blitCpcBitmap,
} from '../../src/view/cpc-bitmap.ts';

test('CPC Mode1 loading screen crops margins, deinterleaves rows and retains four native inks', () => {
    const bitmap = new Uint8Array(16384);
    bitmap[8] = 0x53;
    bitmap[2048 + 80 + 8] = 255;
    bitmap[7 * 2048 + 23 * 80 + 71] = 255;
    const surface = createCpcLoadingSurface(bitmap);
    assert.deepEqual([...surface.pixels.slice(0, 4)], [0, 15, 5, 11]);
    assert.deepEqual([...surface.pixels.slice(9 * 256, 9 * 256 + 4)], [11, 11, 11, 11]);
    assert.deepEqual([...surface.pixels.slice(-4)], [11, 11, 11, 11]);
    const mask = { bits: new Uint8Array(256 * 192) };
    mask.bits[2] = 1;
    assert.deepEqual([...createCpcLoadingSurface(bitmap, mask).pixels.slice(0, 4)], [0, 0, 5, 0]);
});

test('CPC Mode0 bytes preserve all four bits of both wide pixels', () => {
    assert.deepEqual(decodeCpcMode0Byte(0xaa), [15, 0]);
    assert.deepEqual(decodeCpcMode0Byte(0x55), [0, 15]);
    assert.deepEqual(decodeCpcMode0Byte(0xf0), [5, 5]);
    assert.deepEqual(decodeCpcMode0Byte(0x0f), [10, 10]);
    for (let value = 0; value < 256; value++) {
        const [a, b] = decodeCpcMode0Byte(value);
        const packed =
            ((a & 1) << 7) |
            ((a & 2) << 2) |
            ((a & 4) << 3) |
            ((a & 8) >> 2) |
            ((b & 1) << 6) |
            ((b & 2) << 1) |
            ((b & 4) << 2) |
            ((b & 8) >> 3);
        assert.equal(packed, value);
    }
});

test('original CPC bitmap pixels scale horizontally and respect foreground clipping', () => {
    const surface = createCpcSurface();
    surface.pixels.fill(9);
    surface.allowed[0] = 0;
    blitCpcBitmap(surface, [0xaa, 0x55, 0xaa, 0x55], 16, 1, 0, 0);
    assert.deepEqual(
        [...surface.pixels.slice(0, 16)],
        [9, 9, 9, 9, 9, 9, 9, 9, 15, 15, 9, 9, 9, 9, 15, 15],
    );
    blitCpcBitmap(surface, [0xaa], 4, 1, -2, 1, { foreground: false, transparent: false });
    assert.deepEqual([...surface.pixels.slice(256, 260)], [0, 0, 9, 9]);
});
