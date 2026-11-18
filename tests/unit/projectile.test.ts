import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectileMotion } from '../../src/view/projectile-motion.ts';

import { modelState } from '../helpers/unit-model.ts';
import type { StateDetails } from '../helpers/unit-model.ts';
import type { GameEvent, Grenade, Rocket } from '../../src/types/game.ts';

const grenade = (x: number, y: number, phase: number, projectileId = 1, dx = 1) => ({
    x,
    y,
    phase,
    projectileId,
    dx,
});
const rocket = (
    x: number,
    y: number,
    projectileId: number,
    detail: Partial<Rocket> = {},
): Rocket => ({ x, y, dx: -2, kind: 'launcher', projectileId, ...detail });
const state = (
    tick: number,
    g: Grenade | null = null,
    rockets: Rocket[] = [],
    detail: StateDetails = {},
) =>
    modelState({
        tick,
        screenIndex: 0,
        death: 0,
        player: { x: 16, y: 112, duck: false },
        grenade: g,
        rockets,
        ...detail,
    });
const close = (actual: number, expected: number, message?: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-8, message || `${actual} should equal ${expected}`);

test('projectile sampling hits source endpoints and interpolates the complete launch segment', () => {
    const motion = createProjectileMotion();
    const first = state(1, grenade(21, 108, 31));
    motion.observe(first, [{ type: 'grenade', x: 32, y: 112 }]);
    const second = state(2, grenade(22, 104, 30));
    motion.observe(second);
    const start = motion.sample(second, 0).grenade;
    const middle = motion.sample(second, 0.5).grenade;
    const end = motion.sample(second, 1).grenade;
    assert.deepEqual([start!.x, start!.y], [42, 108]);
    assert.deepEqual([middle!.x, middle!.y], [43, 106]);
    assert.deepEqual([end!.x, end!.y], [44, 104]);
    close(middle!.angle, Math.atan2(-4, 2));
    assert.deepEqual([middle!.dx, middle!.dy], [2, -4]);
    assert.deepEqual(second.grenade, grenade(22, 104, 30));
});

test('a new launch uses its measured source movement for orientation immediately', () => {
    for (const [dx, x, angle] of [
        [1, 21, Math.atan2(-4, 2)],
        [-1, 19, Math.atan2(-4, -2)],
    ]) {
        const motion = createProjectileMotion();
        const first = state(15, grenade(x, 108, 31, 1, dx));
        motion.observe(first, [{ type: 'grenade', x: 32, y: 112 }]);
        for (const fraction of [0, 0.25, 0.5, 1]) {
            const pose = motion.sample(first, fraction).grenade;
            assert.deepEqual([pose!.x, pose!.y], [x * 2, 108]);
            close(pose!.angle, angle);
        }
    }
});

test('changing source arc segments keeps a continuous tangent and source endpoint', () => {
    const motion = createProjectileMotion();
    const first = state(1, grenade(21, 108, 31));
    motion.observe(first, [{ type: 'grenade', x: 32, y: 112 }]);
    const second = state(2, grenade(22, 104, 30));
    motion.observe(second);
    const before = motion.sample(second, 1).grenade;
    const third = state(3, grenade(23, 102, 29));
    motion.observe(third);
    const after = motion.sample(third, 0).grenade;
    assert.deepEqual(
        [after!.x, after!.y, after!.dx, after!.dy],
        [before!.x, before!.y, before!.dx, before!.dy],
    );
    close(after!.angle, before!.angle);
    const middle = motion.sample(third, 0.5).grenade;
    close(middle!.x, 45);
    close(middle!.y, 102.75);
    close(middle!.dy, -1.5);
    close(middle!.angle, Math.atan2(middle!.dy, middle!.dx));
    assert.deepEqual(
        [motion.sample(third, 1).grenade!.x, motion.sample(third, 1).grenade!.y],
        [46, 102],
    );
});

