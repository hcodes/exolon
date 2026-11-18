import {
    BufferGeometry,
    Float32BufferAttribute,
    Line,
    LineBasicMaterial,
    Matrix4,
    Vector2,
    Vector3,
} from 'three';
import type { createVrView } from '../../games/vr/view/index.ts';
import type { InputCommands } from '../../types/game.ts';
import { createEventScope } from '../../lib/events.ts';
import { createXrInput } from './input.ts';
import type { XrControllerSource } from './input.ts';
import { createXrSessionControl } from './xr-session.ts';

export function createVrXr({
    window,
    view,
    button,
    status,
    pause,
    changed,
    action,
}: {
    window: Window & typeof globalThis;
    view: ReturnType<typeof createVrView>;
    button: HTMLButtonElement;
    status: HTMLElement;
    pause(): void;
    changed(): void;
    action(id: string): void;
}) {
    const events = createEventScope(window);
    let sessionEvents = createEventScope(window);
    const input = createXrInput();
    let disposed = false;
    let supported = false;
    let entering = false;
    let recenterPending = false;
    let restorePreviewPending = false;
    let previewSnapshot:
        | {
              size: Vector2;
              pixelRatio: number;
              target: ReturnType<typeof view.renderer.getRenderTarget>;
          }
        | undefined;
    const matrix = new Matrix4(),
        origin = new Vector3(),
        direction = new Vector3();
    const rayGeometry = new BufferGeometry();
    rayGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -3], 3));
    const rayMaterial = new LineBasicMaterial({ color: 0x94f3db, transparent: true, opacity: 0.5 });
    const controllers = [0, 1].map((index) => {
        const group = view.renderer.xr.getController(index);
        group.add(new Line(rayGeometry, rayMaterial));
        group.visible = false;
        view.scene.add(group);
        return group;
    });
    function updateButton() {
        if (disposed) return;
        button.disabled = !supported || entering;
        button.textContent = control.active ? 'Exit VR' : entering ? 'Entering VR…' : 'Enter VR';
    }
    const control = createXrSessionControl<XRSession>({
        request() {
            const system = window.navigator.xr;
            if (!system) return Promise.reject(new Error('WebXR unavailable'));
            return system.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
        },
        async mount(session) {
            if (disposed) return;
            previewSnapshot = {
                size: view.renderer.getSize(new Vector2()),
                pixelRatio: view.renderer.getPixelRatio(),
                target: view.renderer.getRenderTarget(),
            };
            view.renderer.xr.enabled = true;
            view.renderer.xr.setReferenceSpaceType('local');
            await view.renderer.xr.setSession(session);
        },
        onSetupCancelled() {
            if (disposed || !previewSnapshot || view.renderer.xr.getSession() !== null) return;
            // Three 0.187 may finish setSession after its end listener has run.
            // Restore the preview after that async setup settles, including the
            // early makeXRCompatible path that can otherwise restore a 0×0 size.
            view.renderer.xr.isPresenting = false;
            view.renderer.setRenderTarget(previewSnapshot.target);
            view.renderer.setPixelRatio(previewSnapshot.pixelRatio);
            view.renderer.setSize(previewSnapshot.size.x, previewSnapshot.size.y, false);
            previewSnapshot = undefined;
            restorePreviewPending = true;
            status.textContent =
                'VR setup ended. This is the 3D browser preview. Select Enter VR to retry.';
            changed();
        },
        onSession(session) {
            sessionEvents.destroy();
            sessionEvents = createEventScope(window);
            input.reset();
            if (disposed) return;
            view.hover([]);
            for (const controller of controllers) controller.visible = Boolean(session);
            recenterPending = Boolean(session);
            restorePreviewPending = !session;
            if (session) {
                sessionEvents.on(session, 'selectstart', handleSelect);
                status.textContent =
                    'VR ready · Left stick: move / jump / crouch · Right trigger: rocket · B: bullets · A: jump · Left Y: pause';
            } else {
                status.textContent = 'VR ended. Your game is paused in the 3D preview.';
            }
            updateButton();
            changed();
        },
        onPause() {
            input.reset();
            view.hover([]);
            pause();
        },
        onError(error) {
            if (disposed) return;
            const reason = error instanceof Error ? error.name : 'UnknownError';
            status.textContent = `Could not enter VR (${reason}). This is still the flat browser preview. Allow the headset request and select Enter VR to retry.`;
            changed();
        },
    });
    function handleSelect(raw: Event) {
        if (disposed || !control.active) return;
        const event = raw as XRInputSourceEvent;
        const space = view.renderer.xr.getReferenceSpace();
        if (!space) return;
        const pose = event.frame.getPose(event.inputSource.targetRaySpace, space);
        if (!pose) return;
        matrix.fromArray(pose.transform.matrix);
        origin.setFromMatrixPosition(matrix);
        direction.set(0, 0, -1).transformDirection(matrix);
        const id = view.pick(origin, direction);
        if (id && input.consumeSelect(trackedSources(event.frame))) {
            action(id);
        }
    }
    function trackedSources(frame: XRFrame): XrControllerSource[] {
        const space = view.renderer.xr.getReferenceSpace();
        return [...(control.active?.inputSources ?? [])].map((source) => ({
            handedness: source.handedness,
            gamepad: source.gamepad,
            tracked: Boolean(
                space && frame.getPose(source.gripSpace ?? source.targetRaySpace, space),
            ),
        }));
    }
    async function detect() {
        try {
            supported = Boolean(
                window.isSecureContext &&
                (await window.navigator.xr?.isSessionSupported('immersive-vr')),
            );
        } catch {
            supported = false;
        }
        if (disposed) return;
        if (!supported) {
            status.textContent = window.isSecureContext
                ? '3D preview · Immersive VR is unavailable in this browser. Open this page in Meta Quest Browser to enter VR.'
                : '3D preview · Open this page over HTTPS in Meta Quest Browser to enter VR.';
        } else
            status.textContent =
                '3D browser preview · Select Enter VR below to enable stereo depth and Quest controllers.';
        updateButton();
    }
    async function toggle() {
        if (disposed || entering) return;
        if (control.active) {
            await control.exit();
            return;
        }
        if (!supported) return;
        entering = true;
        pause();
        status.textContent = 'Entering immersive VR… Confirm the request in your headset.';
        updateButton();
        await control.enter();
        entering = false;
        updateButton();
    }
    function handleToggle() {
        void toggle();
    }
    events.on(button, 'click', handleToggle);
    function handlePageHide() {
        void control.exit();
    }
    events.on(window, 'pagehide', handlePageHide);
    void detect();
    return {
        get active() {
            return control.active;
        },
        reset() {
            input.reset();
            view.hover([]);
        },
        consumeCommands: input.consumeCommands,
        async exit() {
            await control.exit();
        },
        sample(frame: XRFrame | undefined): InputCommands {
            const session = control.active;
            if (!session) {
                if (restorePreviewPending && !view.renderer.xr.isPresenting) {
                    view.recenter();
                    restorePreviewPending = false;
                }
                return {};
            }
            const space = view.renderer.xr.getReferenceSpace();
            if (
                !frame ||
                !space ||
                !frame.getViewerPose(space) ||
                session.visibilityState !== 'visible'
            ) {
                pause();
                input.reset();
                view.hover([]);
                return {};
            }
            if (recenterPending) {
                view.renderer.xr.updateCamera(view.camera);
                view.recenter();
                recenterPending = false;
            }
            const sources = trackedSources(frame);
            const sampled = input.sample(sources);
            if (sampled.lost || !sampled.connected) {
                view.hover([]);
                pause();
            } else {
                const hovered: string[] = [];
                for (const [index, source] of [...session.inputSources].entries()) {
                    if (!sources[index].tracked) continue;
                    const pose = frame.getPose(source.targetRaySpace, space);
                    if (!pose) continue;
                    matrix.fromArray(pose.transform.matrix);
                    origin.setFromMatrixPosition(matrix);
                    direction.set(0, 0, -1).transformDirection(matrix);
                    const id = view.pick(origin, direction);
                    if (id && !hovered.includes(id)) hovered.push(id);
                }
                view.hover(hovered);
                if (sampled.pause) action('toggle-pause');
                else if (sampled.confirm) action('confirm');
            }
            return sampled.commands;
        },
        async destroy() {
            disposed = true;
            const teardown = control.destroy();
            events.destroy();
            sessionEvents.destroy();
            for (const controller of controllers) {
                controller.removeFromParent();
                controller.clear();
            }
            rayGeometry.dispose();
            rayMaterial.dispose();
            await teardown;
        },
    };
}
