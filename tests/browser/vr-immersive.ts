import { openHome } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';

// A deterministic WebXR transport with real WebGL/Three.js rendering. This
// exercises the session boundary and Touch input, not physical headset tracking.
async function installImmersiveSession(page: Page, deferred?: 'reference' | 'compatibility') {
    await page.addInitScript((deferred) => {
        let setupWaiting = false;
        let releaseSetup = () => {};
        function waitForSetup() {
            setupWaiting = true;
            return new Promise<void>((resolve) => {
                releaseSetup = resolve;
            });
        }
        function matrix(x = 0, y = 0, z = 0) {
            return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
        }
        function source(handedness: string) {
            return {
                handedness,
                profiles: ['oculus-touch-v3'],
                targetRayMode: 'tracked-pointer',
                targetRaySpace: {},
                gripSpace: {},
                tracked: true,
                gamepad: {
                    mapping: 'xr-standard',
                    axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 6 }, (_, index) => ({
                        // Users naturally hold the grip while operating Touch.
                        pressed: index === 1,
                        touched: false,
                        value: index === 1 ? 1 : 0,
                    })),
                },
            };
        }
        const left = source('left'),
            right = source('right');
        let context: WebGL2RenderingContext | undefined;
        let framebuffer: WebGLFramebuffer | null = null;
        let requests = 0;
        let userGesture = false;
        class Session extends EventTarget {
            visibilityState = 'visible';
            inputSources = [left, right];
            enabledFeatures: string[] = [];
            environmentBlendMode = 'opaque';
            renderState = { depthNear: 0.02, depthFar: 40 };
            ended = false;
            async requestReferenceSpace(type: string) {
                if (type !== 'local') throw new Error('Unexpected reference space');
                if (deferred === 'reference') await waitForSetup();
                return new EventTarget();
            }
            updateRenderState(state: object) {
                Object.assign(this.renderState, state);
            }
            requestAnimationFrame(callback: (time: number, frame: unknown) => void) {
                return window.requestAnimationFrame((time) => {
                    if (!this.ended) callback(time, frame);
                });
            }
            cancelAnimationFrame(id: number) {
                window.cancelAnimationFrame(id);
            }
            async end() {
                this.ended = true;
                this.dispatchEvent(new Event('end'));
            }
        }
        const session = new Session();
        const near = 0.02,
            far = 40;
        const projection = new Float32Array([
            1.5,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            -(far + near) / (far - near),
            -1,
            0,
            0,
            (-2 * far * near) / (far - near),
            0,
        ]);
        const frame = {
            session,
            getViewerPose() {
                return {
                    views: [-0.032, 0.032].map((x, index) => ({
                        eye: index === 0 ? 'left' : 'right',
                        transform: { matrix: matrix(x, 1.6, 0) },
                        projectionMatrix: projection,
                    })),
                };
            },
            getPose(space: object) {
                const source = [left, right].find(
                    (source) => source.targetRaySpace === space || source.gripSpace === space,
                );
                return source?.tracked
                    ? { transform: { matrix: matrix(source === left ? -0.3 : 0.3, 1.2, -0.4) } }
                    : null;
            },
        };
        class Layer {
            framebufferWidth = 1024;
            framebufferHeight = 768;
            framebuffer: WebGLFramebuffer | null;
            ignoreDepthValues = false;
            fixedFoveation = 0;
            constructor(_session: unknown, gl: WebGL2RenderingContext) {
                context = gl;
                framebuffer = gl.createFramebuffer();
                this.framebuffer = framebuffer;
                const previous = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
                gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                const texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA,
                    1024,
                    768,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    null,
                );
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.framebufferTexture2D(
                    gl.FRAMEBUFFER,
                    gl.COLOR_ATTACHMENT0,
                    gl.TEXTURE_2D,
                    texture,
                    0,
                );
                const depth = gl.createRenderbuffer();
                gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 1024, 768);
                gl.framebufferRenderbuffer(
                    gl.FRAMEBUFFER,
                    gl.DEPTH_ATTACHMENT,
                    gl.RENDERBUFFER,
                    depth,
                );
                gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
            }
            getViewport(view: { eye: string }) {
                return { x: view.eye === 'left' ? 0 : 512, y: 0, width: 512, height: 768 };
            }
        }
        Object.defineProperty(window, 'XRWebGLBinding', { configurable: true, value: undefined });
        Object.defineProperty(window, 'XRWebGLLayer', { configurable: true, value: Layer });
        Object.defineProperty(WebGL2RenderingContext.prototype, 'makeXRCompatible', {
            configurable: true,
            value: () => (deferred === 'compatibility' ? waitForSetup() : Promise.resolve()),
        });
        Object.defineProperty(navigator, 'xr', {
            configurable: true,
            value: Object.assign(new EventTarget(), {
                isSessionSupported: () => Promise.resolve(true),
                requestSession(mode: string) {
                    if (mode !== 'immersive-vr') throw new Error('Expected immersive VR');
                    requests++;
                    userGesture = navigator.userActivation?.isActive ?? true;
                    return Promise.resolve(session);
                },
            }),
        });
        Object.assign(window, {
            __immersiveTest: {
                session,
                get setupWaiting() {
                    return setupWaiting;
                },
                releaseSetup() {
                    releaseSetup();
                },
                left,
                right,
                get requests() {
                    return requests;
                },
                get userGesture() {
                    return userGesture;
                },
                stereo() {
                    const gl = context!;
                    const previous = gl.getParameter(
                        gl.FRAMEBUFFER_BINDING,
                    ) as WebGLFramebuffer | null;
                    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
                    const pixels = new Uint8Array(1024 * 768 * 4);
                    gl.readPixels(0, 0, 1024, 768, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                    gl.bindFramebuffer(gl.FRAMEBUFFER, previous);
                    let different = 0,
                        leftLit = 0,
                        rightLit = 0;
                    for (let y = 0; y < 768; y += 3)
                        for (let x = 0; x < 512; x += 3) {
                            const l = (y * 1024 + x) * 4,
                                r = l + 512 * 4;
                            if (pixels[l] > 50 || pixels[l + 1] > 50 || pixels[l + 2] > 50)
                                leftLit++;
                            if (pixels[r] > 50 || pixels[r + 1] > 50 || pixels[r + 2] > 50)
                                rightLit++;
                            if (
                                Math.abs(pixels[l] - pixels[r]) +
                                    Math.abs(pixels[l + 1] - pixels[r + 1]) +
                                    Math.abs(pixels[l + 2] - pixels[r + 2]) >
                                25
                            )
                                different++;
                        }
                    return { different, leftLit, rightLit };
                },
            },
        });
    }, deferred);
}

