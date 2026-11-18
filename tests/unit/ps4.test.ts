import test from 'node:test';
import assert from 'node:assert/strict';
import { createTvController } from '../../src/controllers/tv.ts';
import { createInput } from '../../src/input/index.ts';
import { createState, step } from '../../src/model/state.ts';

function fixture(userAgent = 'Mozilla/5.0 (PlayStation 4 11.00)', enabled = false) {
    const canvas = {};
    const document = Object.assign(new EventTarget(), {
        activeElement: canvas,
        body: {},
        hidden: false,
    });
    const view = Object.assign(new EventTarget(), { navigator: { userAgent }, document });
    const doc = Object.assign(document, { defaultView: view });
    const controls = Object.assign(new EventTarget(), { querySelectorAll: () => [] });
    const input = createInput(view as unknown as Window, controls as unknown as HTMLElement);
    const shell = {
        ownerDocument: doc,
        classList: { add() {}, remove() {}, contains: () => false },
    };
    const controller = createTvController({
        enabled,
        shell: shell as unknown as HTMLElement,
        canvas: canvas as HTMLCanvasElement,
        isPlaying: () => true,
        onCommand: input.setRemoteCommand,
        onClearCommands: input.clearRemoteCommands,
        onActivity() {},
        onConfirm() {},
        onSplitAdjust() {},
        onBack: () => true,
        onPause: () => true,
    });
    function key(key: string, type = 'keydown') {
        const event = Object.assign(new Event(type, { cancelable: true }), { key });
        doc.dispatchEvent(event);
        return event.defaultPrevented;
    }
    function tap(keyName: string) {
        key(keyName);
        input.sample();
        key(keyName, 'keyup');
    }
    return {
        key,
        tap,
        input,
        view,
        doc,
        destroy() {
            controller.destroy();
            input.destroy();
        },
    };
}

test('PS4 sequential direction then Up retains horizontal input throughout the jump press', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        for (const [key, direction, opposite] of [
            ['ArrowLeft', 'left', 'right'],
            ['ArrowRight', 'right', 'left'],
        ] as const) {
            f.tap(key);
            assert.equal(f.input.sample()[direction], false, 'Releasing a direction stops walking');
            t.mock.timers.tick(100);
            f.key('ArrowUp');
            const prepared = f.input.sample();
            assert.equal(prepared[direction], true);
            assert.equal(prepared.jump, false, 'Prepare original walking momentum before jumping');
            for (let tick = 0; tick < 30; tick++) {
                const sample = f.input.sample();
                assert.equal(sample.jump, true);
                assert.equal(
                    sample[direction],
                    true,
                    'Serial arrow events must produce a diagonal',
                );
                assert.equal(sample[opposite], false);
                t.mock.timers.tick(40);
            }
            f.key('ArrowUp', 'keyup');
            assert.equal(
                f.input.sample()[direction],
                false,
                'Releasing Up stops the carried direction',
            );
            assert.equal(f.input.sample().jump, false);
        }
    } finally {
        f.destroy();
    }
});

test('PS4 short directional jump taps survive preparation and reset cancels a pending jump', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        f.tap('ArrowRight');
        f.key('ArrowUp');
        f.key('ArrowUp', 'keyup');
        const prepared = f.input.sample();
        assert.equal(prepared.right, true);
        assert.equal(prepared.jump, false);
        const jumped = f.input.sample();
        assert.equal(jumped.right, true);
        assert.equal(jumped.jump, true);
        assert.equal(f.input.sample().right, false);
        assert.equal(f.input.sample().jump, false);
        f.tap('ArrowLeft');
        f.key('ArrowUp');
        f.input.sample();
        f.input.reset();
        const reset = f.input.sample();
        assert.equal(reset.left, false);
        assert.equal(reset.jump, false);
        f.key('ArrowUp', 'keyup');
    } finally {
        f.destroy();
    }
});

test('PS4 only carries a recent direction and explicit steering replaces the carried direction', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        f.tap('ArrowRight');
        t.mock.timers.tick(251);
        f.key('ArrowUp');
        assert.equal(f.input.sample().right, false, 'An old direction must allow a vertical jump');
        f.key('ArrowUp', 'keyup');
        f.input.sample();
        f.tap('ArrowLeft');
        t.mock.timers.tick(250);
        f.key('ArrowUp');
        assert.equal(f.input.sample().left, true);
        f.input.sample();
        f.key('ArrowRight');
        const steered = f.input.sample();
        assert.equal(steered.left, false);
        assert.equal(steered.right, true);
        assert.equal(steered.jump, true);
        f.key('ArrowUp', 'keyup');
        assert.equal(
            f.input.sample().right,
            true,
            'An actual held direction survives releasing Up',
        );
        f.key('ArrowRight', 'keyup');
        assert.equal(f.input.sample().right, false);
    } finally {
        f.destroy();
    }
});

