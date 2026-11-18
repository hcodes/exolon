import type { GameEvent, FlyingEnemy, ScreenObject } from '../../src/types/game.ts';
import type { HapticActuator } from '../../src/input/haptics.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as hapticsModule from '../../src/input/haptics.ts';
import { createState, step } from '../../src/model/state.ts';
const screen = () => ({
    tiles: Array.from({ length: 768 }, (_, i) => (i >= 576 ? { collision: 1, block: 33 } : null)),
    objects: [],
    placements: [],
});
const hits = (events: GameEvent[]) =>
    events.filter((event) => event.type === 'hit').map((event) => event.weapon);

test('only real bullet collisions emit weak-hit events, not firing or boundary removal', () => {
    const state = createState(screen());
    state.enemies = [
        {
            x: 50,
            y: 112,
            sprite: 1,
            phase: 0,
            trajectory: [],
            trajectoryIndex: 0,
        } as unknown as FlyingEnemy,
    ];
    state.bullets = [{ x: 45, y: 120, dx: 1 }];
    assert.deepEqual(hits(step(state, {}).events), ['bullet']);
    assert.deepEqual(hits(step(createState(screen()), { fire: true }).events), []);
    const miss = createState(screen());
    miss.bullets = [{ x: 124, y: 120, dx: 1 }];
    assert.deepEqual(hits(step(miss, {}).events), []);
});

test('rocket scenery collisions emit one medium hit while boundary expiration stays silent', () => {
    const state = createState(screen());
    state.screen.tiles[14 * 32 + 11] = { collision: 1, block: 33 };
    state.grenade = { x: 40, y: 112, dx: 1, phase: 32 };
    assert.deepEqual(hits(step(state, {}).events), ['rocket']);
    const miss = createState(screen());
    miss.grenade = { x: 124, y: 64, dx: 1, phase: 32 };
    assert.deepEqual(hits(step(miss, {}).events), []);
});

test('haptics use different strengths, prioritize a rocket and stop on reset or device change', () => {
    let now = 0;
    const calls: ({ type: 'dual-rumble' } & Parameters<
        NonNullable<HapticActuator['playEffect']>
    >[1])[] = [];
    let stops = 0;
    const actuator = {
        effects: ['dual-rumble'],
        playEffect(
            type: 'dual-rumble',
            params: Parameters<NonNullable<HapticActuator['playEffect']>>[1],
        ) {
            calls.push({ type, ...params });
            return Promise.resolve('complete');
        },
        reset() {
            stops++;
            return Promise.resolve('complete');
        },
    };
    const h = hapticsModule.createGamepadHaptics(() => now);
    h.setGamepad({ index: 2, id: 'Active', connected: true, vibrationActuator: actuator });
    h.handle([{ type: 'shot' }]);
    assert.equal(calls.length, 0);
    h.handle([{ type: 'hit', weapon: 'bullet' }]);
    assert.equal(calls.length, 1);
    now = 1;
    h.handle([{ type: 'hit', weapon: 'bullet' }]);
    assert.equal(calls.length, 1);
    h.handle([{ type: 'hit', weapon: 'rocket' }]);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].weakMagnitude < calls[1].weakMagnitude);
    assert.ok(calls[0].strongMagnitude < calls[1].strongMagnitude);
    assert.ok(calls[0].duration < calls[1].duration);
    now = 2;
    h.handle([{ type: 'hit', weapon: 'bullet' }]);
    assert.equal(calls.length, 2);
    h.stop();
    assert.equal(stops, 1);
    now = 1000;
    h.handle([
        { type: 'hit', weapon: 'rocket' },
        { type: 'hit', weapon: 'bullet' },
    ]);
    assert.equal(calls.length, 3);
    h.setGamepad(null);
    assert.equal(stops, 2);
    h.handle([{ type: 'hit', weapon: 'rocket' }]);
    assert.equal(calls.length, 3);
});

test('legacy pulse and unsupported, throwing or rejected actuator methods never break input', async () => {
    const h = hapticsModule.createGamepadHaptics(() => 0),
        calls: number[][] = [];
    const pulse = {
        pulse(value: number, duration: number) {
            calls.push([value, duration]);
            return Promise.resolve(true);
        },
    };
    h.setGamepad({ id: 'Legacy', index: 0, connected: true, hapticActuators: [pulse] });
    h.handle([{ type: 'hit', weapon: 'bullet' }]);
    assert.equal(calls.length, 1);
    h.stop();
    assert.deepEqual(calls.at(-1), [0, 0]);
    for (const actuator of [
        {},
        {
            playEffect() {
                throw Error('unsupported');
            },
        },
        {
            playEffect() {
                return Promise.reject(Error('blocked'));
            },
            reset() {
                return Promise.reject(Error('blocked'));
            },
        },
    ]) {
        h.setGamepad({ id: 'Test', index: 1, connected: true, vibrationActuator: actuator });
        assert.doesNotThrow(() => h.handle([{ type: 'hit', weapon: 'rocket' }]));
        h.stop();
    }
    await new Promise((resolve) => setImmediate(resolve));
});

test('only the selected controller vibrates and background/disconnection resets the motor', async () => {
    const { createGamepadInput } = await import('../../src/input/gamepad.ts');
    let pulses = 0,
        stops = 0;
    const make = (index: number) => ({
        id: `Pad${index}`,
        index,
        connected: true,
        mapping: 'standard',
        axes: [0, 0],
        buttons: [],
        vibrationActuator: {
            playEffect() {
                pulses++;
                return Promise.resolve();
            },
            reset() {
                stops++;
                return Promise.resolve();
            },
        },
    });
    const first = make(0),
        second = make(1),
        devices = [first, second];
    second.vibrationActuator.playEffect = () => {
        throw Error('Inactive pad must not vibrate');
    };
    const input = createGamepadInput({ getGamepads: () => devices });
    input.poll();
    input.handleEvents([{ type: 'hit', weapon: 'rocket' }]);
    assert.equal(pulses, 1);
    input.poll(false);
    assert.equal(stops, 1);
    input.handleEvents([{ type: 'hit', weapon: 'rocket' }]);
    assert.equal(pulses, 1);
    input.poll();
    input.handleEvents([{ type: 'hit', weapon: 'bullet' }]);
    assert.equal(pulses, 2);
    first.connected = false;
    second.connected = false;
    input.poll();
    assert.equal(stops, 2);
    input.handleEvents([{ type: 'hit', weapon: 'rocket' }]);
    assert.equal(pulses, 2);
});

test('a bullet above or below a beam does not report a physical hit', () => {
    const state = createState(screen());
    state.objects = [{ type: 17, active: true, x: 15, y: 15, length: 6, hits: 0 } as ScreenObject];
    state.bullets = [{ x: 56, y: 40, dx: 1 }];
    assert.deepEqual(hits(step(state, {}).events), []);
});
