import type { GameCommands, GamepadNavigator } from '../../src/input/gamepad.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createGamepadInput } from '../../src/input/gamepad.ts';
import { createInput } from '../../src/input/index.ts';
import { createState, step } from '../../src/model/state.ts';

type Action = keyof GameCommands | 'rocket';
interface InputWindow extends EventTarget {
    navigator: GamepadNavigator;
    innerWidth?: number;
    document?: InputDocument;
    ontouchstart?: null;
}
interface InputDocument extends EventTarget {
    hidden?: boolean;
    elementFromPoint?: () => TouchButton | null;
}
interface InputControls extends EventTarget {
    ownerDocument?: InputDocument;
    closest?: () => unknown;
    contains?: (button: unknown) => boolean;
    querySelectorAll?: (selector?: string) => unknown[];
    querySelector?: (selector: string) => unknown;
}
interface TouchButton {
    dataset: { action: Action };
    closest: () => TouchButton;
    classList: {
        add(name: string): unknown;
        remove(name: string): unknown;
        contains(name: string): boolean;
        toggle(name: string, on: boolean): void;
    };
    setPointerCapture(id: number): unknown;
    hasPointerCapture(id: number): boolean;
    releasePointerCapture(id: number): unknown;
}
function pad(index = 0) {
    return {
        id: `Pad ${index}`,
        index,
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
}
function press(device: ReturnType<typeof pad>, index: number, down = true, value = down ? 1 : 0) {
    device.buttons[index] = { pressed: down, value };
}
const any = (values: Partial<GameCommands> | Record<string, boolean>) =>
    Object.values(values).some(Boolean);

test('standard sticks, d-pad and face/trigger buttons produce the original game commands', () => {
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    assert.equal(input.poll().status, 'ready');
    device.axes = [0.2, -0.2];
    assert.equal(any(input.poll().commands), false);
    device.axes = [0.6, -0.6];
    assert.deepEqual(input.poll().commands, {
        left: false,
        right: true,
        jump: true,
        duck: false,
        fire: false,
    });
    press(device, 14);
    press(device, 13);
    assert.deepEqual(input.poll().commands, {
        left: true,
        right: false,
        jump: false,
        duck: true,
        fire: false,
    });
    device.axes = [0, 0];
    press(device, 14, false);
    press(device, 13, false);
    press(device, 0);
    press(device, 2);
    assert.equal(input.poll().commands.jump, true);
    assert.equal(input.poll().commands.fire, true);
    press(device, 2, false);
    press(device, 7, false, 0.4);
    assert.equal(input.poll().pressed.launchRocket, false);
    press(device, 7, false, 0.7);
    const trigger = input.poll();
    assert.equal(trigger.commands.fire, false);
    assert.equal(trigger.pressed.launchRocket, true);
    assert.equal(input.poll().pressed.launchRocket, false);
});

test('a trigger tap queues one rocket until a simulation sample and reset discards it', () => {
    const device = pad();
    const target = new EventTarget() as InputWindow;
    target.navigator = { getGamepads: () => [device] };
    const controls = new EventTarget() as InputControls;
    controls.querySelectorAll = () => [];
    const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
    input.pollGamepad();
    press(device, 7);
    input.pollGamepad();
    press(device, 7, false);
    input.pollGamepad();
    assert.equal(input.sample().rocket, true, 'a tap between simulation ticks still launches');
    assert.equal(input.sample().rocket, false, 'the request is consumed once');
    press(device, 7);
    input.pollGamepad();
    assert.equal(input.sample().rocket, true);
    input.pollGamepad();
    assert.equal(input.sample().rocket, false, 'a held trigger does not repeat');
    press(device, 7, false);
    input.pollGamepad();
    press(device, 7);
    input.pollGamepad();
    input.reset();
    assert.equal(input.sample().rocket, false);
    assert.equal(input.pollGamepad().status, 'release');
    assert.equal(input.sample().rocket, false, 'held input cannot launch after reset');
    input.destroy();
});

test('right shoulder fire combines with jumping, preserves face fire and rearms after reset', () => {
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    input.poll();
    press(device, 5);
    press(device, 0);
    const held = input.poll();
    assert.equal(held.commands.fire, true);
    assert.equal(held.commands.jump, true);
    assert.equal(held.pressed.launchRocket, false);
    press(device, 2);
    press(device, 5, false);
    assert.equal(input.poll().commands.fire, true, 'face fire remains held after shoulder release');
    press(device, 2, false);
    assert.equal(input.poll().commands.fire, false);
    press(device, 5);
    input.reset();
    assert.equal(input.poll().status, 'release');
    assert.equal(input.poll().commands.fire, false);
    press(device, 0, false);
    press(device, 5, false);
    assert.equal(input.poll().status, 'ready');
    press(device, 5);
    assert.equal(input.poll().commands.fire, true);
});

test('backgrounding or handing off to another controller cancels a pending rocket', () => {
    for (const handoff of [false, true]) {
        const device = pad();
        const other = pad(1);
        const target = new EventTarget() as InputWindow;
        target.navigator = { getGamepads: () => [device, other] };
        const controls = new EventTarget() as InputControls;
        controls.querySelectorAll = () => [];
        const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
        input.pollGamepad();
        press(device, 7);
        input.pollGamepad();
        if (handoff) device.connected = false;
        input.pollGamepad(handoff);
        assert.equal(input.sample().rocket, false);
        input.destroy();
    }
});

test('menu actions are edges and held buttons cannot resume or fire across a reset', () => {
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    input.poll();
    press(device, 9);
    assert.equal(input.poll().pressed.pause, true);
    assert.equal(input.poll().pressed.pause, false);
    input.reset();
    assert.equal(any(input.poll().pressed), false);
    press(device, 9, false);
    input.poll();
    press(device, 0);
    assert.equal(input.poll().pressed.confirm, true);
    input.reset();
    assert.equal(input.poll().commands.jump, false);
    press(device, 0, false);
    input.poll();
    press(device, 2);
    assert.equal(input.poll().commands.fire, true);
});

test('back, records and previous-music controls each fire once per press', () => {
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    input.poll();
    for (const [index, action] of [
        [1, 'back'],
        [3, 'scores'],
        [4, 'previousMusic'],
    ] as const) {
        press(device, index);
        assert.equal(input.poll().pressed[action], true);
        assert.equal(input.poll().pressed[action], false);
        press(device, index, false);
        input.poll();
    }
});

test('mapped input moves, jumps, crouches and preserves short-shot/held-rocket timing in the real model', () => {
    const screen = {
        id: 0,
        placements: [],
        actions: [],
        objects: [],
        tiles: Array.from({ length: 768 }, (_, index) =>
            index >= 576 ? { collision: 1, block: 33 } : null,
        ),
    };
    let state = createState(screen);
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    input.poll();
    device.axes[0] = 0.8;
    state = step(state, input.poll().commands).state;
    assert.equal(state.player.x, 17);
    device.axes[0] = 0;
    press(device, 0);
    state = step(state, input.poll().commands).state;
    assert.equal(state.player.y, 108);
    press(device, 0, false);
    for (let tick = 0; tick < 25; tick++) state = step(state, input.poll().commands).state;
    press(device, 1);
    state = step(state, input.poll().commands).state;
    assert.equal(state.player.duck, true);
    press(device, 1, false);
    press(device, 5);
    state = step(state, input.poll().commands).state;
    assert.equal(state.ammo, 98);
    assert.equal(state.grenades, 10);
    for (let tick = 0; tick < 14; tick++) state = step(state, input.poll().commands).state;
    assert.equal(state.grenades, 9);
});

test('connecting with held input waits for neutral; disconnection and reconnection clear commands', () => {
    let device: ReturnType<typeof pad> | null = pad();
    press(device, 2);
    const input = createGamepadInput({ getGamepads: () => (device ? [device] : []) });
    assert.equal(input.poll().status, 'release');
    assert.equal(any(input.poll().commands), false);
    press(device, 2, false);
    input.poll();
    press(device, 2);
    assert.equal(input.poll().commands.fire, true);
    device = null;
    assert.equal(input.poll().lost, true);
    assert.equal(input.poll().lost, false);
    device = pad();
    press(device, 9);
    const held = input.poll();
    assert.equal(held.status, 'release');
    assert.equal(any(held.pressed), false);
    press(device, 9, false);
    input.poll();
    press(device, 9);
    assert.equal(input.poll().pressed.pause, true);
});

test('sparse multiple devices retain the active controller and never transfer held input', () => {
    const first = pad(2),
        second = pad(4);
    const devices = [null, null, first, null, second];
    const input = createGamepadInput({ getGamepads: () => devices });
    assert.equal(input.poll().index, 2);
    press(second, 2);
    assert.equal(input.poll().commands.fire, false);
    first.connected = false;
    const state = input.poll();
    assert.equal(state.lost, true);
    assert.equal(state.index, 4);
    assert.equal(any(state.commands), false);
    press(second, 2, false);
    input.poll();
    press(second, 2);
    assert.equal(input.poll().commands.fire, true);
});

test('hidden/background polling suspends controls until they are released again', () => {
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    input.poll();
    press(device, 2);
    assert.equal(input.poll().commands.fire, true);
    assert.equal(any(input.poll(false).commands), false);
    assert.equal(any(input.poll().commands), false);
    press(device, 2, false);
    input.poll();
    press(device, 2);
    assert.equal(input.poll().commands.fire, true);
});

test('unsupported, blocked and nonstandard gamepads leave keyboard fallback available', () => {
    assert.equal(createGamepadInput({}).poll().status, 'unsupported');
    assert.equal(
        createGamepadInput({
            getGamepads() {
                throw new Error('Blocked');
            },
        }).poll().status,
        'unavailable',
    );
    const device = pad();
    device.mapping = '';
    press(device, 2);
    const state = createGamepadInput({ getGamepads: () => [device] }).poll();
    assert.equal(state.status, 'nonstandard');
    assert.equal(any(state.commands), false);
});

test('gamepad commands merge with real keyboard and pointer events and reset clears all channels', () => {
    const device = pad();
    const target = new EventTarget() as InputWindow;
    target.navigator = { getGamepads: () => [device] };
    const controls = new EventTarget() as InputControls;
    const held = new Set<string>();
    const button = {
        dataset: { action: 'duck' },
        setPointerCapture() {},
        classList: {
            add: (name: string) => held.add(name),
            remove: (name: string) => held.delete(name),
            toggle(name: string, value: boolean) {
                if (value) held.add(name);
                else held.delete(name);
            },
        },
    };
    controls.closest = () => button;
    controls.querySelectorAll = () => [button];
    const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
    input.pollGamepad();
    device.axes[0] = 0.7;
    input.pollGamepad();
    const key = new Event('keydown');
    Object.defineProperty(key, 'code', { value: 'Space' });
    target.dispatchEvent(key);
    const pointer = new Event('pointerdown');
    Object.defineProperty(pointer, 'pointerId', { value: 1 });
    controls.dispatchEvent(pointer);
    assert.deepEqual(input.sample(), {
        left: false,
        right: true,
        jump: false,
        duck: true,
        fire: true,
        rocket: false,
    });
    input.reset();
    assert.equal(any(input.sample()), false);
    input.pollGamepad();
    assert.equal(any(input.sample()), false);
    device.axes[0] = 0;
    input.pollGamepad();
    device.axes[0] = -0.8;
    input.pollGamepad();
    assert.equal(input.sample().left, true);
    input.destroy();
    assert.equal(held.size, 0);
});

test('keyboard repeats cannot reintroduce a held start key after input reset', () => {
    const target = new EventTarget() as InputWindow;
    target.navigator = { getGamepads: () => [] };
    const controls = new EventTarget() as InputControls;
    controls.querySelectorAll = () => [];
    const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
    const key = (type: string, repeat = false) => {
        const event = new Event(type, { cancelable: true });
        Object.defineProperties(event, { code: { value: 'Space' }, repeat: { value: repeat } });
        target.dispatchEvent(event);
        return event;
    };
    key('keydown');
    assert.equal(input.sample().fire, true);
    input.reset();
    assert.equal(input.sample().fire, false);
    assert.equal(key('keydown', true).defaultPrevented, true);
    assert.equal(input.sample().fire, false);
    key('keyup');
    key('keydown');
    assert.equal(input.sample().fire, true);
    input.destroy();
});

function touchControls(legacy = false, withStick = false) {
    const target = new EventTarget() as InputWindow,
        controls = new EventTarget() as InputControls,
        doc = new EventTarget() as InputDocument;
    if (legacy) target.ontouchstart = null;
    target.innerWidth = 800;
    target.navigator = { getGamepads: () => [] };
    target.document = doc;
    controls.ownerDocument = doc;
    const captures = new Map<number, TouchButton>(),
        buttons = {} as Record<Action, TouchButton>;
    let hit: TouchButton | null = null;
    for (const action of ['left', 'right', 'jump', 'duck', 'fire', 'rocket'] as const) {
        const classes = new Set<string>(),
            button: TouchButton = {
                dataset: { action },
                closest: () => button,
                classList: {
                    add: (n: string) => classes.add(n),
                    remove: (n: string) => classes.delete(n),
                    contains: (n: string) => classes.has(n),
                    toggle(n: string, on: boolean) {
                        if (on) classes.add(n);
                        else classes.delete(n);
                    },
                },
                setPointerCapture: (id: number) => captures.set(id, button),
                hasPointerCapture: (id: number) => captures.get(id) === button,
                releasePointerCapture: (id: number) => captures.delete(id),
            };
        buttons[action] = button;
    }
    controls.contains = (button) => Object.values(buttons).includes(button as TouchButton);
    controls.closest = () => hit;
    controls.querySelectorAll = (selector) =>
        Object.values(buttons).filter(
            (b) =>
                selector !== '.touch-controls__button_held' ||
                b.classList.contains('touch-controls__button_held'),
        );
    doc.elementFromPoint = () => hit;
    const thumb = { style: { transform: '' } };
    const stick = {
        contains: (node: unknown) =>
            ['left', 'right', 'jump', 'duck'].some((action) => buttons[action as Action] === node),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 }),
    };
    controls.querySelector = (selector) =>
        withStick ? (selector === '[data-stick]' ? stick : thumb) : null;
    const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
    function pointer(
        type: string,
        id: number,
        action: Action | null = null,
        receiver: EventTarget = controls,
        button = 0,
        point = { x: 20, y: 20 },
    ) {
        hit = action === null ? null : buttons[action] || null;
        const event = new Event(type, { cancelable: true });
        Object.defineProperties(event, {
            pointerId: { value: id },
            clientX: { value: point.x },
            clientY: { value: point.y },
            button: { value: button },
            detail: { value: type === 'click' ? 0 : 1 },
            changedTouches: {
                value: [
                    { identifier: id, clientX: point.x, clientY: point.y, target: hit || controls },
                ],
            },
        });
        receiver.dispatchEvent(event);
        return event;
    }
    return { input, target, doc, buttons, captures, pointer, thumb };
}

