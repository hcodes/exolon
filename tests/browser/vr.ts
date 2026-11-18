import { prepareControl } from './control-navigation.ts';
import { openSettings, closeHome, closeSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page, Request, Route } from 'playwright';
import type { World } from '../../src/types/game.ts';
import { installVrSupport } from './vr-support.ts';

const origin = 'http://127.0.0.1:8091/';
const vrEngine = /\/runtime\/vr\.js(?:\?|$)/;

declare global {
    interface Window {
        __vrLateImport?: boolean;
        __vrAudio: { contexts: AudioContext[]; gestures: (boolean | null)[] };
        __vrPreviewPad: { axes: number[]; buttons: { pressed: boolean; value: number }[] };
    }
}

async function prepare(page: Page) {
    await installVrSupport(page);
    page.setDefaultTimeout(15000);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await page.addInitScript(() => {
        localStorage.setItem('exolon-settings-collapsed', 'false');
        window.__vrAudio = { contexts: [], gestures: [] };
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        const resume = Audio.prototype.resume;
        Audio.prototype.resume = function (...args) {
            if (!window.__vrAudio.contexts.includes(this)) window.__vrAudio.contexts.push(this);
            window.__vrAudio.gestures.push(navigator.userActivation?.isActive ?? null);
            return resume.apply(this, args);
        };
    });
}

async function choose(page: Page, mode = 'vr') {
    await page.locator(`[data-platform="${mode}"][aria-disabled="false"]`).focus();
    await page.keyboard.press('Enter');
}

async function ready(page: Page) {
    await page.locator('#game[data-game="vr"][data-ready="true"]').waitFor();
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
}

async function activate(page: Page, id: string) {
    if (id === 'pause') {
        await closeHome(page);
        await closeSettings(page);
        await page.locator('#game').focus();
        await page.keyboard.press('Pause');
        return;
    }
    const control = page.locator(`#${id}`);
    await prepareControl(control);
    await control.focus();
    await page.keyboard.press('Enter');
    await closeHome(page);
    await closeSettings(page);
}

async function mode(page: Page, value: string) {
    await page.waitForFunction(
        (value) => document.getElementById('game')?.dataset.mode === value,
        value,
    );
}

async function frames(page: Page, count = 12) {
    await page.evaluate(
        (count) =>
            new Promise<void>((resolve) => {
                function next() {
                    if (--count <= 0) resolve();
                    else requestAnimationFrame(next);
                }
                requestAnimationFrame(next);
            }),
        count,
    );
}

async function assertPaused(page: Page) {
    await mode(page, 'paused');
    const tick = await page.locator('#game').getAttribute('data-tick');
    await frames(page);
    assert.equal(await page.locator('#game').getAttribute('data-tick'), tick);
}

async function assertScenePixels(page: Page, name: string) {
    const snapshot = await page.locator('#game').screenshot({
        path: `/tmp/exolon-vr-${name.toLowerCase()}.png`,
    });
    const detail = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<number>();
        let lit = 0;
        for (let index = 0; index < data.length; index += 16) {
            const r = data[index],
                g = data[index + 1],
                b = data[index + 2];
            colors.add((r << 16) | (g << 8) | b);
            if (Math.max(r, g, b) > 45) lit++;
        }
        return { colors: colors.size, lit, width: image.width, height: image.height };
    }, snapshot.toString('base64'));
    assert.ok(detail.width > 200 && detail.height > 150, 'Preview has a usable canvas size');
    assert.ok(
        detail.colors > 30 && detail.lit > 200,
        `Real scene pixels: ${JSON.stringify(detail)}`,
    );
}

