import assert from 'node:assert/strict';
import test from 'node:test';
import { createTeleportMotion } from '../../src/view/teleport-motion.ts';
import { createState, step } from '../../src/model/state.ts';

import { modelState } from '../helpers/unit-model.ts';
import type { StateDetails } from '../helpers/unit-model.ts';
import type { GameEvent, GameState } from '../../src/types/game.ts';

const state = (tick: number, detail: StateDetails = {}) =>
    modelState({
        tick,
        screenIndex: 0,
        death: 0,
        status: 'playing',
        exoskeleton: false,
        player: { x: 77, y: 112, direction: 1 },
        ...detail,
    });
const pair = (): GameEvent[] => [
    { type: 'teleport', x: 40, y: 124 },
    { type: 'teleport-arrive', x: 162, y: 124 },
];
const begin = (motion: ReturnType<typeof createTeleportMotion>) => {
    motion.observe(state(0, { player: { x: 16, y: 112, direction: -1 }, exoskeleton: true }));
    const arrival = state(1);
    assert.equal(motion.observe(arrival, pair()), true);
    return arrival;
};
const screen = () => ({
    id: 0,
    placements: [],
    actions: [],
    objects: [
        { id: 0, type: 6, x: 5, y: 13, instance: 0 },
        { id: 1, type: 6, x: 20, y: 13, instance: 1 },
    ],
    tiles: Array.from({ length: 768 }, (_, index) =>
        index >= 576 ? { collision: 1, block: 33 } : null,
    ),
});

test('a real model teleport moves immediately while its departure remains fully visible', () => {
    const previous = createState(screen());
    previous.player.direction = -1;
    previous.exoskeleton = true;
    const motion = createTeleportMotion();
    assert.equal(motion.observe(previous), false);
    const result = step(previous, { jump: true });
    const unchanged = structuredClone(result);
    assert.deepEqual(
        result.events.map((event) => event.type),
        ['teleport', 'teleport-arrive'],
    );
    assert.equal(result.state.player.x, 77);
    assert.equal(motion.observe(result.state, result.events), true);
    assert.deepEqual(motion.sample(result.state), {
        departure: {
            x: previous.player.x * 2,
            y: previous.player.y,
            direction: -1,
            armored: true,
            opacity: 1,
        },
        arrivalOpacity: 0,
    });
    assert.deepEqual(result, unchanged);
});

test('fractional logical ticks fade out, meet at zero, then fade in without travel', () => {
    const motion = createTeleportMotion();
    begin(motion);
    let departure = 1,
        arrival = 0;
    for (let elapsed = 0; elapsed < 6; elapsed += 0.125) {
        const current = state(1 + Math.floor(elapsed));
        motion.observe(current);
        const pose = motion.sample(current, elapsed % 1);
        assert.deepEqual([pose!.departure.x, pose!.departure.y], [32, 112]);
        assert.ok(pose!.departure.opacity >= 0 && pose!.departure.opacity <= departure);
        assert.ok(pose!.arrivalOpacity >= arrival && pose!.arrivalOpacity <= 1);
        if (elapsed <= 3) assert.equal(pose!.arrivalOpacity, 0);
        if (elapsed >= 3) assert.equal(pose!.departure.opacity, 0);
        departure = pose!.departure.opacity;
        arrival = pose!.arrivalOpacity;
    }
    assert.equal(motion.sample(state(7)), null);
});

test('repeated renders cannot advance a paused fade or mutate its retained appearance', () => {
    const motion = createTeleportMotion();
    const current = begin(motion);
    const expected = motion.sample(current, 0.4);
    const changed = motion.sample(current, 0.4);
    changed!.departure.x = -500;
    for (let i = 0; i < 1000; i++) assert.deepEqual(motion.sample(current, 0.4), expected);
    assert.deepEqual(motion.sample(current, -1), motion.sample(current, 0));
    assert.deepEqual(motion.sample(current, NaN), motion.sample(current, 0));
    assert.deepEqual(motion.sample(current, 5), motion.sample(current, 1));
});