test('PS4 sequential arrows start a horizontal Classic jump after an intervening idle tick', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        for (const [key, direction] of [
            ['ArrowLeft', -1],
            ['ArrowRight', 1],
        ] as const) {
            let state = createState({
                id: 0,
                placements: [],
                actions: [],
                tiles: Array.from({ length: 768 }, (_, i) =>
                    i >= 576 ? { collision: 1, block: 33 } : null,
                ),
            });
            f.key(key);
            state = step(state, f.input.sample()).state;
            f.key(key, 'keyup');
            state = step(state, f.input.sample()).state;
            assert.equal(state.player.walk, 0);
            t.mock.timers.tick(100);
            f.key('ArrowUp');
            for (let tick = 0; tick < 3; tick++) state = step(state, f.input.sample()).state;
            assert.ok(state.player.y < 112, 'The jump must leave the ground');
            assert.equal(state.player.walk, direction, 'The jump must retain horizontal momentum');
            assert.ok((state.player.x - 16) * direction > 0);
            f.key('ArrowUp', 'keyup');
            f.input.sample();
        }
    } finally {
        f.destroy();
    }
});

test('PS4 explicit steering replaces a directional jump before or after its preparation sample', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        for (const prepareFirst of [false, true]) {
            for (const [first, second, direction, opposite] of [
                ['ArrowLeft', 'ArrowRight', 'right', 'left'],
                ['ArrowRight', 'ArrowLeft', 'left', 'right'],
            ] as const) {
                f.tap(first);
                f.key('ArrowUp');
                if (prepareFirst) f.input.sample();
                f.key(second);
                const prepared = f.input.sample();
                assert.equal(prepared[direction], true);
                assert.equal(prepared[opposite], false);
                assert.equal(prepared.jump, false);
                const jumped = f.input.sample();
                assert.equal(jumped[direction], true);
                assert.equal(jumped[opposite], false);
                assert.equal(jumped.jump, true);
                f.key('ArrowUp', 'keyup');
                f.key(second, 'keyup');
                f.input.sample();
            }
        }
    } finally {
        f.destroy();
    }
});

test('PS4 moving focus to a control cancels a pending jump without clearing keyboard input', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        f.view.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Space' }));
        f.tap('ArrowRight');
        f.key('ArrowUp');
        f.input.sample();
        f.doc.activeElement = { tagName: 'BUTTON' };
        f.doc.dispatchEvent(new Event('focusin'));
        const cancelled = f.input.sample();
        assert.equal(cancelled.right, false);
        assert.equal(cancelled.jump, false);
        assert.equal(
            cancelled.fire,
            true,
            'Remote cancellation must leave other input sources alone',
        );
    } finally {
        f.destroy();
    }
});

test('PS4 interrupted input forgets the jump direction', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture();
    try {
        for (const interrupt of [
            () => f.view.dispatchEvent(new Event('blur')),
            () => f.view.dispatchEvent(new Event('pagehide')),
            () => {
                f.doc.hidden = true;
                f.doc.dispatchEvent(new Event('visibilitychange'));
                f.doc.hidden = false;
            },
            () => f.tap('Pause'),
            () => f.tap('Escape'),
            () => f.tap('ArrowDown'),
        ]) {
            f.tap('ArrowRight');
            interrupt();
            f.input.sample();
            f.key('ArrowUp');
            const sample = f.input.sample();
            assert.equal(sample.right, false, 'An interruption must discard buffered movement');
            assert.equal(sample.jump, true);
            f.key('ArrowUp', 'keyup');
            f.input.sample();
        }
    } finally {
        f.destroy();
    }
});

test('TV remotes retain independent arrows without PS4 direction carry', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1000 });
    const f = fixture('SmartTV', true);
    try {
        f.tap('ArrowRight');
        f.key('ArrowUp');
        const sample = f.input.sample();
        assert.equal(sample.jump, true);
        assert.equal(sample.right, false);
    } finally {
        f.destroy();
    }
});
