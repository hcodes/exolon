import { checkOptionalGraphicsLoading } from './optional-graphics-loading.ts';
import assert from 'node:assert/strict';
import type { Browser, Page, Route } from 'playwright';

type Engine = 'classic' | 'amiga' | 'atari-st';
declare global {
    interface Window {
        __loadingLateImport?: boolean;
        __landingPad: {
            id: string;
            index: number;
            connected: boolean;
            mapping: string;
            axes: number[];
            buttons: { pressed: boolean; value: number }[];
            polls: number;
        };
        __loadingAudio: {
            contexts: AudioContext[];
            gestures: (boolean | null)[];
            loops: { source: AudioBufferSourceNode; stopped: boolean }[];
        };
    }
}
const ORIGIN = 'http://127.0.0.1:8091/';
function engineScript(engine: Engine, legacy: boolean) {
    return new RegExp(`/${legacy ? 'legacy' : 'runtime'}/${engine}-[^/]+\\.js(?:\\?|$)`);
}
async function setup(page: Page) {
    page.setDefaultTimeout(15000);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await page.addInitScript(() => {
        window.__loadingAudio = { contexts: [], gestures: [], loops: [] };
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        const resume = Audio.prototype.resume;
        Audio.prototype.resume = function (...args) {
            if (!window.__loadingAudio.contexts.includes(this))
                window.__loadingAudio.contexts.push(this);
            window.__loadingAudio.gestures.push(navigator.userActivation?.isActive ?? null);
            return resume.apply(this, args);
        };
        const createGain = Audio.prototype.createGain;
        Audio.prototype.createGain = function (...args) {
            if (!window.__loadingAudio.contexts.includes(this)) {
                window.__loadingAudio.contexts.push(this);
                window.__loadingAudio.gestures.push(navigator.userActivation?.isActive ?? null);
            }
            return createGain.apply(this, args);
        };
        const create = Audio.prototype.createBufferSource;
        Audio.prototype.createBufferSource = function (...args) {
            const source = create.apply(this, args);
            const record = { source, stopped: false };
            const start = source.start;
            const stop = source.stop;
            source.start = function (...values) {
                if (source.loop && source.buffer && source.buffer.duration > 5)
                    window.__loadingAudio.loops.push(record);
                return start.apply(this, values);
            };
            source.stop = function (...values) {
                record.stopped = true;
                return stop.apply(this, values);
            };
            return source;
        };
    });
}
async function waitForImport(held: Promise<void>) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            held,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error('Bundled engine request was not intercepted')),
                    15000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}
