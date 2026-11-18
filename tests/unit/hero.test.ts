import assert from 'node:assert/strict';
import test from 'node:test';
import { createHeroMotion, getHeroPose, getJetpackThrust } from '../../src/view/hero-motion.ts';

import { modelState } from '../helpers/unit-model.ts';
import type { StateDetails } from '../helpers/unit-model.ts';
type HeroPose = ReturnType<typeof getHeroPose>;
type Leg = HeroPose['legs'][number];
const state = (tick: number, x = 16, detail: StateDetails = {}) =>
    modelState({
        tick,
        screenIndex: 0,
        death: 0,
        player: { x, y: 112, walk: 1, direction: 1, jump: -1, falling: false, duck: false },
        ...detail,
    });
const near = (pose: HeroPose) => pose.legs.find((leg) => !leg.far)!;
const kneeFlex = (leg: Leg) => {
    const thigh = { x: leg.knee.x - leg.hip.x, y: leg.knee.y - leg.hip.y };
    const calf = { x: leg.ankle.x - leg.knee.x, y: leg.ankle.y - leg.knee.y };
    return (
        (Math.acos(
            Math.max(
                -1,
                Math.min(
                    1,
                    (thigh.x * calf.x + thigh.y * calf.y) /
                        (Math.hypot(thigh.x, thigh.y) * Math.hypot(calf.x, calf.y)),
                ),
            ),
        ) *
            180) /
        Math.PI
    );
};
const solePoint = (leg: Leg, x: number, y: number) => ({
    x: leg.ankle.x + x * Math.cos(leg.footAngle) - y * Math.sin(leg.footAngle),
    y: leg.ankle.y + x * Math.sin(leg.footAngle) + y * Math.cos(leg.footAngle),
});
// Sample the actual drawn boot contour independently of the support solver.
const bootCurves = [
    [
        [-1.1, -1.3],
        [-0.1, -0.9],
        [0.85, -1.25],
    ],
    [
        [1.05, -0.3],
        [1.7, 0.3],
        [2.5, 0.35],
    ],
    [
        [2.5, 0.35],
        [3.1, 0.55],
        [3.05, 1.35],
    ],
    [
        [3.05, 1.35],
        [2.5, 1.8],
        [0.5, 1.8],
    ],
    [
        [-1.9, 1.65],
        [-2.2, 0.6],
        [-1.55, -0.15],
    ],
];
const sampledSoleY = (leg: Leg) => {
    const sine = Math.sin(leg.footAngle),
        cosine = Math.cos(leg.footAngle);
    let deepest = -Infinity;
    for (const [start, control, end] of bootCurves) {
        for (let i = 0; i <= 200; i++) {
            const t = i / 200,
                remaining = 1 - t;
            const x = remaining ** 2 * start[0] + 2 * remaining * t * control[0] + t ** 2 * end[0];
            const y = remaining ** 2 * start[1] + 2 * remaining * t * control[1] + t ** 2 * end[1];
            deepest = Math.max(deepest, leg.ankle.y + x * sine + y * cosine);
        }
    }
    return deepest;
};

test('jetpack burns on the source ascent phases and fades continuously into the apex', () => {
    const rising = state(1);
    rising.player.jump = 1;
    assert.equal(getJetpackThrust(rising), 1);
    rising.player.jump = 5;
    assert.ok(getJetpackThrust(rising, 0.5) > 0.6);
    rising.player.jump = 9;
    const early = getJetpackThrust(rising, 0),
        late = getJetpackThrust(rising, 0.75);
    assert.ok(early > late && late > 0);
    assert.ok(getJetpackThrust(rising, 1 - 1e-6) < 1e-9);
    rising.player.jump = 10;
    assert.equal(getJetpackThrust(rising), 0);
});

test('jetpack stays off outside ascent and never changes source state', () => {
    for (const jump of [-1, 0, 10, 13, 14, 21]) {
        const sample = state(1);
        sample.player.jump = jump;
        assert.equal(getJetpackThrust(sample, 0.5), 0);
    }
    for (const flag of ['falling', 'duck'] as const) {
        const sample = state(1);
        sample.player.jump = 3;
        sample.player[flag] = true;
        assert.equal(getJetpackThrust(sample), 0);
    }
    const dead = state(1, 16, { death: 20 });
    dead.player.jump = 3;
    assert.equal(getJetpackThrust(dead), 0);
    const bonus = state(1, 16, { status: 'bonus' });
    bonus.player.jump = 3;
    assert.equal(getJetpackThrust(bonus), 0);
    const sample = state(1);
    sample.player.jump = 4;
    const before = structuredClone(sample);
    assert.equal(getJetpackThrust(sample, 0.25), getJetpackThrust(sample, 0.25));
    assert.ok(Number.isFinite(getJetpackThrust(sample, NaN)));
    assert.deepEqual(sample, before);
});

test('walking plants one foot while the other swings with bent constant-length legs', () => {
    const contact = getHeroPose('walk', 0, 1);
    const passing = getHeroPose('walk', 0.25, 1);
    assert.equal(near(passing).ankle.y, 14.2);
    assert.ok(near(contact).ankle.y <= 14.2);
    assert.ok(passing.legs.find((leg) => leg.far)!.ankle.y < 14.2);
    for (const kind of ['idle', 'walk', 'crouch', 'jump', 'fall', 'death'] as const) {
        for (let phase = 0; phase < 1; phase += 0.025) {
            for (const leg of getHeroPose(kind, phase, 1).legs) {
                assert.ok(
                    Math.abs(Math.hypot(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y) - 6.7) <
                        1e-7,
                );
                assert.ok(
                    Math.abs(Math.hypot(leg.ankle.x - leg.knee.x, leg.ankle.y - leg.knee.y) - 6.9) <
                        1e-7,
                );
            }
        }
    }
});