declare global {
    interface Window {
        __immersiveTest: {
            requests: number;
            userGesture: boolean;
            left: {
                tracked: boolean;
                gamepad: { axes: number[]; buttons: { pressed: boolean; value: number }[] };
            };
            right: { gamepad: { buttons: { pressed: boolean; value: number }[] } };
            session: EventTarget & {
                visibilityState: string;
                ended: boolean;
                end(): Promise<void>;
            };
            setupWaiting: boolean;
            releaseSetup(): void;
            stereo(): { different: number; leftLit: number; rightLit: number };
        };
    }
}

async function button(
    page: Page,
    index: number,
    pressed: boolean,
    handedness: 'left' | 'right' = 'right',
) {
    await page.evaluate(
        ({ index, pressed, handedness }) => {
            const button = window.__immersiveTest[handedness].gamepad.buttons[index];
            button.pressed = pressed;
            button.value = Number(pressed);
        },
        { index, pressed, handedness },
    );
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );
}

export async function checkVrImmersive(browser: Browser, name: string) {
    const page = await browser.newPage();
    await installImmersiveSession(page);
    await page.addInitScript(() => {
        localStorage.setItem('exolon-vr-cheats', JSON.stringify({ invulnerable: true }));
    });
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
        await page.goto('http://127.0.0.1:8091/?game=vr');
        await page.locator('[data-platform="vr"][aria-disabled="false"]').focus();
        await page.keyboard.press('Enter');
        await page.locator('#game[data-ready="true"]').waitFor();
        assert.equal(await page.locator('#settings-panel').isHidden(), true);
        assert.equal(
            await page.locator('#vr-enter').isVisible(),
            true,
            'Immersive entry survives default collapsed settings',
        );
        assert.match((await page.locator('#vr-status').textContent())!, /3D browser preview/);
        await page.locator('#vr-enter').focus();
        await page.keyboard.press('Enter');
        await page.locator('#game[data-xr="immersive"]').waitFor();
        assert.equal(await page.locator('#vr-enter').textContent(), 'Exit VR');
        assert.equal(await page.evaluate(() => window.__immersiveTest.requests), 1);
        assert.equal(await page.evaluate(() => window.__immersiveTest.userGesture), true);
        await button(page, 4, false);
        const stereo = await page.evaluate(() => window.__immersiveTest.stereo());
        assert.ok(
            stereo.leftLit > 150 && stereo.rightLit > 150 && stereo.different > 150,
            `${name} real stereo render: ${JSON.stringify(stereo)}`,
        );
        await button(page, 4, true);
        await page.locator('#game[data-mode="playing"]').waitFor();
        await button(page, 4, false);
        const ammo = Number(await page.locator('#game').getAttribute('data-ammo'));
        const rockets = Number(await page.locator('#game').getAttribute('data-grenades'));
        await button(page, 5, true);
        await page.waitForFunction(
            (ammo) => Number(document.getElementById('game')?.dataset.ammo) < ammo,
            ammo,
        );
        const fireTick = Number(await page.locator('#game').getAttribute('data-tick'));
        await page.waitForFunction(
            (tick) => Number(document.getElementById('game')?.dataset.tick) >= tick + 18,
            fireTick,
        );
        assert.equal(
            await page.locator('#game').getAttribute('data-mode'),
            'playing',
            'B never pauses',
        );
        assert.equal(
            Number(await page.locator('#game').getAttribute('data-grenades')),
            rockets,
            'Holding B cannot charge a rocket',
        );
        await button(page, 5, false);
        const afterBullet = Number(await page.locator('#game').getAttribute('data-ammo'));
        await button(page, 0, true);
        await page.waitForFunction(
            (rockets) => Number(document.getElementById('game')?.dataset.grenades) === rockets - 1,
            rockets,
        );
        const rocketTick = Number(await page.locator('#game').getAttribute('data-tick'));
        await page.waitForFunction(
            (tick) => Number(document.getElementById('game')?.dataset.tick) >= tick + 36,
            rocketTick,
        );
        assert.equal(
            Number(await page.locator('#game').getAttribute('data-grenades')),
            rockets - 1,
            'Holding the trigger does not repeat rockets',
        );
        assert.equal(
            Number(await page.locator('#game').getAttribute('data-ammo')),
            afterBullet,
            'The trigger spends no bullets',
        );
        await button(page, 0, false);
        await button(page, 5, true, 'left');
        await page.locator('#game[data-mode="paused"]').waitFor();
        await button(page, 5, false, 'left');
        await button(page, 5, true, 'left');
        await page.locator('#game[data-mode="playing"]').waitFor();
        await button(page, 5, false, 'left');
        await page.evaluate(() => {
            window.__immersiveTest.left.tracked = false;
        });
        await page.locator('#game[data-mode="paused"]').waitFor();
        await page.evaluate(() => {
            window.__immersiveTest.left.tracked = true;
        });
        await button(page, 4, false);
        await button(page, 4, true);
        await page.locator('#game[data-mode="playing"]').waitFor();
        await button(page, 4, false);
        await page.evaluate(() => {
            const session = window.__immersiveTest.session;
            session.visibilityState = 'visible-blurred';
            session.dispatchEvent(new Event('visibilitychange'));
        });
        await page.locator('#game[data-mode="paused"]').waitFor();
        await page.evaluate(() => {
            const session = window.__immersiveTest.session;
            session.visibilityState = 'visible';
            session.dispatchEvent(new Event('visibilitychange'));
        });
        await button(page, 4, false);
        assert.equal(await page.locator('#game').getAttribute('data-mode'), 'paused');
        await page.locator('#vr-enter').focus();
        await page.keyboard.press('Enter');
        await page.locator('#game[data-xr="preview"][data-mode="paused"]').waitFor();
        assert.equal(await page.evaluate(() => window.__immersiveTest.session.ended), true);
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} real Three.js stereo session, visible entry, Quest grip/A/B/trigger input, tracking/visibility pause and immersive exit. Test transport does not establish physical headset behavior.`,
        );
    } finally {
        await page.close();
    }
    await checkVrCancelledSetup(browser, name);
}

export async function checkVrCancelledSetup(browser: Browser, name: string) {
    for (const deferred of ['reference', 'compatibility'] as const) {
        const page = await browser.newPage();
        await installImmersiveSession(page, deferred);
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        try {
            await page.goto('http://127.0.0.1:8091/?game=vr');
            await page.locator('[data-platform="vr"][aria-disabled="false"]').focus();
            await page.keyboard.press('Enter');
            await page.locator('#game[data-ready="true"]').waitFor();
            await page.locator('#vr-enter:not([disabled])').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => window.__immersiveTest.setupWaiting);
            await page.evaluate(async () => {
                await window.__immersiveTest.session.end();
                window.__immersiveTest.releaseSetup();
            });
            await page.locator('#vr-enter:not([disabled])').waitFor();
            await page.locator('#settings-toggle').focus();
            await page.keyboard.press('Enter');
            await openHome(page);
            await page.locator('#new-game').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(
                () => Number(document.getElementById('game')?.dataset.tick) > 2,
                undefined,
                { timeout: 5000 },
            );
            assert.equal(await page.locator('#game').getAttribute('data-xr'), 'preview');
            const size = await page.locator('#game').evaluate((canvas) => ({
                width: (canvas as HTMLCanvasElement).width,
                height: (canvas as HTMLCanvasElement).height,
            }));
            assert.ok(size.width > 200 && size.height > 100);
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} real Three.js cancellation during reference-space and WebGL compatibility setup restores the running preview.`,
    );
}
