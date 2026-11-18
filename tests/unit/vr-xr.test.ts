import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BoxGeometry,
    Group,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    PerspectiveCamera,
    Raycaster,
    Scene,
} from 'three';
import { createVrXr } from '../../src/controllers/vr/xr.ts';
import type { createVrView } from '../../src/games/vr/view/index.ts';

class Button extends EventTarget {
    disabled = true;
    textContent = '';
}

function source(handedness: 'left' | 'right') {
    return {
        handedness,
        tracked: true,
        rayX: 0,
        targetRayMode: 'tracked-pointer',
        targetRaySpace: {} as unknown as XRSpace,
        gripSpace: {} as unknown as XRSpace,
        profiles: ['oculus-touch-v3'],
        gamepad: {
            id: 'Quest Touch',
            index: handedness === 'left' ? 0 : 1,
            connected: true,
            timestamp: 0,
            mapping: 'xr-standard',
            axes: [0, 0, 0, 0],
            buttons: Array.from({ length: 6 }, () => ({
                pressed: false,
                touched: false,
                value: 0,
            })),
        },
    };
}

class Session extends EventTarget {
    visibilityState = 'visible';
    ended = false;
    readonly left = source('left');
    readonly right = source('right');
    get inputSources() {
        return [this.left, this.right] as unknown as XRInputSourceArray;
    }
    async end() {
        this.ended = true;
        this.dispatchEvent(new Event('end'));
    }
}

async function flush() {
    await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture({ deferredMount = false, requestError = undefined as Error | undefined } = {}) {
    const button = new Button();
    const status = { textContent: '' };
    const session = new Session();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const controllers = [new Group(), new Group()];
    const panel = new Mesh(new BoxGeometry(1, 1, 0.1), new MeshBasicMaterial());
    scene.add(panel);
    scene.updateMatrixWorld(true);
    const ray = new Raycaster();
    const reference = {} as unknown as XRReferenceSpace;
    const frame = {
        session,
        getViewerPose: () => ({ views: [] }),
        getPose(space: XRSpace, relative: XRSpace) {
            assert.equal(relative, reference);
            const controller = [session.left, session.right].find(
                (item) => item.targetRaySpace === space || item.gripSpace === space,
            );
            // A target ray may still be predicted while its hand/grip pose is lost.
            const tracked = controller && (space !== controller.gripSpace || controller.tracked);
            return tracked
                ? {
                      transform: {
                          matrix: new Matrix4().makeTranslation(controller.rayX, 0, 1).elements,
                      },
                  }
                : null;
        },
    } as unknown as XRFrame;
    let release!: () => void;
    const mount = new Promise<void>((resolve) => {
        release = resolve;
    });
    let mounted = false;
    let pauses = 0;
    const actions: string[] = [];
    const hovered: string[] = [];
    const rendererXr = {
        enabled: false,
        isPresenting: false,
        getController: (index: number) => controllers[index],
        getReferenceSpace: () => reference,
        getSession: () => (mounted && !session.ended ? session : null),
        setReferenceSpaceType(type: string) {
            assert.equal(type, 'local');
        },
        async setSession(value: XRSession) {
            assert.equal(value, session);
            mounted = true;
            if (deferredMount) await mount;
            this.isPresenting = true;
        },
        updateCamera() {},
    };
    const view = {
        scene,
        camera,
        renderer: {
            xr: rendererXr,
            getSize: (target: { set(x: number, y: number): unknown }) => target.set(1100, 720),
            getPixelRatio: () => 1,
            getRenderTarget: () => null,
            setRenderTarget() {},
            setPixelRatio() {},
            setSize() {},
        },
        recenter() {},
        hover(ids: readonly string[]) {
            hovered.splice(0, hovered.length, ...ids);
        },
        pick(origin: Parameters<Raycaster['set']>[0], direction: Parameters<Raycaster['set']>[1]) {
            ray.set(origin, direction);
            return ray.intersectObject(panel).length ? 'start' : undefined;
        },
    } as unknown as ReturnType<typeof createVrView>;
    const window = Object.assign(new EventTarget(), {
        isSecureContext: true,
        navigator: {
            xr: {
                async isSessionSupported(mode: string) {
                    assert.equal(mode, 'immersive-vr');
                    return true;
                },
                async requestSession(mode: string) {
                    assert.equal(mode, 'immersive-vr');
                    if (requestError) throw requestError;
                    return session;
                },
            },
        },
    }) as unknown as Window & typeof globalThis;
    const xr = createVrXr({
        window,
        view,
        button: button as unknown as HTMLButtonElement,
        status: status as unknown as HTMLElement,
        pause() {
            pauses++;
        },
        changed() {},
        action(id) {
            actions.push(id);
        },
    });
    function trigger(pressed: boolean) {
        session.right.gamepad.buttons[0].pressed = pressed;
        session.right.gamepad.buttons[0].value = Number(pressed);
    }
    function select() {
        session.dispatchEvent(
            Object.assign(new Event('selectstart'), { frame, inputSource: session.right }),
        );
    }
    async function enter() {
        await flush();
        assert.equal(button.disabled, false, 'Capability detection enables immersive entry');
        button.dispatchEvent(new Event('click'));
        await flush();
    }
    let destroyed = false;
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        xr.destroy();
        panel.geometry.dispose();
        panel.material.dispose();
    }
    return {
        xr,
        button,
        status,
        session,
        frame,
        actions,
        hovered,
        trigger,
        select,
        enter,
        destroy,
        release,
        get pauses() {
            return pauses;
        },
        get mounted() {
            return mounted;
        },
    };
}

