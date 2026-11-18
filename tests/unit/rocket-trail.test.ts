import assert from 'node:assert/strict';
import test from 'node:test';
import { createRocketTrail, rocketNozzle } from '../../src/view/rocket-trail.ts';

test('exhaust starts at the nozzle immediately in either direction and on a rising arc', () => {
    assert.deepEqual(rocketNozzle({ x: 80, y: 60, angle: 0 }), { x: 79.4, y: 64 });
    const left = rocketNozzle({ x: 80, y: 60, angle: Math.PI });
    assert.equal(left.x, 88.6);
    assert.equal(left.y, 64);
    const up = rocketNozzle({ x: 80, y: 60, angle: -Math.PI / 2 });
    assert.equal(up.x, 84);
    assert.equal(up.y, 68.6);
    const trail = createRocketTrail();
    trail.observe(1, 0, [{ id: 'player:1', ...rocketNozzle({ x: 80, y: 60, angle: 0 }) }]);
    assert.equal(trail.sample(1, 0).length, 1);
    assert.ok(trail.sample(1, 0)[0].opacity > 0);
});

test('trail stays on the travelled path, interpolates births and does not depend on rendering frequency', () => {
    const trail = createRocketTrail();
    trail.observe(1, 0, [{ id: 'player:1', x: 40, y: 80 }]);
    trail.observe(2, 0, [{ id: 'player:1', x: 46, y: 76 }]);
    const early = trail.sample(2, 0),
        middle = trail.sample(2, 0.5),
        late = trail.sample(2, 1);
    assert.ok(early.every((point) => point.x <= 40));
    assert.ok(middle.every((point) => point.x <= 43));
    assert.ok(late.some((point) => point.x >= 44 && point.y <= 78));
    for (let i = 0; i < 100; i++) trail.sample(2, i / 100);
    trail.observe(2, 0, [{ id: 'player:1', x: 46, y: 76 }]);
    assert.deepEqual(trail.sample(2, 1), late);
});

test('spent exhaust fades after impact and resets at scene or clock discontinuities', () => {
    const trail = createRocketTrail();
    trail.observe(10, 0, [{ id: 'player:1', x: 40, y: 80 }]);
    const initial = trail.sample(10, 0)[0].opacity;
    trail.observe(11, 0, []);
    assert.ok(trail.sample(11, 0)[0].opacity < initial);
    for (let tick = 12; tick <= 20; tick++) trail.observe(tick, 0, []);
    assert.deepEqual(trail.sample(20, 1), []);
    trail.observe(21, 0, [{ id: 'player:2', x: 80, y: 90 }]);
    trail.observe(22, 1, []);
    assert.deepEqual(trail.sample(22, 1), []);
    trail.observe(23, 1, [{ id: 'player:3', x: 80, y: 90 }]);
    trail.observe(40, 1, []);
    assert.deepEqual(trail.sample(40, 1), []);
    trail.observe(41, 1, [{ id: 'player:4', x: 80, y: 90 }]);
    trail.reset();
    assert.deepEqual(trail.sample(41, 0), []);
});

test('independent rockets cannot be linked and long flights keep bounded visual history', () => {
    const trail = createRocketTrail();
    for (let tick = 1; tick < 400; tick++) {
        trail.observe(
            tick,
            0,
            Array.from({ length: 12 }, (_, index) => ({
                id: String(index),
                x: tick * 6,
                y: index * 10,
            })),
        );
        assert.ok(trail.sample(tick, 1).length <= 256);
    }
    trail.reset();
    trail.observe(1, 0, [{ id: 'old', x: 30, y: 60 }]);
    trail.observe(2, 0, [{ id: 'new', x: 36, y: 70 }]);
    assert.equal(
        trail.sample(2, 1).length,
        2,
        'new identities must not draw a connecting smoke segment',
    );
});