test('virtual stick supports neutral, diagonals and dragging outside with an independent weapon finger', () => {
    for (const legacy of [false, true]) {
        const f = touchControls(legacy, true);
        const down = legacy ? 'touchstart' : 'pointerdown';
        const move = legacy ? 'touchmove' : 'pointermove';
        const receiver = legacy ? f.target : undefined;
        f.pointer(down, 1, 'right', undefined, 0, { x: 110, y: 60 });
        assert.equal(f.input.sample().right, true);
        f.pointer(down, 2, 'fire');
        f.pointer(move, 1, 'jump', receiver, 0, { x: 100, y: 20 });
        const diagonal = f.input.sample();
        assert.equal(diagonal.right, true);
        assert.equal(diagonal.jump, true);
        assert.equal(diagonal.fire, true);
        f.pointer(move, 1, null, receiver, 0, { x: 60, y: 60 });
        assert.equal(f.input.sample().right, false);
        assert.equal(f.input.sample().jump, false);
        f.pointer(move, 1, null, receiver, 0, { x: -5, y: 60 });
        assert.equal(f.input.sample().left, true);
        f.pointer(down, 3, 'duck', undefined, 0, { x: 60, y: 110 });
        assert.equal(f.input.sample().duck, false, 'a second finger cannot steal the stick');
        f.target.dispatchEvent(new Event('orientationchange'));
        assert.equal(any(f.input.sample()), false);
        assert.equal(f.thumb.style.transform, 'translate(0px, 0px)');
        f.input.destroy();
    }
});