async function choose(page: Page, engine: Engine) {
    const banner = page.locator(
        `[data-platform="${engine === 'classic' ? 'retro' : engine}"][aria-disabled="false"]`,
    );
    await banner.focus();
    await page.keyboard.press('Enter');
}
async function ready(page: Page, engine: Engine) {
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
    assert.equal(
        await page.locator('#game').getAttribute('width'),
        engine === 'classic' ? '256' : '320',
    );
    assert.equal(
        await page.locator('#graphics-mode').inputValue(),
        engine === 'classic' ? 'retro' : engine,
    );
}
async function settle(page: Page) {
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
}
function assertShellRequests(requests: string[], legacy: boolean) {
    const paths = requests.map((url) => new URL(url).pathname);
    for (const address of requests) {
        const url = new URL(address);
        if (
            url.origin === new URL(ORIGIN).origin &&
            /\.(?:js|css|png|jpg|ico|svg)$/.test(url.pathname)
        )
            assert.match(
                url.searchParams.get('v') || '',
                /^[a-f0-9]{16}$/,
                'Versioned shell resource: ' + address,
            );
    }

    assert.ok(paths.includes(legacy ? '/legacy/game.js' : '/runtime/main.js'));
    assert.deepEqual(
        paths.filter(
            (path) =>
                /\/(?:data|model|view)\//.test(path) ||
                /\/(?:runtime|legacy)\/(?:classic|amiga|atari-st|vr)-/.test(path) ||
                /\/runtime\/vr\.js$/.test(path) ||
                /\/assets\/graphics\//.test(path) ||
                /\.(?:wav|mp3|m4a)$/.test(path) ||
                /\/entries\/main\.js$/.test(path),
        ),
        [],
        'The real bundled shell requests no engine chunks, reference modules, maps, graphics or audio',
    );
    const scripts = paths.filter((path) => path.endsWith('.js') && !path.includes('/metrika/'));
    assert.ok(scripts.length <= 8, `Bundled shell script budget: ${scripts.join(', ')}`);
}
function assertSelectedRequests(requests: string[], engine: Engine, legacy: boolean) {
    assert.equal(
        requests.some((address) => /\/runtime\/vr\.js$/.test(new URL(address).pathname)),
        false,
        `${engine} never requests the separate VR entry`,
    );
    assert.deepEqual(
        requests.filter((url) =>
            /\/assets\/graphics\/(?:c64|amstrad-cpc|sharp-mz800)\//.test(new URL(url).pathname),
        ),
        [],
        'Starting an engine never fetches unselected optional classic graphics banks',
    );
    assert.ok(
        requests.some((url) => engineScript(engine, legacy).test(url)),
        `${engine} chunk loaded`,
    );
    for (const other of ['classic', 'amiga', 'atari-st'] as const) {
        if (other === engine) continue;
        assert.equal(
            requests.some((url) => engineScript(other, legacy).test(url)),
            false,
            `${other} chunk stays unloaded`,
        );
        const forbidden =
            other === 'classic'
                ? /^\/(?:data\/world\.json|assets\/graphics\/zx-spectrum\/graphics\.json)$/
                : new RegExp(`/(?:games/${other}/data/|assets/graphics/${other}/|audio/${other}/)`);
        assert.deepEqual(
            requests.filter((url) => forbidden.test(new URL(url).pathname)),
            [],
            `${other} resources stay unloaded`,
        );
    }

    for (const address of requests) {
        const url = new URL(address);
        if (
            url.origin === new URL(ORIGIN).origin &&
            /\.(?:js|css|json|wav|m4a|mp3)$/.test(url.pathname)
        )
            assert.match(
                url.searchParams.get('v') || '',
                /^[a-f0-9]{16}$/,
                'Versioned selected resource: ' + address,
            );
    }
    const world = engine === 'classic' ? '/data/world.json' : `/games/${engine}/data/world.json`;
    assert.ok(
        requests.some((url) => new URL(url).pathname === world),
        `${engine} real world loaded`,
    );
    assert.equal(
        requests.some((url) =>
            /\/(?:entries\/main|model\/state|view\/renderer)\.js(?:\?|$)/.test(url),
        ),
        false,
        'Bundled verification never opts into the reference graph',
    );
}
async function checkEngine(browser: Browser, name: string, engine: Engine, legacy: boolean) {
    const page = await browser.newPage();
    const requests: string[] = [],
        errors: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    await setup(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let intercepted!: () => void;
    const held = new Promise<void>((resolve) => {
        intercepted = resolve;
    });
    await page.route(engineScript(engine, legacy), async (route) => {
        intercepted();
        await gate;
        await route.continue();
    });
    try {
        await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
        await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
        assert.equal(
            await page.locator('#new-game, #game, .game-footer').count(),
            0,
            `${name} ${legacy ? 'legacy' : 'modern'} mounts only the picker before selection`,
        );
        assertShellRequests(requests, legacy);
        assert.equal(await page.evaluate(() => window.__loadingAudio.contexts.length), 0);
        const before = await page.evaluate(() =>
            performance.getEntriesByType('resource').map((entry) => ({
                url: entry.name,
                bytes: (entry as PerformanceResourceTiming).decodedBodySize,
            })),
        );
        await choose(page, engine);
        await waitForImport(held);
        assert.equal(
            await page.locator('#game').count(),
            0,
            'Engine remains deferred while its code is held',
        );
        await page.waitForFunction(() => window.__loadingAudio.contexts.length > 0);
        const gestures = await page.evaluate(() => window.__loadingAudio.gestures);
        assert.ok(gestures.length > 0, 'Audio unlocks synchronously before the import resolves');
        assert.ok(
            gestures.every((active) => active !== false),
            'Audio unlock occurs in the platform gesture',
        );
        // Chromium expires transient activation after five seconds. A slow import must
        // reuse the context unlocked by the first gesture instead of requiring another.
        if (engine === 'classic' && name === 'Chromium')
            await page.waitForFunction(() => !navigator.userActivation.isActive);
        release();
        await ready(page, engine);
        await page.waitForFunction(() =>
            window.__loadingAudio.loops.some(
                ({ source, stopped }) =>
                    !stopped &&
                    source.context.state === 'running' &&
                    source.context.currentTime > 0.03,
            ),
        );
        assert.equal(
            await page.evaluate(() => window.__loadingAudio.contexts.length),
            1,
            'Selected engine reuses one unlocked audio context',
        );
        assertSelectedRequests(requests, engine, legacy);
        assert.deepEqual(errors, []);
        const scripts = before.filter((entry) => new URL(entry.url).pathname.endsWith('.js'));
        console.log(
            `PASS: ${name} ${legacy ? 'legacy' : 'modern'} ${engine}: shell ${before.length} requests / ${before.reduce((sum, entry) => sum + entry.bytes, 0)} decoded bytes; JS ${scripts.length} requests / ${scripts.reduce((sum, entry) => sum + entry.bytes, 0)} decoded bytes; isolated engine and one-gesture audio after deferred code.`,
        );
    } finally {
        release();
        await page.close();
    }
}
async function completeObservedImport(route: Route) {
    const response = await route.fetch();
    await route.fulfill({
        response,
        body: (await response.text()) + '\n;window.__loadingLateImport = true;',
    });
}
async function checkCancelledImport(browser: Browser, legacy: boolean, reject: boolean) {
    const page = await browser.newPage();
    await setup(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let intercepted!: () => void;
    const held = new Promise<void>((resolve) => {
        intercepted = resolve;
    });
    await page.route(engineScript('amiga', legacy), async (route) => {
        intercepted();
        await gate;
        if (reject) await route.abort('failed');
        else await completeObservedImport(route);
    });
    try {
        await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
        await choose(page, 'amiga');
        await waitForImport(held);
        await choose(page, 'atari-st');
        await ready(page, 'atari-st');
        const matches = (request: import('playwright').Request) =>
            engineScript('amiga', legacy).test(request.url());
        const settled = reject
            ? page.waitForEvent('requestfailed', matches)
            : page.waitForEvent('requestfinished', matches);
        release();
        await settled;
        if (!reject) await page.waitForFunction(() => window.__loadingLateImport);
        await settle(page);
        await ready(page, 'atari-st');
        assert.equal(new URL(page.url()).searchParams.get('game'), 'atari-st');
        assert.equal(
            await page.locator('#platform-status:visible, #platform-launch-status:visible').count(),
            0,
            'A stale import success/error cannot replace the new app or show an error',
        );
        assert.equal(
            await page.evaluate(() => window.__loadingAudio.contexts[0].state),
            'closed',
            'Abandoned selection closes its audio context',
        );
        assert.deepEqual(errors, []);
    } finally {
        release();
        await page.close();
    }
}
async function checkFailedImport(browser: Browser, legacy: boolean) {
    const page = await browser.newPage();
    await setup(page);
    await page.route(engineScript('atari-st', legacy), (route) => route.abort('failed'));
    try {
        await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
        await choose(page, 'atari-st');
        await page.waitForFunction(() =>
            document
                .getElementById('platform-status')
                ?.textContent?.includes('could not be loaded'),
        );
        assert.equal(await page.locator('#game, .game-footer').count(), 0);
        // AudioContext.close() settles asynchronously in Firefox.
        await page.waitForFunction(() => window.__loadingAudio.contexts[0].state === 'closed');
        assert.equal(await page.evaluate(() => window.__loadingAudio.contexts[0].state), 'closed');
        await choose(page, 'classic');
        await ready(page, 'classic');
    } finally {
        await page.close();
    }
}
async function checkPageHide(browser: Browser, legacy: boolean) {
    const page = await browser.newPage();
    await setup(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let intercepted!: () => void;
    const held = new Promise<void>((resolve) => {
        intercepted = resolve;
    });
    await page.route(engineScript('classic', legacy), async (route) => {
        intercepted();
        await gate;
        await completeObservedImport(route);
    });
    try {
        await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
        await choose(page, 'classic');
        await waitForImport(held);
        await page.evaluate(() => dispatchEvent(new Event('pagehide')));
        const finished = page.waitForEvent('requestfinished', (request) =>
            engineScript('classic', legacy).test(request.url()),
        );
        release();
        await finished;
        await page.waitForFunction(() => window.__loadingLateImport);
        await settle(page);
        assert.equal(
            await page.locator('#game, .game-footer').count(),
            0,
            'Leaving during import cannot mount the late engine',
        );
        assert.equal(await page.evaluate(() => window.__loadingAudio.contexts[0].state), 'closed');
        assert.equal(await page.evaluate(() => window.__loadingAudio.loops.length), 0);
    } finally {
        release();
        await page.close();
    }
}
async function checkGamepadSelection(browser: Browser, legacy: boolean) {
    const page = await browser.newPage();
    await setup(page);
    await page.addInitScript(() => {
        window.__landingPad = {
            id: 'Landing standard gamepad',
            index: 0,
            connected: true,
            mapping: 'standard',
            axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
            polls: 0,
        };
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => {
                window.__landingPad.polls++;
                return [window.__landingPad];
            },
        });
    });
    try {
        await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
        await page.bringToFront();
        await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
        await page.waitForFunction(() => window.__landingPad.polls > 1);
        await page.evaluate(() => {
            window.__landingPad.axes[0] = 1;
        });
        await page.waitForFunction(
            () => document.activeElement?.getAttribute('data-platform') === 'c64',
        );
        assert.equal(
            await page.locator('#game, .game-footer').count(),
            0,
            'Gamepad navigation does not start an engine',
        );
        await page.evaluate(() => {
            window.__landingPad.axes[0] = 0;
        });
        await settle(page);
        await page.evaluate(() => {
            window.__landingPad.buttons[0] = { pressed: true, value: 1 };
        });
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(
            await page.locator('#graphics-mode').inputValue(),
            'c64',
            'Gamepad confirmation launches the focused platform',
        );
    } finally {
        await page.close();
    }
}
async function checkPickerFullscreen(browser: Browser, name: string, legacy: boolean) {
    for (const rejected of [false, true])
        for (const engine of ['classic', 'amiga', 'atari-st'] as const) {
            const page = await browser.newPage();
            await setup(page);
            if (rejected)
                await page.addInitScript(() => {
                    Element.prototype.requestFullscreen = () =>
                        Promise.reject(new DOMException('Denied', 'NotAllowedError'));
                    Element.prototype.webkitRequestFullscreen = undefined;
                });
            try {
                await page.goto(ORIGIN + (legacy ? '?legacy=1' : ''));
                await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
                await page.locator('#fullscreen').focus();
                await page.keyboard.press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                            'true' &&
                        !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                );
                const native = await page.evaluate(() =>
                    Boolean(document.fullscreenElement || document.webkitFullscreenElement),
                );
                if (rejected)
                    assert.equal(native, false, 'Rejected native request enters window fullscreen');
                else if (name === 'Chromium')
                    assert.equal(native, true, 'Chromium covers real native fullscreen');
                await choose(page, engine);
                await ready(page, engine);
                await settle(page);
                assert.equal(
                    await page.locator('#fullscreen').getAttribute('aria-pressed'),
                    'true',
                    `${engine} keeps picker fullscreen across asynchronous mount`,
                );
                assert.equal(await page.locator('.game-app_fullscreen').count(), 1);
                assert.equal(
                    await page.evaluate(() =>
                        Boolean(document.fullscreenElement || document.webkitFullscreenElement),
                    ),
                    native,
                    'Native fullscreen ownership survives application replacement',
                );
                await page.locator('#fullscreen').focus();
                await page.keyboard.press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                        'false',
                );
                assert.equal(
                    await page.evaluate(() =>
                        Boolean(document.fullscreenElement || document.webkitFullscreenElement),
                    ),
                    false,
                );
                assert.equal(await page.locator('.game-app_fullscreen').count(), 0);
            } finally {
                await page.close();
            }
        }
}
export async function checkLoading(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        await checkOptionalGraphicsLoading(browser, name, legacy);
        for (const engine of ['classic', 'amiga', 'atari-st'] as const)
            await checkEngine(browser, name, engine, legacy);
        await checkCancelledImport(browser, legacy, false);
        await checkCancelledImport(browser, legacy, true);
        await checkFailedImport(browser, legacy);
        await checkPageHide(browser, legacy);
        await checkGamepadSelection(browser, legacy);
        await checkPickerFullscreen(browser, name, legacy);
    }
    console.log(
        `PASS: ${name} real bundled initial isolation, all engines, stale success/error, failed import recovery and leaving during import.`,
    );
}