test('XR rays highlight menu actions before selection and clear on miss, tracking loss, visibility loss and exit', async () => {
    const app = fixture();
    try {
        await app.enter();
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, ['start']);
        assert.deepEqual(app.actions, [], 'Hovering does not activate an action');
        app.session.left.rayX = 2;
        app.session.right.rayX = 2;
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, [], 'Pointing away clears the highlight');
        app.session.left.rayX = 0;
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, ['start'], 'Either controller can highlight an action');
        app.session.left.tracked = false;
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, [], 'A predicted ray cannot preserve an untracked highlight');
        app.session.left.tracked = true;
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, [], 'The tracking transition keeps input cleared');
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, ['start']);
        app.session.visibilityState = 'hidden';
        app.session.dispatchEvent(new Event('visibilitychange'));
        assert.deepEqual(app.hovered, [], 'Visibility loss clears hover without another frame');
        app.session.visibilityState = 'visible';
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, ['start']);
        app.xr.reset();
        assert.deepEqual(app.hovered, []);
        app.xr.sample(app.frame);
        assert.deepEqual(app.hovered, ['start']);
        await app.xr.exit();
        assert.deepEqual(app.hovered, []);
    } finally {
        app.destroy();
    }
});

test('XR selectstart requires neutral, consumes once and rearms after reset and visibility loss', async () => {
    const app = fixture();
    try {
        app.trigger(true);
        await app.enter();
        assert.equal(app.xr.active, app.session);
        app.select();
        assert.deepEqual(app.actions, [], 'A held entry trigger cannot start the next panel');
        app.trigger(false);
        app.xr.sample(app.frame);
        app.trigger(true);
        app.select();
        app.select();
        assert.deepEqual(app.actions, ['start'], 'One neutral-armed press activates one panel');
        assert.equal(
            Boolean(app.xr.sample(app.frame).fire),
            false,
            'Menu action consumes gameplay fire',
        );
        assert.equal(
            Boolean(app.xr.consumeCommands().rocket),
            false,
            'Menu selection consumes the trigger rocket',
        );
        app.xr.reset();
        app.select();
        assert.deepEqual(app.actions, ['start']);
        app.trigger(false);
        app.xr.sample(app.frame);
        app.trigger(true);
        app.select();
        assert.deepEqual(app.actions, ['start', 'start']);
        app.trigger(false);
        app.xr.sample(app.frame);
        const before = app.pauses;
        app.session.visibilityState = 'hidden';
        app.session.dispatchEvent(new Event('visibilitychange'));
        assert.ok(app.pauses > before, 'Visibility loss pauses without requiring another frame');
        app.session.visibilityState = 'visible';
        app.session.dispatchEvent(new Event('visibilitychange'));
        app.trigger(true);
        app.select();
        assert.deepEqual(
            app.actions,
            ['start', 'start'],
            'Visibility recovery requires fresh neutral input',
        );
        app.trigger(false);
        app.xr.sample(app.frame);
        app.trigger(true);
        app.select();
        assert.deepEqual(app.actions, ['start', 'start', 'start']);
    } finally {
        app.destroy();
    }
});

