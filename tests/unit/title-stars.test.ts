import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Graphics } from '../../src/types/graphics.ts';
import * as stars from '../../src/view/title-stars.ts';
import { createScreen, copyScreen, fromScr, toRgba } from '../../src/view/spectrum.ts';
const graphics: Graphics = JSON.parse(
    await readFile(
        new URL('../../src/assets/graphics/zx-spectrum/graphics.json', import.meta.url),
        'utf8',
    ),
);

test('stars follow original discrete frames, disappear and move to another position', () => {
    const first = stars.getTitleStars(100).find((star) => star.id === 0);
    assert.equal(first!.frame, 12);
    const frames = Array.from(
        { length: 17 },
        (_, i) => stars.getTitleStars(i * 100).find((star) => star.id === 0)?.frame || 0,
    );
    assert.deepEqual(frames, [0, 12, 12, 14, 13, 14, 14, 15, 15, 15, 14, 14, 13, 13, 12, 12, 0]);
    const next = stars.getTitleStars(1800).find((star) => star.id === 0);
    assert.notDeepEqual([next!.x, next!.y], [first!.x, first!.y]);
    assert.equal(
        stars.getTitleStars(1700).some((star) => star.id === 0),
        false,
    );
});

test('source-aligned placements stay clear of original artwork and support the full title height', () => {
    const base = fromScr(graphics.loading),
        positions = stars.findTitleStarPositions(base);
    assert.ok(positions.length > 10);
    for (const { x, y } of positions) {
        assert.equal(x % 16, 0);
        assert.equal(y % 8, 0);
        assert.ok(x <= 240 && y <= 168);
        for (let row = 0; row < 16; row++)
            for (let bit = 0; bit < 16; bit++)
                assert.equal(base.bits[(y + row) * 256 + x + bit], 0);
    }
    const occupied = createScreen();
    occupied.bits.fill(1);
    assert.deepEqual(stars.findTitleStarPositions(occupied), []);
});

test('rendered flares use exact original white sprite pixels without changing the SCR', () => {
    const base = fromScr(graphics.loading),
        original = toRgba(base),
        screen = copyScreen(base);
    const position = stars.findTitleStarPositions(base).find((point) => point.y === 168);
    assert.ok(position);
    const { x: left, y: top } = position;
    stars.drawTitleStars(screen, 100, [position], graphics.small);
    const bitmap = graphics.small.slice(12 * 32, 13 * 32),
        output = toRgba(screen);
    for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
            const expected = (bitmap[y * 2 + (x >> 3)] >> (7 - (x & 7))) & 1;
            assert.equal(
                screen.bits[(top + y) * 256 + left + x],
                base.bits[(top + y) * 256 + left + x] ^ expected,
            );
            if (expected)
                assert.deepEqual(
                    Array.from(
                        output.slice(
                            ((top + y) * 256 + left + x) * 4,
                            ((top + y) * 256 + left + x) * 4 + 4,
                        ),
                    ),
                    [255, 255, 255, 255],
                );
        }
    assert.deepEqual(toRgba(base), original);
});

test('clock sampling is deterministic and at most twelve stars are active', () => {
    const expected = stars.getTitleStars(4321);
    for (let time = 0; time < 10000; time += 17) assert.ok(stars.getTitleStars(time).length <= 12);
    assert.deepEqual(stars.getTitleStars(4321), expected);
    for (const time of [0, -1, NaN, Infinity, undefined])
        assert.deepEqual(stars.getTitleStars(time), []);
});

test('the menu backdrop removes baked stars while retaining planet dithering, the logo and credits', () => {
    const source = fromScr(graphics.loading),
        original = source.bits.slice();
    const clean = stars.createTitleBackground(source, graphics.screens.logo);
    for (const [x, y] of [
        [36, 0],
        [68, 4],
        [108, 8],
        [127, 24],
        [70, 80],
        [165, 81],
        [58, 145],
    ]) {
        assert.equal(source.bits[y * 256 + x], 1, `fixture ${x},${y} is a baked star`);
        assert.equal(clean.bits[y * 256 + x], 0, `baked star ${x},${y} is gone`);
    }
    for (const [x, y, width, height] of [
        [0, 0, 24, 24],
        [208, 0, 32, 32],
        [72, 8, 32, 32],
        [157, 40, 24, 24],
        [136, 160, 32, 32],
        [0, 184, 256, 8],
    ]) {
        for (let yy = y; yy < y + height; yy++)
            for (let xx = x; xx < x + width; xx++)
                assert.equal(clean.bits[yy * 256 + xx], original[yy * 256 + xx]);
    }
    for (const tile of graphics.screens.logo)
        for (let row = 0; row < 8; row++)
            for (let bit = 0; bit < 8; bit++) {
                if ((tile.bitmap[row] >> (7 - bit)) & 1)
                    assert.equal(
                        clean.bits[((tile.y + 10) * 8 + row) * 256 + (tile.x + 8) * 8 + bit],
                        1,
                    );
            }
    assert.deepEqual(source.bits, original);
    assert.deepEqual(clean.attributes, source.attributes);
});
