import assert from 'node:assert/strict';
import test from 'node:test';
import {
    GAMEBOY_COLOR_PALETTES,
    toGameBoyColorRgba,
} from '../../src/view/gameboy-color-renderer.ts';
import { toGameBoyRgba } from '../../src/view/gameboy-renderer.ts';
import {
    createScreen,
    copyScreen,
    putTile,
    freezeBackground,
    xorSprite,
    toRgba,
    putText,
} from '../../src/view/spectrum.ts';

test('Game Boy Color sprites retain their own ink across colored cells without XOR holes or background bleed', () => {
    const background = createScreen();
    putTile(background, { x: 0, y: 0, bitmap: Array(8).fill(255), color: 0x42, overlay: 255 });
    putTile(background, { x: 1, y: 0, bitmap: Array(8).fill(255), color: 0x44, overlay: 255 });
    putTile(background, { x: 2, y: 0, bitmap: Array(8).fill(255), color: 0x41, overlay: 0 });
    freezeBackground(background);
    const source = toRgba(background),
        screen = copyScreen(background, { independentSprites: true });
    xorSprite(screen, [0xa0, 0x80], 8, 2, 7, 0, 0x47);
    xorSprite(screen, [0xff], 8, 1, 16, 0, 0x47);
    const pixels = toRgba(screen);
    for (const x of [7, 9])
        assert.deepEqual([...pixels.slice(x * 4, x * 4 + 4)], [255, 255, 255, 255]);
    for (const x of [0, 6, 8, 10, 15, 16, 23])
        assert.deepEqual(pixels.slice(x * 4, x * 4 + 4), source.slice(x * 4, x * 4 + 4));
    assert.deepEqual(toRgba(background), source);
    const styled = toGameBoyColorRgba(pixels, 256),
        white = toGameBoyColorRgba(new Uint8ClampedArray(256 * 192 * 4).fill(255), 256);
    assert.deepEqual(styled.slice(7 * 4, 7 * 4 + 4), white.slice(7 * 4, 7 * 4 + 4));
    xorSprite(screen, [0x80], 8, 1, 7, 0, 0x43);
    assert.deepEqual([...toRgba(screen).slice(7 * 4, 7 * 4 + 4)], [255, 0, 255, 255]);
    const font = Array(59 * 8).fill(0);
    font[(65 - 32) * 8] = 0x80;
    putText(screen, font, 'A', 0, 0, 0x46);
    assert.deepEqual([...toRgba(screen).slice(7 * 4, 7 * 4 + 4)], [0, 0, 0, 255]);
});

test('Game Boy Color retains separate hue families and handheld shade contrast', () => {
    const source = new Uint8ClampedArray(8 * 8 * 4),
        base = [
            [0, 0, 0],
            [205, 0, 0],
            [0, 205, 0],
            [205, 205, 0],
            [0, 0, 205],
            [205, 0, 205],
            [0, 205, 205],
            [255, 255, 255],
        ];
    for (let pixel = 0; pixel < 64; pixel++)
        source.set([...base[(pixel + Math.floor(pixel / 16)) % 8], 255], pixel * 4);
    const before = source.slice(),
        styled = toGameBoyColorRgba(source, 8),
        mono = toGameBoyRgba(source, 8),
        colors = new Set();
    const allowed = new Set(GAMEBOY_COLOR_PALETTES.flat().map((color) => color.join(',')));
    for (let i = 0; i < styled.length; i += 4) {
        const rgb = [...styled.slice(i, i + 3)].join(',');
        colors.add(rgb);
        assert.ok(allowed.has(rgb));
        assert.equal(styled[i + 3], 255);
        if (source[i] + source[i + 1] + source[i + 2] === 0)
            assert.equal(rgb, GAMEBOY_COLOR_PALETTES[0][0].join(','));
        else assert.notEqual(rgb, GAMEBOY_COLOR_PALETTES[0][0].join(','));
    }
    assert.ok(colors.size >= 12, `Expected multiple palettes, got ${colors.size} colors`);
    assert.notDeepEqual(styled, mono);
    assert.deepEqual(source, before);
    assert.deepEqual(toGameBoyColorRgba(source, 8), styled);
    for (const palette of GAMEBOY_COLOR_PALETTES)
        for (const color of palette)
            for (const channel of color)
                assert.ok(
                    Array.from({ length: 32 }, (_, n) => Math.round((n * 255) / 31)).includes(
                        channel,
                    ),
                );
});

test('Game Boy Color supports buffer reuse and safe in-place conversion', () => {
    const source = new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255,
    ]);
    const expected = toGameBoyColorRgba(source, 4),
        inPlace = source.slice(),
        output = new Uint8ClampedArray(source.length);
    assert.equal(toGameBoyColorRgba(source, 4, output), output);
    assert.deepEqual(output, expected);
    assert.equal(toGameBoyColorRgba(inPlace, 4, inPlace), inPlace);
    assert.deepEqual(inPlace, expected);
    assert.throws(() => toGameBoyColorRgba(source, 3), RangeError);
});
