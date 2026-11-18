import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createScreen,
    putTile,
    freezeBackground,
    xorSprite,
    toRgba,
    fromScr,
    putText,
} from '../../src/view/spectrum.ts';

test('Spectrum ink/paper, BRIGHT and FLASH retain exact colour indices without smoothing', () => {
    const screen = createScreen();
    putTile(screen, { x: 0, y: 0, bitmap: [128, 0, 0, 0, 0, 0, 0, 0], color: 0x56 });
    const rgb = toRgba(screen);
    assert.deepEqual(Array.from(rgb.slice(0, 8)), [255, 255, 0, 255, 255, 0, 0, 255]);
    screen.attributes[0] = 0x96;
    assert.deepEqual(Array.from(toRgba(screen, true).slice(0, 4)), [205, 0, 0, 255]);
    assert.deepEqual(Array.from(toRgba(screen).slice(0, 4)), [205, 205, 0, 255]);
});

test('sprites XOR the bitmap and preserve scenery attributes and source foreground masks', () => {
    const screen = createScreen();
    putTile(screen, { x: 0, y: 0, bitmap: Array(8).fill(255), color: 0x42, overlay: 255 });
    putTile(screen, { x: 1, y: 0, bitmap: Array(8).fill(255), color: 0x44, overlay: 0 });
    freezeBackground(screen);
    xorSprite(screen, Array(16).fill(255), 16, 8, 0, 0, 0x47);
    assert.equal(screen.bits[0], 0);
    assert.equal(screen.bits[8], 1);
    assert.equal(screen.attributes[0], 0x42);
    assert.equal(screen.attributes[1], 0x44);
    xorSprite(screen, Array(16).fill(255), 16, 8, 0, 0, 0x47);
    assert.equal(screen.bits[0], 1);
    xorSprite(screen, [128], 8, 1, 17, 8, 0x45);
    assert.equal(screen.attributes[34], 0x45);
    assert.equal(screen.attributes[35], 0x45);
});

test('mirroring reverses a full 24-pixel source sprite and clips below the playfield', () => {
    const screen = createScreen();
    freezeBackground(screen);
    xorSprite(screen, [128, 0, 0], 24, 1, 10, 175, 0x47, { mirror: true });
    assert.equal(screen.bits[175 * 256 + 33], 1);
    assert.equal(screen.bits[175 * 256 + 10], 0);
    xorSprite(screen, [255, 255, 255], 24, 1, 0, 176, 0x47);
    assert.equal(screen.bits[176 * 256], 0);
});

test('Spectrum screen RAM interleaving and original glyph bytes decode without invented pixels', () => {
    const scr = new Uint8Array(6912);
    scr[0] = 128;
    scr[256] = 64;
    scr[32] = 32;
    scr[6144] = 0x47;
    const screen = fromScr(scr);
    assert.equal(screen.bits[0], 1);
    assert.equal(screen.bits[256 + 1], 1);
    assert.equal(screen.bits[8 * 256 + 2], 1);
    const font = Array(59 * 8).fill(0);
    font[(65 - 32) * 8] = 128;
    putText(screen, font, 'A', 4, 4, 0x43);
    assert.equal(screen.bits[32 * 256 + 32], 1);
    assert.equal(screen.attributes[4 * 32 + 4], 0x43);
});