test('virtual stick tracks its finger across the left half of the viewport', () => {
    for (const legacy of [false, true]) {
        const f = touchControls(legacy, true);
        const down = legacy ? 'touchstart' : 'pointerdown';
        const move = legacy ? 'touchmove' : 'pointermove';
        const up = legacy ? 'touchend' : 'pointerup';
        const receiver = legacy ? f.target : undefined;
        f.pointer(down, 1, 'right', undefined, 0, { x: 110, y: 60 });
        f.pointer(down, 2, 'fire');
        for (const point of [
            { x: 300, y: 60 },
            { x: 400, y: 60 },
        ]) {
            f.pointer(move, 1, null, receiver, 0, point);
            const commands = f.input.sample();
            assert.equal(commands.right, true, 'movement continues beyond the stick');
            assert.equal(commands.fire, true, 'the weapon finger remains independent');
        }
        f.pointer(move, 1, null, receiver, 0, { x: 401, y: 60 });
        assert.equal(f.input.sample().right, false, 'movement stops past the viewport midpoint');
        assert.equal(f.thumb.style.transform, 'translate(0px, 0px)');
        f.pointer(move, 1, null, receiver, 0, { x: 300, y: -180 });
        const diagonal = f.input.sample();
        assert.equal(diagonal.right, true, 'returning to the left half restores movement');
        assert.equal(diagonal.jump, true, 'distant drags still update direction');
        assert.equal(f.thumb.style.transform, 'translate(19px, -19px)');
        f.pointer(up, 1, null, f.target);
        assert.equal(f.input.sample().right, false, 'lifting the finger clears movement');
        assert.equal(f.input.sample().jump, false);
        assert.equal(f.input.sample().fire, true);
        f.pointer(up, 2, null, f.target);
        assert.equal(any(f.input.sample()), false);
        f.input.destroy();
    }
});

