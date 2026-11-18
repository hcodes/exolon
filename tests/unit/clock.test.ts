import assert from 'node:assert/strict';
import test from 'node:test';
import { createClock } from '../../src/lib/clock.ts';

test('fixed clock advances the same ticks at 60, 120 and 144 Hz', () => {
    for (const hz of [60, 120, 144]) {
        let ticks = 0;
        const clock = createClock(() => ticks++, 1000 / 30);
        clock.resume();
        clock.frame(0);
        for (let frame = 1; frame <= hz * 3; frame++) clock.frame((frame * 1000) / hz);
        assert.equal(ticks, 90);
    }
});

test('pause and long stalls cannot advance hidden game time', () => {
    let ticks = 0;
    const clock = createClock(() => ticks++, 1000 / 30);
    clock.resume();
    clock.frame(0);
    clock.frame(1000 / 30);
    assert.equal(ticks, 1);
    assert.equal(clock.frame(3000), false);
    assert.equal(ticks, 1);
    clock.resume();
    clock.frame(4000);
    clock.frame(4000 + 1000 / 30);
    assert.equal(ticks, 2);
    clock.pause();
    clock.frame(9000);
    assert.equal(ticks, 2);
});

test('a deliberate stop inside a tick is not reported as a frame stall', () => {
    const clock = createClock(() => clock.pause(), 1000 / 30);
    clock.resume();
    clock.frame(0);
    assert.equal(clock.frame(1000 / 30), true);
});

test('slow TV frames keep running with one bounded step instead of pausing or catching up', () => {
    let ticks = 0;
    const clock = createClock(() => ticks++, 40, { pauseOnStall: false });
    clock.resume();
    clock.frame(0);
    clock.frame(20);
    for (const now of [320, 620, 920]) {
        assert.equal(clock.frame(now), true);
    }
    assert.equal(ticks, 3);
    assert.equal(clock.fraction, 0.5);
    clock.pause();
    assert.equal(clock.frame(4000), false);
    assert.equal(ticks, 3);
    clock.resume();
    clock.frame(5000);
    clock.frame(5020);
    assert.equal(ticks, 4);
    assert.equal(clock.frame(5010), false, 'A backwards clock must still stop');
});

test('presentation fraction freezes through pause and resumes without rewinding', () => {
    let ticks = 0;
    const clock = createClock(() => ticks++, 1000 / 30);
    clock.resume();
    clock.frame(0);
    clock.frame(50);
    assert.equal(ticks, 1);
    assert.ok(Math.abs(clock.fraction - 0.5) < 1e-8);
    clock.pause();
    clock.frame(5000);
    assert.ok(Math.abs(clock.fraction - 0.5) < 1e-8);
    clock.resume();
    clock.frame(6000);
    assert.ok(Math.abs(clock.fraction - 0.5) < 1e-8);
    clock.frame(6000 + 1000 / 60);
    assert.equal(ticks, 2);
    assert.ok(clock.fraction < 1e-8);
    clock.reset();
    assert.equal(clock.fraction, 0);
});

test('changing platform cadence retains progress and cannot apply elapsed old-platform time to a new rate', () => {
    let ticks = 0;
    const clock = createClock(() => ticks++, 40);
    clock.resume();
    clock.frame(0);
    clock.frame(20);
    clock.setInterval(52);
    assert.equal(clock.fraction, 0.5);
    clock.frame(1000);
    assert.equal(ticks, 0);
    clock.frame(1025.9);
    assert.equal(ticks, 0);
    clock.frame(1026);
    assert.equal(ticks, 1);
    clock.pause();
    clock.setInterval(45);
    clock.frame(5000);
    assert.equal(ticks, 1);
    clock.resume();
    clock.frame(6000);
    clock.frame(6045);
    assert.equal(ticks, 2);
});

test('reapplying the same graphics cadence does not discard time or create an extra tick', () => {
    let ticks = 0;
    const clock = createClock(() => ticks++, 45);
    clock.resume();
    clock.frame(0);
    clock.frame(20);
    clock.setInterval(45);
    clock.frame(45);
    assert.equal(ticks, 1);
    assert.equal(clock.fraction, 0);
    for (const invalid of [0, -1, NaN, Infinity])
        assert.throws(() => clock.setInterval(invalid), RangeError);
});
