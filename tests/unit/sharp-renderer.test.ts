import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodePng } from '../../tools/graphics/png.mjs';
import {
    createScreen,
    copyScreen,
    putTile,
    xorSprite,
    paintAttribute,
    putText,
} from '../../src/view/spectrum.ts';
import { SHARP_PALETTE, SHARP_INK_MAP, toSharpRgba } from '../../src/view/sharp-renderer.ts';

test('Sharp preserves native 16-color inks and the original Datelsoft programmable palette', () => {
    assert.equal(SHARP_PALETTE.length, 16);
    assert.deepEqual(SHARP_INK_MAP.slice(0, 4), [0, 9, 10, 11]);
    const screen = createScreen();
    screen.bits.fill(1);
    for (let ink = 0; ink < 16; ink++) screen.attributes[ink] = (ink & 7) | (ink & 8 ? 64 : 0);
    const result = toSharpRgba(screen);
    assert.equal(result.length, 320 * 200 * 4);
    for (let ink = 0; ink < 16; ink++) {
        const at = (4 * 320 + 32 + ink * 8) * 4;
        assert.deepEqual(Array.from(result.slice(at, at + 4)), [
            ...SHARP_PALETTE[SHARP_INK_MAP[ink]],
            255,
        ]);
    }
    for (const [x, y] of [
        [0, 0],
        [319, 199],
        [31, 4],
        [288, 195],
    ]) {
        const at = (y * 320 + x) * 4;
        assert.deepEqual(Array.from(result.slice(at, at + 4)), [0, 0, 0, 255]);
    }
    assert.deepEqual(SHARP_PALETTE[12], [84, 255, 84]);
    assert.deepEqual(SHARP_PALETTE[13], [128, 255, 255]);
    assert.deepEqual(SHARP_PALETTE[14], [255, 255, 40]);
});
test('Sharp retains bright black foreground as grey and black paper as black', () => {
    const screen = createScreen();
    screen.attributes[0] = 64;
    screen.bits[0] = 1;
    const result = toSharpRgba(screen),
        at = (4 * 320 + 32) * 4;
    assert.deepEqual(Array.from(result.slice(at, at + 3)), [132, 132, 132]);
    assert.deepEqual(Array.from(result.slice(at + 4, at + 7)), [0, 0, 0]);
});
test('Sharp conversion rejects incomplete or wrongly sized rasters', () => {
    assert.throws(() => toSharpRgba({ ...createScreen(), bits: new Uint8Array(4) }), RangeError);
    assert.throws(() => toSharpRgba(createScreen(), false, new Uint8ClampedArray(4)), RangeError);
});

test('Sharp menu foreground matches all pixels of the original Datelsoft archive capture', async () => {
    const graphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/sharp-mz800/graphics.json', import.meta.url),
            'utf8',
        ),
    ) as { screens: { menu: { x: number; y: number; bitmap: number[]; color: number }[] } };
    const screen = createScreen();
    for (const tile of graphics.screens.menu)
        putTile(screen, {
            ...tile,
            color: tile.y === 17 && tile.color === 0x45 ? 0x47 : tile.color,
        });
    const actual = toSharpRgba(screen),
        reference = decodePng(
            await readFile(
                new URL(
                    '../../originals/images/sharp-mz800/reference/datelsoft-menu.png',
                    import.meta.url,
                ),
            ),
        );
    let checked = 0;
    for (let y = 0; y < 200; y++)
        for (let x = 0; x < 320; x++) {
            const i = (y * 320 + x) * 4;
            if (!(actual[i] || actual[i + 1] || actual[i + 2])) continue;
            const at = ((y * 2 + 28) * reference.width + x * 2 + 42) * 4;
            assert.deepEqual(
                Array.from(actual.slice(i, i + 3)),
                Array.from(reference.rgba.slice(at, at + 3)),
                `native menu pixel ${x},${y}`,
            );
            checked++;
        }
    assert.equal(checked, 4617);
});

test('Sharp sprites XOR four pixel planes without recoloring an 8x8 background cell', () => {
    const background = createScreen();
    putTile(background, { x: 0, y: 0, bitmap: [0xf0, 0, 0, 0, 0, 0, 0, 0], color: 0x54 });
    const screen = copyScreen(background, { nativePixels: true });
    assert.ok(screen.nativePixels);
    const before = screen.nativePixels.slice();
    xorSprite(screen, [0x3c], 8, 1, 0, 0, 0x47);
    // Source WF=$2f toggles all four planes: green12 ^ white15 = ink3.
    assert.deepEqual(Array.from(screen.nativePixels.slice(0, 8)), [12, 12, 3, 3, 15, 15, 0, 0]);
    assert.equal(new Set(screen.nativePixels.slice(0, 8)).size, 4);
    assert.equal(screen.attributes[0], 0x54);
    assert.equal(background.nativePixels, undefined);
    assert.deepEqual(Array.from(screen.nativePixels.slice(8)), Array.from(before.slice(8)));
    xorSprite(screen, [0x3c], 8, 1, 0, 0, 0x47);
    assert.deepEqual(screen.nativePixels, before, 'XOR erase restores the original native colors');
    paintAttribute(screen, 0, 0, 8, 8, 0x42);
    assert.deepEqual(screen.nativePixels, before, 'ZX attribute painting cannot recolor Sharp');
});

test('Sharp tile backgrounds and FLASH do not impose Spectrum PAPER/INK cells', () => {
    const screen = createScreen();
    putTile(screen, { x: 0, y: 0, bitmap: [128, 0, 0, 0, 0, 0, 0, 0], color: 0xd4 });
    const off = toSharpRgba(screen),
        on = toSharpRgba(screen, true),
        at = (4 * 320 + 32) * 4;
    assert.deepEqual(on, off, 'Sharp GDG does not have hardware FLASH attributes');
    assert.deepEqual(Array.from(off.slice(at, at + 8)), [...SHARP_PALETTE[12], 255, 0, 0, 0, 255]);
});

test('Sharp native pixels retain source foreground masks, shifted ink7, text and independent copies', () => {
    const screen = copyScreen(createScreen(), { nativePixels: true });
    assert.ok(screen.nativePixels);
    putTile(screen, { x: 1, y: 0, bitmap: Array(8).fill(255), color: 0x42, overlay: 0 });
    xorSprite(screen, [255, 255], 16, 1, 0, 0, 0x47);
    assert.deepEqual(Array.from(screen.nativePixels.slice(0, 16)), [
        ...Array(8).fill(15),
        ...Array(8).fill(10),
    ]);
    xorSprite(screen, [128], 8, 1, 20, 8, 0x07);
    assert.equal(screen.nativePixels[8 * 256 + 20], 7, 'Source WF=$27 uses three low planes');
    const font = Array(59 * 8).fill(0);
    font[(65 - 32) * 8] = 128;
    putText(screen, font, 'A', 3, 2, 0x46);
    assert.equal(screen.nativePixels[16 * 256 + 24], 14);
    const copy = copyScreen(screen);
    assert.ok(copy.nativePixels);
    copy.nativePixels[0] = 0;
    assert.equal(screen.nativePixels[0], 15);
});