test('a second FIRE press between simulation samples still shoots another bullet', () => {
    const f = touchControls();
    const screen = {
        tiles: Array.from({ length: 768 }, (_, i) =>
            i >= 576 ? { collision: 1, block: 33 } : null,
        ),
        placements: [],
        actions: [],
    };
    let state = createState(screen);
    f.pointer('pointerdown', 1, 'fire');
    state = step(state, f.input.sample()).state;
    assert.equal(state.ammo, 98);
    f.pointer('pointerup', 1);
    f.pointer('pointerdown', 2, 'fire');
    f.pointer('pointerup', 2);
    state = step(state, f.input.sample()).state;
    assert.equal(state.ammo, 97);
    state = step(state, f.input.sample()).state;
    assert.equal(state.ammo, 97);
    f.input.destroy();
});

test('touch rockets launch once per press, survive a short tap and never generate bullets', () => {
    for (const legacy of [false, true]) {
        const f = touchControls(legacy);
        const down = legacy ? 'touchstart' : 'pointerdown';
        const up = legacy ? 'touchend' : 'pointerup';
        f.pointer(down, 1, 'rocket');
        assert.equal(f.input.sample().rocket, true);
        assert.equal(f.input.sample().rocket, false);
        assert.equal(f.input.sample().fire, false);
        f.pointer(up, 1, null, f.target);
        f.pointer(down, 2, 'rocket');
        f.pointer(up, 2, null, f.target);
        assert.equal(f.input.sample().rocket, true);
        assert.equal(f.input.sample().rocket, false);
        f.pointer(down, 3, 'rocket');
        f.pointer(legacy ? 'touchcancel' : 'pointercancel', 3, null, f.target);
        assert.equal(f.input.sample().rocket, false);
        f.input.destroy();
    }
});