test('an event pair starts once and an arrival or departure alone cannot start a fade', () => {
    const motion = createTeleportMotion();
    const current = begin(motion);
    assert.equal(motion.observe({ ...current }, pair()), false);
    const before = motion.sample(current, 0.5);
    assert.equal(motion.observe(current, pair()), false);
    assert.deepEqual(motion.sample(current, 0.5), before);
    for (const event of pair()) {
        const unpaired = createTeleportMotion();
        assert.equal(unpaired.observe(current, [event]), false);
        assert.equal(unpaired.sample(current), null);
    }
});

test('a new paired teleport replaces the old fade and a replayed batch stays consumed', () => {
    const motion = createTeleportMotion();
    begin(motion);
    const reverse = pair().map((event) => ({ ...event, x: event.type === 'teleport' ? 162 : 40 }));
    const returned = state(2, { player: { x: 16, y: 112, direction: -1 } });
    assert.equal(motion.observe(returned, reverse), true);
    const pose = motion.sample(returned);
    assert.deepEqual(
        [pose!.departure.x, pose!.departure.y, pose!.departure.opacity],
        [154, 112, 1],
    );
    assert.equal(pose!.arrivalOpacity, 0);
    const next = { ...returned, tick: 3 };
    assert.equal(motion.observe(next, reverse), false);
    assert.ok(motion.sample(next)!.departure.opacity < 1);
});

test('source direction and suit come from the previous observed state when available', () => {
    const motion = createTeleportMotion();
    const current = begin(motion);
    assert.equal(motion.sample(current)!.departure.direction, -1);
    assert.equal(motion.sample(current)!.departure.armored, true);
    const withoutPrevious = createTeleportMotion();
    assert.equal(withoutPrevious.observe(current, pair()), true);
    assert.equal(withoutPrevious.sample(current)!.departure.direction, 1);
    assert.equal(withoutPrevious.sample(current)!.departure.armored, false);
});

test('held jump at the real arrival cannot restart the presentation before release', () => {
    const motion = createTeleportMotion();
    let current = createState(screen());
    motion.observe(current);
    let result = step(current, { jump: true });
    assert.equal(motion.observe(result.state, result.events), true);
    current = result.state;
    for (let i = 0; i < 9; i++) {
        result = step(current, { jump: true });
        assert.equal(motion.observe(result.state, result.events), false);
        current = result.state;
    }
    assert.equal(motion.sample(current), null);
    result = step(current, {});
    motion.observe(result.state, result.events);
    result = step(result.state, { jump: true });
    assert.equal(motion.observe(result.state, result.events), true);
    assert.equal(motion.sample(result.state)!.departure.x, 154);
});

test('death, respawn, screen changes, nonplaying status, rewind and reset remove ghosts', () => {
    // Lifecycle events deliberately omit coordinates; the motion reads only their type.
    const cases: [GameState, GameEvent[]][] = [
        [state(2, { death: 46 }), []],
        [state(2, { screenIndex: 1 }), []],
        [state(2, { status: 'over' }), []],
        [state(2, { status: 'bonus' }), []],
        [state(2, { status: 'won' }), []],
        [state(2), [{ type: 'respawn' } as GameEvent]],
        [state(2), [{ type: 'death' } as GameEvent]],
        [state(2), [{ type: 'screen' } as GameEvent]],
        [state(2), [{ type: 'game-over' } as GameEvent]],
        [state(0), []],
    ];
    for (const [current, events] of cases) {
        const motion = createTeleportMotion();
        begin(motion);
        assert.equal(motion.observe(current, events), false);
        assert.equal(motion.sample(current), null);
        assert.equal(motion.sample(state(3)), null);
    }
    const motion = createTeleportMotion();
    const current = begin(motion);
    motion.reset();
    assert.equal(motion.sample(current), null);
    begin(motion);
    assert.equal(motion.sample(state(0)), null);
    assert.equal(motion.observe(state(1), pair()), true);
    assert.equal(motion.sample(state(1))!.departure.opacity, 1);
});
