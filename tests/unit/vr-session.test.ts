import assert from 'node:assert/strict';
import test from 'node:test';
import type { World } from '../../src/types/game.ts';
import { createVrSession } from '../../src/controllers/vr/session.ts';
import { createXrInput } from '../../src/controllers/vr/input.ts';
import { createXrSessionControl } from '../../src/controllers/vr/xr-session.ts';
import { createVrPreferences } from '../../src/controllers/vr/preferences.ts';
import { createScoreController } from '../../src/controllers/scores.ts';
import { createVrRunScores } from '../../src/controllers/vr/scores.ts';
import { readVrPreviewAction } from '../../src/controllers/vr/preview-actions.ts';

const world: World = {
    screens: [{ tiles: Array.from({ length: 704 }, () => null) }],
};
function controller(
    handedness = 'right',
    values: { x?: number; y?: number; fire?: boolean; pause?: boolean; rocket?: boolean } = {},
) {
    return {
        handedness,
        gamepad: {
            mapping: 'xr-standard',
            axes: [0, 0, values.x ?? 0, values.y ?? 0],
            buttons: Array.from({ length: 6 }, (_, index) => ({
                value:
                    (index === 0 && values.rocket) || (index === 5 && (values.fire || values.pause))
                        ? 1
                        : 0,
                pressed: Boolean(
                    (index === 0 && values.rocket) ||
                    (index === 5 && (values.fire || values.pause)),
                ),
            })),
        },
    };
}

test('VR input requires neutral release after connecting and does not repeat pause', () => {
    const input = createXrInput();
    assert.equal(input.sample([controller('right', { fire: true })]).commands.fire, false);
    assert.equal(input.sample([controller()]).armed, true);
    assert.equal(input.sample([controller('right', { fire: true })]).commands.fire, true);
    input.sample([controller('left'), controller()]);
    input.sample([controller('left'), controller()]);
    assert.equal(input.sample([controller('left', { pause: true }), controller()]).pause, true);
    assert.equal(input.sample([controller('left', { pause: true }), controller()]).pause, false);
    input.reset();
    assert.equal(input.sample([controller('right', { fire: true })]).commands.fire, false);
});

test('VR input normalizes handed axes and clears commands when a controller disappears', () => {
    const input = createXrInput();
    input.sample([controller('left'), controller()]);
    const result = input.sample([
        controller('left', { x: -0.9, y: 0.7 }),
        controller('right', { fire: true }),
    ]);
    assert.equal(result.commands.left, true);
    assert.equal(result.commands.right, false);
    assert.equal(result.commands.duck, true);
    assert.equal(result.commands.fire, true);
    assert.equal(input.sample([controller()]).lost, true);
    assert.equal(input.sample([controller('right', { fire: true })]).commands.fire, false);
    assert.equal(input.sample([]).connected, false);
});

test('VR input rejects nonstandard mapping and nonfinite axis values', () => {
    const input = createXrInput();
    const source = controller('left', { x: NaN, y: Infinity });
    assert.equal(input.sample([source]).commands.left, false);
    assert.equal(input.sample([source]).commands.duck, false);
    assert.equal(
        input.sample([{ ...source, gamepad: { ...source.gamepad!, mapping: 'standard' } }])
            .connected,
        false,
    );
});

test('Quest grip and unused stick buttons do not block arming the gameplay controls', () => {
    const input = createXrInput();
    const left = controller('left');
    const right = controller();
    for (const source of [left, right]) {
        source.gamepad!.buttons[1] = { pressed: true, value: 1 };
        source.gamepad!.buttons[3] = { pressed: true, value: 1 };
    }
    assert.equal(input.sample([left, right]).armed, true);
    left.gamepad!.axes[2] = -0.8;
    right.gamepad!.buttons[5] = { pressed: true, value: 1 };
    assert.equal(input.sample([left, right]).commands.left, true);
    assert.equal(input.sample([left, right]).commands.fire, true);
});