test('source acceleration is displayed continuously without changing its three-substep endpoint', () => {
    const motion = createProjectileMotion();
    motion.observe(state(12, grenade(32, 94, 20)));
    const single = state(13, grenade(33, 94, 19));
    motion.observe(single);
    const before = motion.sample(single, 1).grenade;
    const triple = state(14, grenade(36, 94, 16));
    motion.observe(triple);
    const after = motion.sample(triple, 0).grenade;
    assert.deepEqual(
        [after!.x, after!.y, after!.dx, after!.dy],
        [before!.x, before!.y, before!.dx, before!.dy],
    );
    assert.deepEqual(
        [motion.sample(triple, 1).grenade!.x, motion.sample(triple, 1).grenade!.y],
        [72, 94],
    );
    const positions = [0, 0.25, 0.5, 0.75, 1].map(
        (fraction) => motion.sample(triple, fraction).grenade!.x,
    );
    assert.ok(positions.every((x, index) => !index || x > positions[index - 1]));
});

test('stored phase one does not tilt the rocket downward before the source actually descends', () => {
    const motion = createProjectileMotion();
    motion.observe(state(1, grenade(30, 80, 4)));
    const horizontal = state(2, grenade(33, 80, 1));
    motion.observe(horizontal);
    for (const fraction of [0, 0.5, 1])
        close(motion.sample(horizontal, fraction).grenade!.angle, 0);
    const descending = state(3, grenade(36, 83, 1));
    motion.observe(descending);
    close(motion.sample(descending, 0).grenade!.angle, 0);
    close(motion.sample(descending, 1).grenade!.angle, Math.atan2(3, 6));
});

test('projectile poses depend on logical snapshots and fraction rather than render frequency', () => {
    const sparse = createProjectileMotion();
    const frequent = createProjectileMotion();
    const frames = [
        state(1, grenade(21, 108, 31)),
        state(2, grenade(22, 104, 30)),
        state(3, grenade(23, 102, 29)),
        state(4, grenade(24, 100, 28)),
    ];
    for (const [index, frame] of frames.entries()) {
        const events: GameEvent[] = index ? [] : [{ type: 'grenade', x: 32, y: 112 }];
        sparse.observe(frame, events);
        frequent.observe(frame, events);
        for (const fraction of [0, 0.2, 0.4, 0.6, 0.8]) frequent.sample(frame, fraction);
    }
    assert.deepEqual(sparse.sample(frames.at(-1)!, 0.45), frequent.sample(frames.at(-1)!, 0.45));
});

test('disappearing projectiles and a replacement launch never use the old trajectory', () => {
    const motion = createProjectileMotion();
    motion.observe(state(1, grenade(21, 108, 31)));
    const moving = state(2, grenade(22, 104, 30));
    motion.observe(moving);
    const empty = state(3);
    motion.observe(empty);
    assert.equal(motion.sample(empty, 0.5).grenade, null);
    const relaunched = state(4, grenade(21, 108, 31, 2));
    motion.observe(relaunched, [{ type: 'grenade', x: 32, y: 112 }]);
    assert.deepEqual(
        [motion.sample(relaunched, 0.5).grenade!.x, motion.sample(relaunched, 0.5).grenade!.y],
        [42, 108],
    );
});

test('same-tick projectile replacement and hostile array compaction preserve lifecycle identity', () => {
    const motion = createProjectileMotion();
    motion.observe(state(1, null, [rocket(50, 30, 1), rocket(70, 40, 2)]));
    const next = state(2, null, [rocket(68, 40, 2), rocket(50, 30, 3)]);
    motion.observe(next);
    const poses = motion.sample(next, 0.5).rockets;
    assert.deepEqual(
        poses.map((pose) => [pose.x, pose.y]),
        [
            [138, 40],
            [100, 30],
        ],
    );
    close(poses[0].angle, Math.PI);
    const replaced = state(2, grenade(80, 50, 31, 4), [rocket(50, 30, 5)]);
    motion.observe(replaced);
    assert.deepEqual(
        motion.sample(replaced, 0.5).rockets.map((pose) => [pose.x, pose.y]),
        [[100, 30]],
    );
});