test('touch movement and fire combine, shared buttons stay held and release outside the pad clears input', () => {
    const f = touchControls();
    f.pointer('pointerdown', 1, 'left');
    f.pointer('pointerdown', 2, 'fire');
    f.pointer('pointerdown', 3, 'fire');
    assert.equal(f.input.sample().left, true);
    assert.equal(f.input.sample().fire, true);
    f.pointer('pointerup', 2);
    assert.equal(f.input.sample().fire, true);
    assert.equal(f.buttons.fire.classList.contains('touch-controls__button_held'), true);
    f.pointer('pointerup', 1, null, f.target);
    assert.equal(f.input.sample().left, false);
    assert.equal(f.input.sample().fire, true);
    f.pointer('pointercancel', 3, null, f.target);
    assert.equal(any(f.input.sample()), false);
    assert.equal(f.captures.size, 0);
    f.input.destroy();
});

test('a held finger can slide between directions, leave the pad and re-enter without sticking', () => {
    const f = touchControls();
    f.pointer('pointerdown', 1, 'left');
    f.pointer('pointerdown', 2, 'fire');
    f.pointer('pointermove', 1, 'right');
    assert.equal(f.input.sample().left, false);
    assert.equal(f.input.sample().right, true);
    assert.equal(f.input.sample().fire, true);
    assert.equal(f.buttons.left.classList.contains('touch-controls__button_held'), false);
    f.pointer('pointermove', 1);
    assert.equal(f.input.sample().right, false);
    assert.equal(f.input.sample().fire, true);
    f.pointer('pointermove', 1, 'jump');
    assert.equal(f.input.sample().jump, true);
    f.pointer('lostpointercapture', 1);
    assert.equal(f.input.sample().jump, false);
    assert.equal(f.input.sample().fire, true);
    f.input.destroy();
    assert.equal(f.captures.size, 0);
});