test('Quest right trigger launches one rocket, B fires only bullets and left Y pauses', () => {
    const input = createXrInput();
    const left = controller('left');
    input.sample([left, controller()]);
    const trigger = input.sample([left, controller('right', { rocket: true })]);
    assert.equal(trigger.commands.rocket, true);
    assert.equal(trigger.commands.fire, false);
    assert.equal(trigger.pause, false);
    const fire = input.sample([left, controller('right', { fire: true })]);
    assert.equal(fire.commands.fire, true);
    assert.equal(fire.commands.chargeRocket, false);
    assert.equal(fire.pause, false, 'B must never toggle pause');
    assert.equal(input.sample([controller('left', { pause: true }), controller()]).pause, true);
    input.reset();
    input.sample([controller('left')]);
    const leftOnly = input.sample([controller('left', { rocket: true })]);
    assert.equal(
        Boolean(leftOnly.commands.rocket),
        false,
        'Left trigger does not become the right trigger',
    );
});

test('Quest weapon taps survive render frames until one simulation sample consumes them', () => {
    const input = createXrInput();
    input.sample([controller()]);
    input.sample([controller('right', { rocket: true })]);
    input.sample([controller()]);
    input.sample([controller()]);
    assert.equal(
        input.consumeCommands().rocket,
        true,
        'A trigger tap between simulation ticks is retained',
    );
    assert.equal(Boolean(input.consumeCommands().rocket), false);
    input.sample([controller('right', { rocket: true })]);
    assert.equal(input.consumeCommands().rocket, true);
    input.sample([controller('right', { rocket: true })]);
    assert.equal(Boolean(input.consumeCommands().rocket), false, 'Holding does not repeat rockets');
    input.sample([controller()]);
    input.sample([controller('right', { fire: true })]);
    input.sample([controller()]);
    const bullet = input.consumeCommands();
    assert.equal(bullet.fire, true);
    assert.equal(bullet.firePressed, true);
    assert.equal(bullet.chargeRocket, false);
    assert.equal(Boolean(input.consumeCommands().fire), false, 'A released B tap fires once');
    input.sample([controller('right', { rocket: true })]);
    input.reset();
    assert.equal(Boolean(input.consumeCommands().rocket), false, 'Reset discards queued weapons');
});

test('Quest A emits one menu confirmation per release while retaining held jump', () => {
    const input = createXrInput();
    const right = controller();
    input.sample([right]);
    right.gamepad!.buttons[4] = { pressed: true, value: 1 };
    const first = input.sample([right]);
    assert.equal(first.confirm, true);
    assert.equal(first.commands.jump, true);
    assert.equal(input.sample([right]).confirm, false);
    input.reset();
    assert.equal(input.sample([right]).confirm, false);
    right.gamepad!.buttons[4] = { pressed: false, value: 0 };
    input.sample([right]);
    right.gamepad!.buttons[4] = { pressed: true, value: 1 };
    assert.equal(input.sample([right]).confirm, true);
});

test('VR panel selection shares neutral arming and consumes the accepted trigger', () => {
    const input = createXrInput();
    const held = [controller('left', { x: 0.9 }), controller('right', { fire: true })];
    input.sample(held);
    assert.equal(input.consumeSelect(held), false);
    input.sample([controller('left'), controller()]);
    assert.equal(input.consumeSelect(held), true);
    assert.equal(input.consumeSelect(held), false);
    assert.equal(input.sample(held).commands.fire, false);
    input.sample([controller('left'), controller()]);
    input.reset();
    assert.equal(input.consumeSelect(held), false);
});

test('VR loses hand tracking even when the input source remains listed', () => {
    const input = createXrInput();
    input.sample([controller('left'), controller()]);
    assert.equal(
        input.sample([controller('left', { x: -0.9 }), controller('right', { fire: true })])
            .commands.fire,
        true,
    );
    const lost = [controller('left'), { ...controller('right', { fire: true }), tracked: false }];
    const result = input.sample(lost);
    assert.equal(result.lost, true);
    assert.equal(result.commands.fire, false);
    assert.equal(input.consumeSelect(lost), false);
    assert.equal(
        input.sample([controller('left'), controller('right', { fire: true })]).commands.fire,
        false,
    );
});