test('idle and the loaded passing leg stand tall without a permanent crouch', () => {
    for (const leg of getHeroPose('idle').legs) assert.ok(kneeFlex(leg) < 30);
    for (const phase of [0.2, 0.25, 0.3, 0.35]) {
        assert.ok(kneeFlex(near(getHeroPose('walk', phase))) < 35);
        const opposite = getHeroPose('walk', phase + 0.5).legs.find((leg) => leg.far)!;
        assert.ok(kneeFlex(opposite) < 35);
    }
});

test('walking clears the ground modestly and keeps thighs below a high marching pose', () => {
    for (let phase = 0; phase < 1; phase += 0.005) {
        for (const leg of getHeroPose('walk', phase).legs) {
            assert.ok(kneeFlex(leg) > 2);
            const thighTilt = Math.atan2(Math.abs(leg.knee.x - leg.hip.x), leg.knee.y - leg.hip.y);
            assert.ok(thighTilt < Math.PI / 3);
            const soleY = sampledSoleY(leg);
            assert.ok(soleY >= 14.5 && soleY <= 16 + 1e-7);
        }
    }
});

test('the curved sole meets the floor during support instead of crossing it', () => {
    for (const phase of [0, 0.08, 0.2, 0.3, 0.45, 0.499, 0.55, 0.599]) {
        const soleY = sampledSoleY(near(getHeroPose('walk', phase)));
        assert.ok(soleY <= 16 + 1e-7);
        assert.ok(soleY >= 16 - 1e-4);
    }
});

test('stance feet stay planted through heel and toe roll at the unchanged movement cadence', () => {
    const world = (phase: number, x: number, y: number) => {
        const leg = near(getHeroPose('walk', phase));
        return solePoint(leg, x, y).x + 20 * phase;
    };
    assert.ok(Math.abs(world(0, -1.9, 1.65) - world(0.06, -1.9, 1.65)) < 1e-7);
    assert.ok(Math.abs(world(0.18, 0.5, 1.8) - world(0.35, 0.5, 1.8)) < 1e-7);
    assert.ok(Math.abs(world(0.5, 3.05, 1.35) - world(0.59, 3.05, 1.35)) < 1e-7);
});

test('heel strike and toe off have continuous ankle velocity', () => {
    const epsilon = 1e-5;
    for (const boundary of [0, 0.6]) {
        const before = near(getHeroPose('walk', boundary - epsilon)).ankle;
        const at = near(getHeroPose('walk', boundary)).ankle;
        const after = near(getHeroPose('walk', boundary + epsilon)).ankle;
        for (const axis of ['x', 'y'] as const) {
            const velocityBefore = (at[axis] - before[axis]) / epsilon;
            const velocityAfter = (after[axis] - at[axis]) / epsilon;
            assert.ok(Math.abs(velocityBefore - velocityAfter) < 0.05);
        }
    }
});

test('walk cycle closes continuously and crouch lowers the whole upper body', () => {
    const end = getHeroPose('walk', 1 - 1e-7, 1);
    const start = getHeroPose('walk', 0, 1);
    for (let i = 0; i < 2; i++) {
        assert.ok(
            Math.hypot(
                end.legs[i].ankle.x - start.legs[i].ankle.x,
                end.legs[i].ankle.y - start.legs[i].ankle.y,
            ) < 1e-4,
        );
    }
    assert.equal(getHeroPose('crouch').body.y - getHeroPose('idle').body.y, 5);
});

test('idle, blocked and turn-only ticks cannot animate a walk from stale input', () => {
    const motion = createHeroMotion();
    assert.equal(motion.sample(state(0), 0).blend, 0);
    motion.sample(state(1), 33);
    const blocked = motion.sample(state(2), 66);
    assert.equal(blocked.blend, 0);
    assert.equal(blocked.phase, 0);
    const turning = state(3);
    turning.player.direction = -1;
    assert.equal(motion.sample(turning, 100).blend, 0);
});

test('actual movement is interpolated and advances the gait by travelled distance', () => {
    const motion = createHeroMotion();
    motion.sample(state(0), 0);
    const next = state(1, 17);
    motion.sample(next, 1000 / 30);
    const middle = motion.sample(next, 50);
    assert.ok(Math.abs(middle.x - 33) < 1e-7);
    assert.ok(Math.abs(middle.phase - 0.05) < 1e-7);
    const end = motion.sample(next, 200 / 3);
    assert.ok(Math.abs(end.x - 34) < 1e-7);
    assert.ok(Math.abs(end.phase - 0.1) < 1e-7);
    // A paused state freezes the pose; wall-clock time does not march the feet.
    assert.equal(motion.sample(next, 5000).phase, end.phase);
});

test('jumping, falling and death use separate poses despite horizontal momentum', () => {
    for (const kind of ['jump', 'fall', 'death']) {
        const motion = createHeroMotion();
        motion.sample(state(0), 0);
        const next = state(1, 17);
        if (kind === 'jump') next.player.jump = 3;
        if (kind === 'fall') next.player.falling = true;
        if (kind === 'death') next.death = 20;
        const pose = motion.sample(next, 1000 / 30);
        assert.equal(pose.kind, kind);
        assert.equal(pose.phase, 0);
    }
});

test('screen transitions, teleports and restart do not interpolate across the map', () => {
    const motion = createHeroMotion();
    motion.sample(state(0), 0);
    assert.equal(motion.sample(state(1, 70), 33).x, 140);
    assert.equal(motion.sample(state(2, 0, { screenIndex: 1 }), 66).x, 0);
    motion.reset();
    assert.equal(motion.sample(state(0, 16), 100).x, 32);
});
