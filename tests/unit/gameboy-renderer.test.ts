import assert from 'node:assert/strict';
import test from 'node:test';
import { GAMEBOY_PALETTE, toGameBoyRgba } from '../../src/view/gameboy-renderer.ts';

test('Game Boy styling uses four opaque shades and preserves nonblack sprite contrast', () => {
    const source = new Uint8ClampedArray(4 * 16 * 4);
    const colors = [
        [0, 0, 0],
        [0, 0, 205],
        [205, 0, 0],
        [0, 205, 0],
        [0, 205, 205],
        [205, 205, 0],
        [205, 0, 205],
        [255, 255, 255],
    ];
    for (let i = 0; i < source.length; i += 4)
        source.set([...colors[(i / 4) % colors.length], 255], i);
    const before = source.slice(),
        result = toGameBoyRgba(source, 16),
        allowed = new Set(GAMEBOY_PALETTE.map((color) => color.join(','))),
        used = new Set();
    for (let i = 0; i < source.length; i += 4) {
        const color = [...result.slice(i, i + 3)].join(',');
        used.add(color);
        assert.ok(allowed.has(color));
        assert.equal(result[i + 3], 255);
        const blank = source[i] + source[i + 1] + source[i + 2] === 0;
        assert.equal(
            color === GAMEBOY_PALETTE[0].join(','),
            blank,
            'Colored ink remains visible on dark space',
        );
    }
    assert.equal(used.size, 4);
    assert.deepEqual(source, before);
    assert.deepEqual(toGameBoyRgba(source, 16), result, 'Dithering cannot animate on its own');
});

test('Game Boy conversion supports a reused output buffer and rejects incomplete scanlines', () => {
    const source = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]),
        output = new Uint8ClampedArray(8);
    assert.equal(toGameBoyRgba(source, 2, output), output);
    assert.deepEqual([...output], [...GAMEBOY_PALETTE[3], 255, ...GAMEBOY_PALETTE[0], 255]);
    assert.throws(() => toGameBoyRgba(source, 3), RangeError);
});