test('VR preview gamepad preserves B crouching and respects native dialog input ownership', () => {
    const back = { pause: false, back: true, confirm: false, scores: false };
    assert.equal(readVrPreviewAction('playing', back, false), undefined);
    assert.equal(readVrPreviewAction('paused', back, false), 'title');
    assert.equal(
        readVrPreviewAction('paused', { ...back, back: false, pause: true }, true),
        undefined,
    );
    assert.equal(
        readVrPreviewAction('paused', { ...back, back: false, confirm: true }, true),
        undefined,
    );
    assert.equal(
        readVrPreviewAction('title', { ...back, back: false, confirm: true }, false),
        'start',
    );
});

test('VR session advances only while playing and preserves state on pause', () => {
    const session = createVrSession(world);
    assert.equal(session.mode, 'title');
    session.tick({ fire: true });
    assert.equal(session.state.tick, 0);
    session.start();
    session.tick({ fire: true });
    assert.equal(session.state.tick, 1);
    assert.equal(session.state.ammo, 98);
    session.pause();
    const paused = session.state;
    session.tick({ fire: true });
    assert.equal(session.state, paused);
    session.start();
    assert.equal(session.state.tick, 1);
    session.title();
    session.start();
    assert.equal(session.state.tick, 0);
    assert.equal(session.state.ammo, 99);
});

test('VR selected levels and cheats retain usage metadata after restart and disabling cheats', () => {
    const selected = createVrSession(world, { selectedLevel: true });
    assert.equal(selected.state.cheatUsed, true);
    selected.start(true);
    assert.equal(selected.state.cheatUsed, true);
    const session = createVrSession(world);
    session.configure({ invulnerable: true });
    session.configure({});
    assert.equal(session.state.cheatMode, false);
    assert.equal(session.state.cheatUsed, true);
});

test('VR session exposes game-over and completion without stepping a terminal state', () => {
    const session = createVrSession(world);
    session.start();
    session.state.status = 'won';
    session.tick({});
    assert.equal(session.mode, 'won');
    assert.equal(session.running, false);
    session.start();
    assert.equal(session.state.status, 'playing');
    session.state.status = 'over';
    session.tick({});
    assert.equal(session.mode, 'over');
    session.start();
    assert.equal(session.state.lives, 9);
});

test('VR scores and settings use independent keys and include cheated submissions', () => {
    const saved = new Map<string, string>([['exolon-best-score', '900000']]);
    const preferences = createVrPreferences({
        get: (key) => saved.get(key),
        set(key, value) {
            saved.set(key, String(value));
            return true;
        },
    });
    const scores = createScoreController(preferences.scores);
    assert.equal(scores.bestScore, 0);
    scores.save({ score: 2000, cheatUsed: true });
    assert.equal(scores.bestScore, 2000);
    scores.submit('CHEAT', { score: 2000, cheatUsed: true });
    assert.deepEqual(scores.rows[0], { name: 'CHEAT', score: 2000, player: true });
    scores.save({ score: 3000 });
    scores.submit('VR HERO', { score: 3000 });
    assert.equal(saved.get('exolon-best-score'), '900000');
    assert.equal(saved.get('exolon-vr-best-score'), '3000');
    preferences.setScale(99);
    assert.equal(preferences.scale, 1.5);
    preferences.setScale(NaN);
    assert.equal(preferences.scale, 1);
});

test('VR terminal scores can be submitted only once per run and cancellation leaves eligibility', () => {
    const saved = new Map<string, string>();
    const preferences = createVrPreferences({
        get: (key) => saved.get(key),
        set(key, value) {
            saved.set(key, String(value));
            return true;
        },
    });
    const run = createVrRunScores(preferences.scores);
    const session = createVrSession(world);
    session.state.score = 5000;
    assert.equal(run.canSubmit(session.state), false);
    session.state.status = 'over';
    assert.equal(run.canSubmit(session.state), true);
    // Opening then cancelling the native form does not consume a submission.
    assert.equal(run.canSubmit(session.state), true);
    assert.equal(run.submit('VR HERO', session.state), true);
    assert.equal(run.submit('DUPLICATE', session.state), false);
    assert.equal(run.records.rows.filter((row) => row.player).length, 1);
    run.reset();
    session.state.cheatUsed = true;
    assert.equal(run.canSubmit(session.state), true);
    assert.equal(run.submit('CHEAT', session.state), true);
    assert.equal(run.submit('DUPLICATE', session.state), false);
    assert.equal(run.records.rows.filter((row) => row.player).length, 2);
});