test('homing rocket rotation follows observed diagonal movement', () => {
    const motion = createProjectileMotion();
    motion.observe(state(1, null, [rocket(80, 50, 1, { kind: 'homing', dx: -1 })]));
    const next = state(2, null, [rocket(79, 51, 1, { kind: 'homing', dx: -1 })]);
    motion.observe(next);
    const pose = motion.sample(next, 0.5).rockets[0];
    close(pose.x, 159);
    close(pose.y, 50.5);
    close(pose.angle, Math.atan2(1, -2));
});

test('retained left-facing grenades keep their orientation through stationary death and bonus ticks', () => {
    for (const mode of ['death', 'bonus']) {
        const motion = createProjectileMotion();
        motion.observe(state(1, grenade(30, 80, 20, 1, -1), [], { status: 'playing' }));
        for (const tick of [2, 3, 4]) {
            const detail: StateDetails =
                mode === 'death' ? { status: 'playing', death: 48 - tick } : { status: 'bonus' };
            const frozen = state(tick, grenade(30, 80, 20, 1, -1), [], detail);
            motion.observe(frozen);
            for (const fraction of [0, 0.5, 1]) {
                const pose = motion.sample(frozen, fraction).grenade;
                assert.deepEqual([pose!.x, pose!.y], [60, 80]);
                close(pose!.angle, Math.PI);
            }
        }
    }
});

test('death freezes a retained grenade at its source position and preserves its measured diagonal tangent', () => {
    const motion = createProjectileMotion();
    motion.observe(state(1, grenade(19, 108, 31, 1, -1)), [{ type: 'grenade', x: 32, y: 112 }]);
    motion.observe(state(2, grenade(18, 104, 30, 1, -1)));
    for (const tick of [3, 4]) {
        const frozen = state(tick, grenade(18, 104, 30, 1, -1), [], { death: 49 - tick });
        // A death notification needs only its type at this presentation boundary.
        motion.observe(frozen, tick === 3 ? [{ type: 'death' } as GameEvent] : []);
        for (const fraction of [0, 0.5, 1]) {
            const pose = motion.sample(frozen, fraction).grenade;
            assert.deepEqual([pose!.x, pose!.y], [36, 104]);
            close(pose!.angle, Math.atan2(-4, -2));
        }
    }
    const newScreen = state(5, grenade(18, 104, 30, 1, -1), [], { screenIndex: 1 });
    motion.observe(newScreen);
    close(motion.sample(newScreen, 0.5).grenade!.angle, Math.PI);
});

test('screen changes, teleports, death and restarted ticks discard stale interpolation', () => {
    for (const detail of [
        { screenIndex: 1 },
        { death: 46 },
        { player: { x: 80, y: 112, duck: false } },
        { tick: 0 },
    ]) {
        const motion = createProjectileMotion();
        motion.observe(state(1, grenade(21, 108, 31)));
        const moving = state(2, grenade(22, 104, 30));
        motion.observe(moving);
        const discontinuity = state(3, grenade(23, 102, 29), [], detail);
        motion.observe(discontinuity);
        assert.deepEqual(
            [
                motion.sample(discontinuity, 0.5).grenade!.x,
                motion.sample(discontinuity, 0.5).grenade!.y,
            ],
            [46, 102],
        );
    }
    const motion = createProjectileMotion();
    motion.observe(state(1, grenade(21, 108, 31)));
    motion.reset();
    const fresh = state(0, grenade(50, 60, 20));
    motion.observe(fresh);
    assert.deepEqual(
        [motion.sample(fresh, 0.5).grenade!.x, motion.sample(fresh, 0.5).grenade!.y],
        [100, 60],
    );
});

test('untagged projectiles are rendered safely without matching array positions', () => {
    const motion = createProjectileMotion();
    motion.observe(state(1, null, [{ x: 60, y: 10, dx: -2, kind: 'launcher' }]));
    const next = state(2, null, [{ x: 20, y: 50, dx: -2, kind: 'launcher' }]);
    motion.observe(next);
    assert.deepEqual(
        motion.sample(next, 0.5).rockets.map((pose) => [pose.x, pose.y]),
        [[40, 50]],
    );
});