async function checkPreview(browser: Browser, name: string): Promise<boolean> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await prepare(page);
    const errors: string[] = [],
        requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    try {
        await page.goto(origin + '?game=vr&graphics=c64&level=1&test=keep');
        await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
        const webgl = await page.evaluate(() =>
            Boolean(document.createElement('canvas').getContext('webgl2')),
        );
        if (!webgl) {
            assert.equal(
                await page.locator('[data-platform="vr"]').getAttribute('aria-disabled'),
                'true',
            );
            console.log(`SKIP: ${name} VR preview: WebGL 2 unavailable; banner disabled.`);
            return false;
        }
        await page.locator('[data-platform="vr"][aria-disabled="false"]').waitFor();
        assert.equal(await page.locator('#game').count(), 0, 'Preferred VR URL still opens picker');
        assert.deepEqual(
            requests.filter((address) => {
                const path = new URL(address).pathname;
                return (
                    /\/(?:runtime|legacy)\/(?:classic|amiga|atari-st|vr)-/.test(path) ||
                    /\/runtime\/vr\.js$/.test(path) ||
                    /\/(?:data|assets\/graphics)\//.test(path) ||
                    /\.(?:wav|m4a|mp3)$/.test(path)
                );
            }),
            [],
            'Picker loads no engines, maps, graphics banks or audio',
        );
        await choose(page);
        await ready(page);
        await mode(page, 'title');
        assert.equal(new URL(page.url()).searchParams.get('game'), 'vr');
        assert.equal(new URL(page.url()).searchParams.get('graphics'), null);
        assert.equal(new URL(page.url()).searchParams.get('test'), 'keep');
        const entryRequest = requests.find((address) => vrEngine.test(address));
        assert.ok(entryRequest, 'Selecting VR requests its separate runtime entry');
        assert.match(new URL(entryRequest).searchParams.get('v') ?? '', /^[a-f0-9]{16}$/);
        assert.equal(
            await page.locator('#vr-enter').isDisabled(),
            false,
            'Supported XR enables immersive entry',
        );
        assert.ok((await page.locator('#vr-status').textContent())?.trim());
        const audio = await page.evaluate(() => ({
            contexts: window.__vrAudio.contexts.length,
            gestures: window.__vrAudio.gestures,
        }));
        assert.equal(audio.contexts, 1, 'VR reuses the selection-unlocked audio context');
        assert.ok(audio.gestures.length > 0 && audio.gestures[0] !== false);
        await activate(page, 'new-game');
        await mode(page, 'playing');
        await page.locator('#game').focus();
        const ammo = Number(await page.locator('#game').getAttribute('data-ammo'));
        await page.keyboard.down('Space');
        try {
            await page.waitForFunction(
                (ammo) => Number(document.getElementById('game')?.dataset.ammo) < ammo,
                ammo,
            );
        } finally {
            await page.keyboard.up('Space');
        }
        await assertScenePixels(page, name);
        await activate(page, 'pause');
        await assertPaused(page);
        await activate(page, 'pause');
        await mode(page, 'playing');
        await activate(page, 'restart');
        await mode(page, 'playing');
        assert.equal(await page.locator('#game').getAttribute('data-ammo'), '99');
        await activate(page, 'menu');
        await mode(page, 'title');
        await activate(page, 'vr-scores');
        await mode(page, 'scores');
        await page.keyboard.press('Escape');
        await mode(page, 'title');
        const originalScale = await page.locator('#game').screenshot();
        await page.locator('#vr-scale').evaluate((element: HTMLInputElement) => {
            element.value = element.min;
            element.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await frames(page, 2);
        assert.notDeepEqual(
            await page.locator('#game').screenshot(),
            originalScale,
            'Scale changes the rendered diorama',
        );
        await activate(page, 'vr-recenter');
        for (const [width, height] of [
            [390, 844],
            [844, 390],
            [1280, 900],
        ]) {
            await page.setViewportSize({ width, height });
            await frames(page, 2);
            const bounds = await page.locator('#game').boundingBox();
            assert.ok(bounds && bounds.width > 100 && bounds.height > 100);
            assert.ok(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
            );
        }
        await activate(page, 'new-game');
        await mode(page, 'playing');
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await assertPaused(page);
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: false });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await mode(page, 'playing');
        const contextLoss = await page.locator('#game').evaluate((element) => {
            const gl = (element as HTMLCanvasElement).getContext('webgl2');
            const extension = gl?.getExtension('WEBGL_lose_context');
            if (!extension) return false;
            extension.loseContext();
            setTimeout(() => extension.restoreContext(), 100);
            return true;
        });
        if (contextLoss) {
            await assertPaused(page);
            await ready(page);
            await assertPaused(page);
        } else
            console.log(
                `SKIP: ${name} VR context restoration: WEBGL_lose_context extension unavailable.`,
            );
        for (let index = 0; index < 2; index++) {
            await activate(page, 'vr-platforms');
            await page.locator('[data-platform="vr"][aria-disabled="false"]').waitFor();
            await choose(page);
            await ready(page);
            await mode(page, 'title');
        }
        assert.deepEqual(errors, []);
        return true;
    } finally {
        await page.close();
    }
}

async function checkMissingWebGl(browser: Browser) {
    const page = await browser.newPage();
    await prepare(page);
    await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        function getPreviewContext(this: HTMLCanvasElement, type: string, options?: object) {
            return type === 'webgl2' ? null : getContext.call(this, type, options);
        }
        Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
            configurable: true,
            value: getPreviewContext,
        });
    });
    try {
        await page.goto(origin + '?game=vr');
        await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
        await page.waitForFunction(() =>
            /WebGL 2/i.test(
                document.querySelector<HTMLElement>('[data-platform="vr"]')?.title || '',
            ),
        );
        assert.equal(
            await page.locator('[data-platform="vr"]').getAttribute('aria-disabled'),
            'true',
        );
        assert.equal(await page.locator('#game').count(), 0);
        await choose(page, 'retro');
        await page.locator('#game[data-graphics="retro"]').waitFor();
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
    } finally {
        await page.close();
    }
}

