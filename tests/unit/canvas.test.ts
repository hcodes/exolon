import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasPoint } from '../../src/utils/canvas.ts';

test('menu hit testing excludes fullscreen letterboxing for 4:3 renderers', () => {
    const box = { left: 10, top: 20, width: 1000, height: 600 };
    const point = canvasPoint(box, 110 + 80, 20 + 300);
    assert.ok(point);
    assert.equal(point.x, 25.6);
    assert.equal(point.y, 96);
    assert.equal(canvasPoint({ ...box, width: 0 }, 10, 20), null);
});

test('Sharp menu hit testing uses its actual 320x200 image inside fullscreen bars', () => {
    const point = canvasPoint({ left: 0, top: 0, width: 1000, height: 600 }, 170, 384, {
        width: 320,
        height: 200,
    });
    assert.ok(point);
    assert.equal(point.x, 40);
    assert.equal(point.y, 122.88);
    assert.equal((point.x * 320) / 256 - 32, 18);
    assert.equal((point.y * 200) / 192 - 4, 124);
});
