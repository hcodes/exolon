import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { serveReferenceModules } from './reference-mode.ts';

const PS4_UA = 'Mozilla/5.0 (PlayStation 4 11.00) AppleWebKit/605.1.15 (KHTML, like Gecko)';

async function arrow(page: Page, key: string, type = 'keydown') {
    return page.evaluate(
        ({ key, type }) => {
            const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
            (document.activeElement || document).dispatchEvent(event);
            return event.defaultPrevented;
        },
        { key, type },
    );
}

async function cross(page: Page) {
    await page.mouse.down();
    await page.mouse.up();
}

async function ammunition(page: Page, native: boolean) {
    return page.evaluate((native) => {
        if (!native) return document.getElementById('ammo')!.textContent;
        return Array.from(
            (document.getElementById('game') as HTMLCanvasElement)
                .getContext('2d')!
                .getImageData(24, 193, 16, 7).data,
        ).join(',');
    }, native);
}

async function checkSlowRemastered(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({ userAgent: PS4_UA });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
        await page.addInitScript(() => {
            localStorage.setItem('exolon-cheats', JSON.stringify({ invulnerable: true }));
            Object.defineProperty(navigator, 'getGamepads', { value: undefined });
            const request = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = function (callback) {
                return request(function (now) {
                    if (document.documentElement.dataset.ps4Slow === 'true') {
                        window.setTimeout(function () {
                            const root = document.documentElement;
                            root.dataset.ps4Frames = String(
                                Number(root.dataset.ps4Frames || 0) + 1,
                            );
                            callback(performance.now());
                        }, 300);
                    } else callback(now);
                });
            };
        });
        try {
            await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            await page.locator('[data-platform="remastered"]').focus();
            await cross(page);
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await page.locator('#game').focus();
            await cross(page);
            await page.locator('#title-screen').waitFor({ state: 'hidden' });
            await page.evaluate(() => {
                document.documentElement.dataset.ps4Slow = 'true';
            });
            await page.waitForFunction(
                () => Number(document.documentElement.dataset.ps4Frames) >= 5,
            );
            assert.equal(
                await page.locator('#pause').getAttribute('aria-pressed'),
                'false',
                `${name} PS4 legacy=${legacy}: repeated 300ms frames must not auto-pause Remastered`,
            );
            const ammo = await ammunition(page, false);
            await page.mouse.down();
            await page.waitForFunction(
                (before) => document.getElementById('ammo')!.textContent !== before,
                ammo,
            );
            await page.mouse.up();
            await page.locator('#game').press('Pause');
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
            await cross(page);
            const frames = await page.evaluate(() =>
                Number(document.documentElement.dataset.ps4Frames),
            );
            await page.waitForFunction(
                (before) => Number(document.documentElement.dataset.ps4Frames) >= before + 3,
                frames,
            );
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
            await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
            await page.evaluate(() => {
                Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                document.dispatchEvent(new Event('visibilitychange'));
            });
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(`PASS: ${name} PS4 slow Remastered, simulation, Cross resume and activity pause.`);
}

async function checkDirectionalJump(browser: Browser) {
    const page = await browser.newPage({ userAgent: PS4_UA });
    await serveReferenceModules(page);
    await page.route('http://127.0.0.1:8091/ps4-input-check', (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<div id="shell"><canvas id="game" tabindex="0"></canvas><div id="controls"></div></div>',
        }),
    );
    try {
        await page.goto('http://127.0.0.1:8091/ps4-input-check');
        const jumps = await page.evaluate(async () => {
            const [{ createInput }, { createTvController }, { createState, step }] =
                await Promise.all([
                    import(new URL('./input/index.js', document.baseURI).href) as Promise<
                        typeof import('../../src/input/index.ts')
                    >,
                    import(new URL('./controllers/tv.js', document.baseURI).href) as Promise<
                        typeof import('../../src/controllers/tv.ts')
                    >,
                    import(new URL('./model/state.js', document.baseURI).href) as Promise<
                        typeof import('../../src/model/state.ts')
                    >,
                ]);
            const canvas = document.getElementById('game') as HTMLCanvasElement;
            const input = createInput(window, document.getElementById('controls')!);
            const controller = createTvController({
                enabled: false,
                shell: document.getElementById('shell')!,
                canvas,
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
                canvas.dispatchEvent(
                    new KeyboardEvent(type, { key, bubbles: true, cancelable: true }),
                );
            }
            canvas.focus();
            try {
                return ['ArrowLeft', 'ArrowRight'].map((direction) => {
                    let state = createState({
                        id: 0,
                        placements: [],
                        actions: [],
                        tiles: Array.from({ length: 768 }, (_, i) =>
                            i >= 576 ? { collision: 1, block: 33 } : null,
                        ),
                    });
                    key(direction);
                    state = step(state, input.sample()).state;
                    key(direction, 'keyup');
                    state = step(state, input.sample()).state;
                    key('ArrowUp');
                    for (let tick = 0; tick < 3; tick++) state = step(state, input.sample()).state;
                    key('ArrowUp', 'keyup');
                    const released = input.sample();
                    return {
                        dx: Math.sign(state.player.x - 16),
                        airborne: state.player.y < 112,
                        released: !released.left && !released.right && !released.jump,
                    };
                });
            } finally {
                controller.destroy();
                input.destroy();
            }
        });
        assert.deepEqual(
            jumps,
            [
                { dx: -1, airborne: true, released: true },
                { dx: 1, airborne: true, released: true },
            ],
            'PS4 key-only serial arrows must produce real left/right jumps after an idle step',
        );
    } finally {
        await page.close();
    }
}

export async function checkPs4(browser: Browser, name: string) {
    await checkSlowRemastered(browser, name);
    await checkDirectionalJump(browser);
    for (const legacy of [false, true]) {
        for (const platform of ['remastered', 'retro', 'amiga', 'atari-st']) {
            const native = platform === 'amiga' || platform === 'atari-st';
            const page = await browser.newPage({ userAgent: PS4_UA });
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            page.setDefaultTimeout(12000);
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.addInitScript(() =>
                Object.defineProperty(navigator, 'getGamepads', { value: undefined }),
            );
            try {
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                const banner = page.locator(`[data-platform="${platform}"]`);
                await banner.waitFor();
                if (platform === 'remastered') {
                    await page.locator('#fullscreen').focus();
                    await page.keyboard.press('Enter');
                    await page.waitForFunction(
                        () =>
                            document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                                'true' &&
                            !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                    );
                    await page.locator('#fullscreen').focus();
                    await page.keyboard.press('Enter');
                    await page.waitForFunction(
                        () =>
                            document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                                'false' &&
                            !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                    );
                }
                await banner.focus();
                await arrow(page, 'ArrowRight');
                await arrow(page, 'ArrowRight', 'keyup');
                assert.equal(
                    await banner.evaluate((element) => element === document.activeElement),
                    false,
                    'PS4 event.key navigates the picker without event.code',
                );
                if (platform === 'remastered') {
                    await banner.focus();
                    await cross(page);
                } else {
                    await page.locator('[data-platform="cpc"]').focus();
                    await banner.dispatchEvent('mousedown', { button: 0 });
                    await banner.dispatchEvent('mouseup', { button: 0 });
                }
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                assert.equal(
                    native
                        ? await page.locator('#game').getAttribute('data-game')
                        : await page.locator('#graphics-mode').inputValue(),
                    platform,
                    'Cross selects the targeted banner even when another banner has focus',
                );
                await page.locator('#game').focus();
                await cross(page);
                if (native)
                    await page.waitForFunction(
                        () => document.getElementById('game')?.dataset.menu === 'playing',
                    );
                else
                    await page.waitForFunction(
                        () => document.getElementById('title-screen')!.hidden,
                    );
                await page.waitForTimeout(150);
                const ammo = await ammunition(page, native);
                if (!native) assert.equal(ammo, '99', 'Starting with X must not also fire');
                await page.mouse.down();
                await page.waitForFunction(
                    ({ before, native }) => {
                        const current = native
                            ? Array.from(
                                  (document.getElementById('game') as HTMLCanvasElement)
                                      .getContext('2d')!
                                      .getImageData(24, 193, 16, 7).data,
                              ).join(',')
                            : document.getElementById('ammo')!.textContent;
                        return current !== before;
                    },
                    { before: ammo, native },
                );
                await page.mouse.up();
                await page.waitForTimeout(150);
                const released = await ammunition(page, native);
                await page.waitForTimeout(200);
                assert.equal(await ammunition(page, native), released, 'X releases fire');
                for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
                    assert.equal(await arrow(page, key), true, key);
                    assert.equal(await arrow(page, key, 'keyup'), true, key);
                }
                await page.locator('#game').focus();
                await page.locator('#settings-toggle').dispatchEvent('mousedown', { button: 0 });
                await page.locator('#settings-toggle').dispatchEvent('mouseup', { button: 0 });
                assert.equal(await page.locator('#settings-panel').isVisible(), true);
                await page.locator('#settings-close').focus();
                await cross(page);
                assert.equal(await page.locator('#settings-panel').isVisible(), false);
                await page.locator('#settings-toggle').focus();
                await page.keyboard.press('Space');
                assert.equal(
                    await page.locator('#settings-panel').isVisible(),
                    true,
                    'A physical keyboard retains native Space activation in the PS4 browser',
                );
                await page.locator('#settings-close').focus();
                await cross(page);
                const nativeInput = await page.evaluate(() => {
                    const input = document.createElement('input');
                    document.body.appendChild(input);
                    const event = new MouseEvent('mousedown', {
                        button: 0,
                        bubbles: true,
                        cancelable: true,
                    });
                    input.dispatchEvent(event);
                    input.remove();
                    return !event.defaultPrevented;
                });
                assert.equal(nativeInput, true, 'Native text fields keep mouse activation');
                await page.evaluate(() => {
                    const input = document.createElement('input');
                    input.id = 'ps4-text-fixture';
                    document.body.appendChild(input);
                    input.focus();
                });
                await page.locator('#settings-toggle').click();
                assert.equal(await page.locator('#settings-panel').isVisible(), true);
                await page.locator('#ps4-text-fixture').evaluate((element) => element.remove());
                assert.deepEqual(errors, [], `${name} ${platform} legacy=${legacy}`);
            } catch (error) {
                console.error(
                    name,
                    platform,
                    { legacy, errors },
                    await page.evaluate(() => ({
                        url: location.href,
                        focus: document.activeElement?.id,
                        picker: document.getElementById('platform-picker')?.hidden,
                        status: document.getElementById('platform-status')?.textContent,
                        game: document.getElementById('game')?.dataset.game,
                    })),
                );
                throw error;
            } finally {
                await page.close();
            }
        }
    }
    const desktop = await browser.newPage();
    try {
        await desktop.goto('http://127.0.0.1:8091/');
        await desktop.locator('[data-platform="remastered"]').focus();
        await cross(desktop);
        assert.equal(await desktop.locator('#platform-picker').isVisible(), true);
    } finally {
        await desktop.close();
    }
    console.log(
        `PASS: ${name} PS4 serial directional jumps, key-only arrows, X selection/start/fire/release/settings, classic/native modern/legacy and desktop mouse isolation.`,
    );
}