async function checkRejectedXr(browser: Browser) {
    const page = await browser.newPage();
    await prepare(page);
    await page.addInitScript(() => {
        localStorage.setItem('exolon-settings-collapsed', 'true');
        Object.defineProperty(navigator, 'xr', {
            configurable: true,
            value: Object.assign(new EventTarget(), {
                isSessionSupported: (mode: string) => Promise.resolve(mode === 'immersive-vr'),
                requestSession: () =>
                    Promise.reject(new DOMException('Test permission denied', 'NotAllowedError')),
            }),
        });
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
        await page.goto(origin);
        await choose(page);
        await ready(page);
        assert.equal(await page.locator('#settings-panel').isHidden(), true);
        assert.equal(await page.locator('#vr-enter').isVisible(), true);
        await page.locator('#vr-enter:not([disabled])').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() =>
            /denied|could not|failed|unavailable/i.test(
                document.getElementById('vr-status')?.textContent || '',
            ),
        );
        assert.match((await page.locator('#vr-status').textContent())!, /NotAllowedError/);
        assert.match((await page.locator('#vr-status').textContent())!, /flat browser preview/);
        await page.locator('#settings-toggle').focus();
        await page.keyboard.press('Enter');
        await activate(page, 'new-game');
        await mode(page, 'playing');
        await activate(page, 'pause');
        await assertPaused(page);
        await activate(page, 'vr-platforms');
        await page.locator('[data-platform="vr"][aria-disabled="false"]').waitFor();
        assert.deepEqual(errors, []);
    } finally {
        await page.close();
    }
}

async function completeImport(route: Route) {
    const response = await route.fetch();
    await route.fulfill({
        response,
        body: (await response.text()) + '\n;window.__vrLateImport = true;',
    });
}