test('touch holds and pointer capture are cleared on reset, focus loss, rotation and resize', () => {
    const f = touchControls();
    for (const type of ['blur', 'orientationchange', 'resize', 'pagehide']) {
        f.pointer('pointerdown', 1, 'jump');
        f.pointer('pointerdown', 2, 'fire');
        f.target.dispatchEvent(new Event(type));
        assert.equal(any(f.input.sample()), false, type);
        assert.equal(f.captures.size, 0, type);
    }
    f.pointer('pointerdown', 1, 'right');
    f.doc.hidden = true;
    f.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(any(f.input.sample()), false);
    assert.equal(f.captures.size, 0);
    f.pointer('pointerdown', 1, 'fire');
    f.input.reset();
    assert.equal(f.captures.size, 0);
    assert.equal(any(f.input.sample()), false);
    f.input.destroy();
});

test('missing pointer capture keeps outside-release fallback and non-primary mouse buttons are ignored', () => {
    const f = touchControls();
    f.buttons.fire.setPointerCapture = () => {
        throw new Error('Capture unavailable');
    };
    f.pointer('pointerdown', 1, 'fire');
    assert.equal(f.input.sample().fire, true);
    f.pointer('pointerup', 1, null, f.target);
    assert.equal(f.input.sample().fire, false);
    f.pointer('pointerdown', 2, 'left', undefined, 2);
    assert.equal(f.input.sample().left, false);
    f.input.destroy();
    f.pointer('pointerdown', 3, 'right');
    assert.equal(any(f.input.sample()), false);
});

test('a complete short touch is sampled once while cancelled touches produce no delayed action', () => {
    const f = touchControls();
    f.pointer('pointerdown', 1, 'fire');
    f.pointer('pointerup', 1);
    assert.equal(f.input.sample().fire, true);
    assert.equal(f.input.sample().fire, false);
    f.pointer('pointerdown', 2, 'jump');
    f.pointer('pointercancel', 2);
    assert.equal(any(f.input.sample()), false);
    f.pointer('pointerdown', 3, 'fire');
    f.pointer('pointerup', 3);
    f.input.reset();
    assert.equal(any(f.input.sample()), false);
    f.input.destroy();
});

test('keyboard and assistive button clicks provide one action without a physical pointer', () => {
    const f = touchControls();
    f.pointer('click', 1, 'fire');
    assert.equal(f.input.sample().fire, true);
    assert.equal(f.input.sample().fire, false);
    f.pointer('click', 2, 'jump');
    assert.equal(f.input.sample().jump, true);
    assert.equal(f.input.sample().jump, false);
    f.input.destroy();
});