test('XR listed-hand pose loss pauses and clears movement/fire despite a valid viewer pose', async () => {
    const app = fixture();
    try {
        await app.enter();
        app.xr.sample(app.frame);
        app.session.left.gamepad.axes[2] = -0.9;
        app.trigger(true);
        const moving = app.xr.sample(app.frame);
        assert.equal(moving.left, true);
        assert.equal(moving.rocket, true);
        assert.equal(moving.fire, false);
        const before = app.pauses;
        app.session.right.tracked = false;
        app.select();
        assert.deepEqual(app.actions, [], 'A valid target ray cannot bypass a missing hand pose');
        const lost = app.xr.sample(app.frame);
        assert.ok(app.pauses > before, 'A listed controller with no pose pauses gameplay');
        assert.equal(Boolean(lost.left), false);
        assert.equal(Boolean(lost.fire), false);
        assert.equal(Boolean(app.xr.consumeCommands().rocket), false);
        app.select();
        assert.deepEqual(app.actions, [], 'An untracked controller cannot activate a menu');
        app.session.right.tracked = true;
        assert.equal(
            Boolean(app.xr.sample(app.frame).rocket),
            false,
            'Held trigger stays blocked after tracking recovery',
        );
        app.select();
        assert.deepEqual(app.actions, []);
        app.session.left.gamepad.axes[2] = 0;
        app.trigger(false);
        app.xr.sample(app.frame);
        app.trigger(true);
        assert.equal(app.xr.sample(app.frame).rocket, true);
    } finally {
        app.destroy();
    }
});

test('XR adapter disposal ends a granted session before deferred renderer mount resolves', async () => {
    const app = fixture({ deferredMount: true });
    try {
        await app.enter();
        assert.equal(app.mounted, true);
        assert.equal(app.xr.active, null);
        app.destroy();
        assert.equal(
            app.session.ended,
            true,
            'Disposal releases the granted headset session immediately',
        );
        app.release();
        await flush();
        assert.equal(app.xr.active, null);
        app.select();
        assert.deepEqual(app.actions, []);
    } finally {
        app.release();
        app.destroy();
    }
});

test('Quest A confirms, B fires without pausing and left Y pauses while grips are held', async () => {
    const app = fixture();
    try {
        await app.enter();
        for (const source of [app.session.left, app.session.right]) {
            source.gamepad.buttons[1].pressed = true;
            source.gamepad.buttons[1].value = 1;
        }
        app.xr.sample(app.frame);
        app.session.right.gamepad.buttons[4].pressed = true;
        app.xr.sample(app.frame);
        app.xr.sample(app.frame);
        assert.deepEqual(app.actions, ['confirm']);
        app.session.right.gamepad.buttons[4].pressed = false;
        app.xr.sample(app.frame);
        app.session.right.gamepad.buttons[5].pressed = true;
        assert.equal(app.xr.sample(app.frame).fire, true);
        assert.deepEqual(app.actions, ['confirm'], 'Right B is not a pause action');
        app.session.left.gamepad.buttons[5].pressed = true;
        app.xr.sample(app.frame);
        app.xr.sample(app.frame);
        assert.deepEqual(app.actions, ['confirm', 'toggle-pause']);
    } finally {
        app.destroy();
    }
});

test('XR rejection explicitly identifies preview mode and preserves the browser error name', async () => {
    const app = fixture({ requestError: new DOMException('Denied', 'NotAllowedError') });
    try {
        await app.enter();
        assert.equal(app.xr.active, null);
        assert.equal(app.button.disabled, false, 'Retry remains available');
        assert.match(app.status.textContent, /NotAllowedError/);
        assert.match(app.status.textContent, /flat browser preview/);
    } finally {
        app.destroy();
    }
});