async function checkCancelledImport(browser: Browser, reject: boolean, leave: boolean) {
    const page = await browser.newPage();
    await prepare(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(vrEngine, async (route) => {
        await gate;
        if (reject) await route.abort('failed');
        else await completeImport(route);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
        await page.goto(origin);
        const intercepted = page.waitForRequest(vrEngine);
        await choose(page);
        await intercepted;
        await page.waitForFunction(() => window.__vrAudio.contexts.length === 1);
        assert.equal(await page.locator('#game').count(), 0, 'VR import remains deferred');
        if (leave) await page.evaluate(() => dispatchEvent(new Event('pagehide')));
        else {
            await choose(page, 'retro');
            await page.locator('#game[data-graphics="retro"]').waitFor();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        }
        const matches = (request: Request) => vrEngine.test(request.url());
        const settled = reject
            ? page.waitForEvent('requestfailed', matches)
            : page.waitForEvent('requestfinished', matches);
        release();
        await settled;
        if (!reject) await page.waitForFunction(() => window.__vrLateImport);
        await frames(page, 2);
        assert.equal(await page.locator('#game[data-game="vr"]').count(), 0);
        if (leave) assert.equal(await page.locator('#game').count(), 0);
        else {
            assert.equal(new URL(page.url()).searchParams.get('game'), null);
            assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'retro');
        }
        await page.waitForFunction(() => window.__vrAudio.contexts[0].state === 'closed');
        assert.equal(
            await page
                .locator('#platform-status:visible, #platform-launch-status:visible')
                .filter({ hasText: /could not|requires/i })
                .count(),
            0,
        );
        assert.deepEqual(errors, []);
    } finally {
        release();
        await page.close();
    }
}

async function checkMismatchedBuild(browser: Browser) {
    const page = await browser.newPage();
    await prepare(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(vrEngine, async (route) => {
        const response = await route.fetch();
        const expected = new URL(route.request().url()).searchParams.get('v')!;
        const code = await response.text();
        assert.ok(code.includes(expected), 'The VR entry identifies its own build');
        await route.fulfill({ response, body: code.replaceAll(expected, '0000000000000000') });
    });
    try {
        await page.goto(origin);
        await choose(page);
        await page.waitForFunction(() =>
            /could not be loaded.*reload/i.test(
                document.getElementById('platform-status')?.textContent ?? '',
            ),
        );
        assert.equal(
            await page.locator('#game').count(),
            0,
            'An incompatible VR build is never mounted',
        );
        await page.waitForFunction(() => window.__vrAudio.contexts[0]?.state === 'closed');
        await choose(page, 'retro');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'retro');
        assert.deepEqual(errors, []);
    } finally {
        await page.close();
    }
}

async function checkPreviewOwnership(
    browser: Browser,
    variant: 'normal' | 'cheat' | 'selected' = 'normal',
) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await prepare(page);
    if (variant === 'cheat')
        await page.addInitScript(() =>
            localStorage.setItem('exolon-vr-cheats', JSON.stringify({ infiniteAmmo: true })),
        );
    await page.addInitScript(() => {
        const pad = {
            id: 'VR preview standard controller',
            index: 0,
            connected: true,
            mapping: 'standard',
            timestamp: 0,
            axes: [0, 0],
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
        };
        window.__vrPreviewPad = pad;
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    });
    // Exercise the real model's terminal flow using explicit test hazards and
    // pickups. This fixture changes fetched data only, never archived maps.
    await page.route('**/data/world.json{,?*}', async (route) => {
        const response = await route.fetch();
        const world = (await response.json()) as World;
        world.screens[0].objects = [
            ...Array.from({ length: 5 }, (_, index) => ({
                id: 9000 + index,
                type: 14,
                x: 4,
                y: 14,
            })),
            { id: 9010, type: 17, x: 7, y: 0 },
        ];
        await route.fulfill({ response, json: world });
    });
    try {
        await page.goto(origin + (variant === 'selected' ? '?level=1' : ''));
        await choose(page);
        await ready(page);
        await frames(page);
        await activate(page, 'new-game');
        await mode(page, 'playing');
        if (variant === 'cheat') {
            await openSettings(page);
            assert.equal(await page.locator('[data-cheat="infiniteAmmo"]').isChecked(), true);
            await page.locator('#settings-close').press('Enter');
        }
        await frames(page);
        await page.evaluate(() => {
            window.__vrPreviewPad.buttons[1] = { pressed: true, value: 1 };
        });
        await frames(page);
        await mode(page, 'playing');
        await page.evaluate(() => {
            window.__vrPreviewPad.buttons[1] = { pressed: false, value: 0 };
        });
        await openSettings(page);
        await page.locator('#settings-panel').waitFor({ state: 'visible' });
        await openSettings(page);
        await page.locator('#volume').focus();
        await page.evaluate(() => {
            window.__vrPreviewPad.buttons[0] = { pressed: true, value: 1 };
        });
        await frames(page);
        await assertPaused(page);
        assert.equal(
            await page.evaluate(() => Boolean(document.activeElement?.closest('#settings-panel'))),
            true,
        );
        await page.evaluate(() => {
            window.__vrPreviewPad.buttons[0] = { pressed: false, value: 0 };
        });
        await frames(page);
        await page.evaluate(() => {
            window.__vrPreviewPad.buttons[9] = { pressed: true, value: 1 };
        });
        await frames(page);
        assert.equal(await page.locator('#settings-panel').isHidden(), true);
        await mode(page, 'playing');
        await page.evaluate(() => {
            window.__vrPreviewPad.buttons[9] = { pressed: false, value: 0 };
        });
        await frames(page);
        await page.waitForFunction(
            () => document.getElementById('game')?.dataset.mode === 'over',
            undefined,
            { timeout: 35000 },
        );
        assert.equal(await page.locator('#game').getAttribute('data-score'), '5000');
        await page.locator('#vr-name-open').focus();
        await page.keyboard.press('Enter');
        await page.locator('#vr-name-entry').waitFor({ state: 'visible' });
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'vr-player-name');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'vr-name-cancel');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#vr-name-open').isVisible(), true);
        await page.locator('#vr-name-open').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.type('VR HERO');
        await page.keyboard.press('Enter');
        await page.locator('#vr-name-entry').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('#vr-name-open').isVisible(), false);
        const saved = await page.evaluate(() => ({
            rows: JSON.parse(localStorage.getItem('exolon-vr-high-scores') ?? '[]') as {
                name: string;
                score: number;
                player?: boolean;
            }[],
            best: localStorage.getItem('exolon-vr-best-score'),
        }));
        assert.equal(saved.rows.filter((row) => row.player).length, 1);
        assert.deepEqual(saved.rows[0], { name: 'VR HERO', score: 5000, player: true });
        assert.equal(saved.best, '5000');
    } finally {
        await page.close();
    }
}

export async function checkVr(browser: Browser, name: string) {
    const preview = await checkPreview(browser, name);
    await checkMissingWebGl(browser);
    if (preview) await checkRejectedXr(browser);
    await checkMismatchedBuild(browser);
    if (preview && name === 'Chromium')
        for (const variant of ['normal', 'cheat', 'selected'] as const)
            await checkPreviewOwnership(browser, variant);
    for (const reject of [false, true]) await checkCancelledImport(browser, reject, false);
    await checkCancelledImport(browser, false, true);
    console.log(
        `PASS: ${name} VR launch isolation, WebGL 2 recovery, stale import success/error and pagehide cancellation${preview ? ', real 3D preview/gameplay, XR rejection, pause/visibility/context recovery, cheated/selected local rankings and repeat mounts' : ''}. Physical headset behavior remains unverified.`,
    );
}