class Session extends EventTarget {
    ended = false;
    visibilityState = 'visible';
    async end() {
        this.ended = true;
        this.dispatchEvent(new Event('end'));
    }
}

test('a late XR session is ended after cancellation and never mounted', async () => {
    let resolve!: (session: Session) => void;
    let mounts = 0;
    const control = createXrSessionControl({
        request: () =>
            new Promise<Session>((done) => {
                resolve = done;
            }),
        async mount() {
            mounts++;
        },
        onSession() {},
        onPause() {},
        onError() {},
    });
    const pending = control.enter();
    control.destroy();
    const session = new Session();
    resolve(session);
    await pending;
    assert.equal(session.ended, true);
    assert.equal(mounts, 0);
});

test('cancelling granted XR during deferred mount ends it before renderer setup finishes', async () => {
    const session = new Session();
    let release!: () => void;
    let mounted!: () => void;
    const startedMount = new Promise<void>((resolve) => {
        mounted = resolve;
    });
    let callbacks = 0;
    const control = createXrSessionControl({
        request: async () => session,
        mount() {
            mounted();
            return new Promise<void>((resolve) => {
                release = resolve;
            });
        },
        onSession(value) {
            if (value) callbacks++;
        },
        onPause() {},
        onError() {},
    });
    const request = control.enter();
    await startedMount;
    const teardown = control.destroy();
    assert.equal(session.ended, true);
    release();
    await request;
    await teardown;
    assert.equal(callbacks, 0);
});

test('XR visibility loss and ending pause the application without automatic resume', async () => {
    const session = new Session();
    let active: Session | null = null;
    let pauses = 0;
    const control = createXrSessionControl({
        request: async () => session,
        async mount() {},
        onSession(value) {
            active = value;
        },
        onPause() {
            pauses++;
        },
        onError() {},
    });
    await control.enter();
    assert.equal(active, session);
    session.visibilityState = 'hidden';
    session.dispatchEvent(new Event('visibilitychange'));
    assert.equal(pauses, 1);
    session.visibilityState = 'visible';
    session.dispatchEvent(new Event('visibilitychange'));
    assert.equal(pauses, 1);
    await control.exit();
    assert.equal(active, null);
    assert.equal(session.ended, true);
    control.destroy();
});

test('XR setup rejection releases the session and reports a recoverable error', async () => {
    const session = new Session();
    let errors = 0;
    const control = createXrSessionControl({
        request: async () => session,
        async mount() {
            throw new Error('GPU setup failed');
        },
        onSession() {},
        onPause() {},
        onError() {
            errors++;
        },
    });
    await control.enter();
    assert.equal(session.ended, true);
    assert.equal(errors, 1);
    assert.equal(control.active, null);
    control.destroy();
});

test('XR request failures preserve the browser error for a useful headset diagnosis', async () => {
    const failure = new DOMException('Permission was denied', 'NotAllowedError');
    let observed: unknown;
    const control = createXrSessionControl({
        request: async (): Promise<Session> => {
            throw failure;
        },
        async mount() {},
        onSession() {},
        onPause() {},
        onError(error) {
            observed = error;
        },
    });
    await control.enter();
    assert.equal(observed, failure);
    await control.destroy();
});

test('VR selected-level victories qualify for local rankings after cheats are disabled', () => {
    const values = new Map<string, string>();
    const preferences = createVrPreferences({
        get: (key) => values.get(key),
        set(key, value) {
            values.set(key, String(value));
            return true;
        },
    });
    const run = createVrRunScores(preferences.scores);
    const session = createVrSession(world, { selectedLevel: true });
    session.start();
    session.configure({ infiniteAmmo: true });
    session.configure({});
    session.state.score = 8000;
    session.state.status = 'won';
    assert.equal(session.state.cheatUsed, true);
    assert.equal(run.canSubmit(session.state), true);
    assert.equal(run.submit('SELECTED', session.state), true);
    assert.equal(run.submit('DUPLICATE', session.state), false);
    assert.deepEqual(run.records.rows[0], { name: 'SELECTED', score: 8000, player: true });
    assert.equal(run.records.bestScore, 8000);
});