test('viewport changes release virtual buttons while preserving a held keyboard or gamepad command', () => {
    const f = touchControls(),
        key = new Event('keydown', { cancelable: true });
    Object.defineProperty(key, 'code', { value: 'Space' });
    f.target.dispatchEvent(key);
    f.pointer('pointerdown', 1, 'left');
    f.target.dispatchEvent(new Event('resize'));
    assert.equal(f.input.sample().fire, true);
    assert.equal(f.input.sample().left, false);
    const up = new Event('keyup');
    Object.defineProperty(up, 'code', { value: 'Space' });
    f.target.dispatchEvent(up);
    const device = pad();
    f.target.navigator.getGamepads = () => [device];
    f.input.pollGamepad();
    device.axes[0] = 0.8;
    f.input.pollGamepad();
    f.target.dispatchEvent(new Event('orientationchange'));
    assert.equal(f.input.sample().right, true);
    f.input.destroy();
});

test('old Safari Touch Events support simultaneous movement/fire, sliding and cancellation', () => {
    const f = touchControls(true);
    f.pointer('touchstart', 10, 'left');
    f.pointer('touchstart', 20, 'fire');
    assert.equal(f.input.sample().left, true);
    assert.equal(f.input.sample().fire, true);
    f.pointer('touchmove', 10, 'right', f.target);
    assert.equal(f.input.sample().right, true);
    assert.equal(f.input.sample().left, false);
    f.pointer('touchend', 20, null, f.target);
    assert.equal(f.input.sample().fire, false);
    f.pointer('touchcancel', 10, null, f.target);
    assert.equal(any(f.input.sample()), false);
    f.pointer('touchstart', 30, 'jump');
    f.pointer('touchend', 30, null, f.target);
    assert.equal(f.input.sample().jump, true);
    assert.equal(f.input.sample().jump, false);
    f.pointer('mousedown', 1, 'fire');
    assert.equal(f.input.sample().fire, false, 'ignore ghost mouse after touch');
    f.input.destroy();
    f.pointer('touchstart', 40, 'fire');
    assert.equal(any(f.input.sample()), false);
});

test('mouse fallback works without Pointer Events and release outside clears a hold', () => {
    const f = touchControls(true);
    f.pointer('mousedown', 1, 'left');
    assert.equal(f.input.sample().left, true);
    f.pointer('mouseup', 1, null, f.target);
    assert.equal(f.input.sample().left, false);
    f.input.destroy();
    f.pointer('mousedown', 1, 'fire');
    assert.equal(f.input.sample().fire, false);
});

test('menu navigation excludes face-button jump and duck aliases', () => {
    const device = pad();
    const input = createGamepadInput({ getGamepads: () => [device] });
    input.poll();
    press(device, 0);
    let state = input.poll();
    assert.deepEqual(state.navigation, { x: 0, y: 0 });
    assert.equal(state.pressed.confirm, true);
    assert.equal(state.commands.jump, true);
    press(device, 0, false);
    press(device, 1);
    state = input.poll();
    assert.deepEqual(state.navigation, { x: 0, y: 0 });
    assert.equal(state.pressed.back, true);
    device.axes = [0.7, -0.8];
    assert.deepEqual(input.poll().navigation, { x: 1, y: -1 });
});

test('preserved controls release keys that became unbound and ordinary configuration still resets them', () => {
    const target = new EventTarget() as InputWindow;
    target.navigator = {};
    const controls = new EventTarget() as InputControls;
    controls.querySelectorAll = () => [];
    const input = createInput(target as unknown as Window, controls as unknown as HTMLElement);
    const key = (type: string) => {
        const event = new Event(type);
        Object.defineProperty(event, 'code', { value: 'KeyZ' });
        target.dispatchEvent(event);
    };
    try {
        input.configure({ keys: { KeyZ: ['fire'] } });
        key('keydown');
        assert.equal(input.sample().fire, true);
        input.configure({ keys: { Space: ['fire'] } }, true);
        key('keyup');
        input.configure({ keys: { KeyZ: ['fire'] } }, true);
        assert.equal(
            input.sample().fire,
            false,
            'Released keys cannot reappear after a mode change',
        );
        key('keydown');
        input.configure({ keys: { KeyZ: ['fire'] } }, true);
        assert.equal(input.sample().fire, true, 'Graphics changes preserve physically held keys');
        input.configure({ keys: { KeyZ: ['fire'] } });
        assert.equal(input.sample().fire, false, 'Normal control configuration clears held input');
    } finally {
        input.destroy();
    }
});
