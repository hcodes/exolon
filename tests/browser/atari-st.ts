import { prepareControl } from './control-navigation.ts';
import { readReferenceModule, useReferenceRuntime } from './reference-mode.ts';
import { closeSettings, openSettings, closeHome } from './navigation.ts';
import { MOBILE_USER_AGENT } from './devices.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { Browser, Locator, Page } from 'playwright';
import type { NativeState } from '../../src/games/16bit/types/index.ts';
import type { NativeWorld } from '../../src/games/16bit/types/world.ts';

interface AtariAudioRecord {
    context: AudioContext;
    started: boolean;
    stopped: boolean;
    ended: boolean;
    loop: boolean;
    loopStart: number;
    loopEnd: number;
    duration: number;
    channels: number;
    peak: number;
}
declare global {
    interface Window {
        __atariState: NativeState;
        __atariAudio: AtariAudioRecord[];
        __atariGestures: (boolean | null)[];
        __atariFrame: (now: number) => void;
        __atariLateModuleReady: boolean;
        __atariClosedDecodes: number;
    }
}
const ORIGIN = 'http://127.0.0.1:8091/';
const TITLE_SECONDS = 9106234 / 44100;
const END_SECONDS = 138359 / 44100;

async function observeState(page: Page) {
    await page.route('**/games/atari-st/model/index.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
                export * from './index.js?original';
                import {createAtariStState as create,stepAtariSt as step} from './index.js?original';
                export function createAtariStState(...args){return window.__atariState=create(...args);}
                export function stepAtariSt(...args){const result=step(...args);window.__atariState=result.state;return result;}
            `,
        }),
    );
}
async function prepare(page: Page) {
    await useReferenceRuntime(page);
    page.setDefaultTimeout(30000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('exolon-settings-collapsed', 'false');
        window.__atariAudio = [];
        window.__atariLateModuleReady = false;
        window.__atariClosedDecodes = 0;
        window.__atariGestures = [];
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        const resume = Audio.prototype.resume;
        Audio.prototype.resume = function (...args) {
            window.__atariGestures.push(navigator.userActivation?.isActive ?? null);
            return resume.apply(this, args);
        };
        const createGain = Audio.prototype.createGain;
        Audio.prototype.createGain = function (...args) {
            window.__atariGestures.push(navigator.userActivation?.isActive ?? null);
            return createGain.apply(this, args);
        };
        const decode = Audio.prototype.decodeAudioData;
        Audio.prototype.decodeAudioData = function (...args) {
            if (this.state === 'closed') window.__atariClosedDecodes++;
            return decode.apply(this, args);
        };
        const create = Audio.prototype.createBufferSource;
        Audio.prototype.createBufferSource = function (...args) {
            const source = create.apply(this, args);
            const record: AtariAudioRecord = {
                context: source.context as AudioContext,
                started: false,
                stopped: false,
                ended: false,
                loop: false,
                loopStart: 0,
                loopEnd: 0,
                duration: 0,
                channels: 0,
                peak: 0,
            };
            window.__atariAudio.push(record);
            source.addEventListener('ended', () => {
                record.ended = true;
            });
            const start = source.start;
            source.start = function (...values) {
                const result = start.apply(this, values);
                record.started = true;
                record.loop = source.loop;
                record.loopStart = source.loopStart;
                record.loopEnd = source.loopEnd;
                record.duration = source.buffer?.duration || 0;
                record.channels = source.buffer?.numberOfChannels || 0;
                const samples = source.buffer?.getChannelData(0);
                if (samples) {
                    // Sparse observation proves real decoded sound without rescanning9M samples.
                    for (let index = 0; index < samples.length; index += 127)
                        record.peak = Math.max(record.peak, Math.abs(samples[index]));
                }
                return result;
            };
            const stop = source.stop;
            source.stop = function (...values) {
                record.stopped = true;
                return stop.apply(this, values);
            };
            return source;
        };
    });
    return errors;
}
async function enter(page: Page, activate: (locator: Locator) => Promise<void>, query = '') {
    await page.goto(ORIGIN + '?game=atari-st' + query);
    const banner = page.locator('[data-platform="atari-st"][aria-disabled="false"]');
    await banner.waitFor();
    await activate(banner);
    await page
        .locator('[data-game="atari-st"] #new-game:not([disabled])')
        .waitFor({ state: 'attached' });
}
async function waitForTitle(page: Page) {
    await page.waitForFunction(
        (duration) =>
            window.__atariAudio.some(
                (source) =>
                    source.started &&
                    !source.stopped &&
                    !source.ended &&
                    source.loop &&
                    Math.abs(source.duration - duration) < 0.002 &&
                    source.context.state === 'running' &&
                    source.peak > 0.01,
            ),
        TITLE_SECONDS,
    );
}
async function assertSilent(page: Page) {
    await page.waitForFunction(() =>
        window.__atariAudio.every(
            (source) =>
                !source.started ||
                source.stopped ||
                source.ended ||
                source.context.state === 'closed',
        ),
    );
}

export async function checkAtariSt(browser: Browser, name: string) {
    // Touch activation avoids headless WebKit mouse-coordinate errors on macOS.
    async function activate(locator: Locator) {
        if (
            (await locator.getAttribute('id')) === 'pause' &&
            /^(Pause|Resume)$/.test((await locator.textContent()) || '')
        ) {
            await closeHome(locator.page());
            await closeSettings(locator.page());
            await locator.page().locator('#game').focus();
            await locator.page().keyboard.press('Pause');
            return;
        }
        await prepareControl(locator);
        if (name === 'WebKit') await locator.tap();
        else await locator.click();
    }
    const setChecked = async (locator: Locator, checked: boolean) => {
        if (name === 'WebKit') {
            // Headless macOS WebKit can report wrong pointer coordinates in a scrolled modal.
            await locator.focus();
            if ((await locator.isChecked()) !== checked) await locator.press('Space');
            assert.equal(await locator.isChecked(), checked);
        } else await locator.setChecked(checked);
    };
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            hasTouch: true,
            viewport: { width: 1100, height: 900 },
            userAgent: MOBILE_USER_AGENT,
        });
        const errors = await prepare(page);
        const requests: string[] = [];
        page.on('request', (request) => requests.push(new URL(request.url()).pathname));
        if (!legacy) await observeState(page);
        try {
            await page.goto(ORIGIN + '?game=atari-st&level=41' + (legacy ? '&legacy=1' : ''));
            const banner = page.locator('[data-platform="atari-st"][aria-disabled="false"]');
            await banner.waitFor();
            assert.equal(
                new URL((await banner.getAttribute('href')) || '', ORIGIN).searchParams.get('game'),
                'atari-st',
            );
            assert.equal(
                await banner
                    .locator('img')
                    .evaluate((image) => (image as HTMLImageElement).naturalWidth),
                320,
            );
            await banner.focus();
            await page.keyboard.press('Enter');
            await page
                .locator('[data-game="atari-st"] #new-game:not([disabled])')
                .waitFor({ state: 'attached' });
            assert.equal(await page.locator('#settings-panel').isVisible(), false);
            assert.equal(
                await page.locator('#settings-toggle').getAttribute('aria-expanded'),
                'false',
            );
            await waitForTitle(page);
            const audio = await page.evaluate(() => {
                const source = window.__atariAudio.find(
                    (item) => item.started && !item.stopped && item.loop,
                )!;
                return {
                    loopStart: source.loopStart,
                    loopEnd: source.loopEnd,
                    channels: source.channels,
                    gestures: window.__atariGestures,
                };
            });
            assert.equal(audio.loopStart, 876 / 44100);
            assert.equal(audio.loopEnd, TITLE_SECONDS);
            assert.equal(audio.channels, 1, 'Original ST YM music is mono');
            assert.ok(audio.gestures.length > 0);
            if (audio.gestures.some((active) => active !== null))
                assert.ok(
                    audio.gestures.includes(true),
                    'Banner gesture resumes audio synchronously',
                );
            assert.equal(await page.locator('#game').getAttribute('width'), '320');
            assert.equal(await page.locator('#game').getAttribute('height'), '200');
            const bounds = await page.locator('#game').boundingBox();
            const fit = await page
                .locator('#game')
                .evaluate((canvas) => getComputedStyle(canvas).objectFit);
            assert.ok(
                bounds &&
                    (Math.abs(bounds.width / bounds.height - 320 / 200) < 0.01 ||
                        fit === 'contain'),
                `${name} legacy${legacy}: native320x200 image retains its ratio with optional letterboxing`,
            );
            assert.equal(await page.locator('#graphics-mode').inputValue(), 'atari-st');
            for (const selector of ['#monochrome', '#split-divider', '#platform-picker'])
                assert.equal(await page.locator(selector).count(), 0, selector);
            assert.ok(requests.some((url) => url.endsWith('/games/atari-st/data/world.json')));
            assert.ok(
                requests.some((url) => url.endsWith('/assets/graphics/atari-st/resources.json')),
            );
            assert.ok(requests.some((url) => url.endsWith('/audio/atari-st/title.m4a')));
            assert.equal(
                requests.some((url) =>
                    /\/(?:games\/amiga\/data|assets\/graphics\/amiga|audio\/amiga)\//.test(url),
                ),
                false,
                'ST owns its data, artwork and music',
            );
            const title = await page
                .locator('#game')
                .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
            await activate(page.locator('#new-game'));
            await page.waitForFunction(
                () => document.getElementById('game')?.dataset.menu === 'playing',
            );
            if (!legacy)
                assert.equal(await page.evaluate(() => window.__atariState.screenIndex), 40);
            await page.evaluate(
                () =>
                    new Promise<void>((resolve) =>
                        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                    ),
            );
            const ammo = legacy ? 0 : await page.evaluate(() => window.__atariState.ammo);
            // Source HUD ammo digits occupy x24..39,y193..199 in both bundles.
            const ammunition = await page
                .locator('#game')
                .evaluate((canvas) =>
                    Array.from(
                        (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(24, 193, 16, 7)
                            .data,
                    ),
                );
            await page.locator('#game').focus();
            await page.keyboard.down('Space');
            await page.waitForFunction((before) => {
                const pixels = (document.getElementById('game') as HTMLCanvasElement)
                    .getContext('2d')!
                    .getImageData(24, 193, 16, 7).data;
                return pixels.some((value, index) => value !== before[index]);
            }, ammunition);
            if (!legacy)
                await page.waitForFunction((before) => window.__atariState.ammo < before, ammo);
            await page.keyboard.up('Space');
            await page.locator('#game').focus();
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(100);
            await page.keyboard.up('ArrowRight');
            await page.locator('#game').press('Pause');
            assert.equal(await page.locator('#game').getAttribute('data-status'), 'paused');
            assert.equal(await page.locator('#pause').textContent(), 'Resume');
            assert.notEqual(
                await page
                    .locator('#game')
                    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
                title,
            );
            if (!legacy) {
                const tick = await page.evaluate(() => window.__atariState.tick);
                await page.waitForTimeout(100);
                assert.equal(await page.evaluate(() => window.__atariState.tick), tick);
            }
            await openSettings(page);
            await page.keyboard.press('Escape');
            await page.locator('#settings-panel').waitFor({ state: 'hidden' });
            assert.equal(
                await page.locator('#game').getAttribute('data-menu'),
                'playing',
                'Closing modal does not navigate to title',
            );
            await openSettings(page);
            await setChecked(page.locator('[data-cheat="invulnerable"]'), true);
            await setChecked(page.locator('[data-cheat="infiniteAmmo"]'), true);
            await setChecked(page.locator('[data-cheat="levelSelection"]'), true);
            await closeSettings(page);
            await activate(page.locator('#next-screen'));
            assert.match((await page.locator('#cheat-screen').textContent()) || '', /042/);
            assert.equal(
                await page.evaluate(
                    () =>
                        JSON.parse(localStorage.getItem('exolon-atari-st-cheats') || '{}')
                            .infiniteAmmo,
                ),
                true,
            );
            for (const key of ['exolon-amiga-cheats', 'exolon-cheats'])
                assert.equal(
                    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key),
                    null,
                );
            await closeSettings(page);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
            await activate(page.locator('#new-game'));
            if (!legacy)
                assert.equal(await page.evaluate(() => window.__atariState.screenIndex), 0);
            await openSettings(page);
            await setChecked(page.locator('[data-cheat="infiniteAmmo"]'), false);
            await closeSettings(page);
            await closeSettings(page);
            for (const [width, height] of [
                [390, 844],
                [844, 390],
            ]) {
                await page.setViewportSize({ width, height });
                assert.equal(
                    await page.evaluate(
                        () => document.documentElement.scrollWidth <= innerWidth + 1,
                    ),
                    true,
                    `${name} legacy${legacy}: no horizontal overflow at${width}x${height}`,
                );
                const canvasBounds = await page.locator('#game').boundingBox();
                const objectFit = await page
                    .locator('#game')
                    .evaluate((canvas) => getComputedStyle(canvas).objectFit);
                assert.ok(
                    canvasBounds &&
                        (Math.abs(canvasBounds.width / canvasBounds.height - 320 / 200) < 0.01 ||
                            objectFit === 'contain'),
                );
                for (const action of ['left', 'right', 'jump', 'fire'])
                    assert.ok(await page.locator(`#touch [data-action="${action}"]`).isVisible());
                await page.waitForTimeout(180);
                const beforeTap = await page
                    .locator('#game')
                    .evaluate((canvas) =>
                        Array.from(
                            (canvas as HTMLCanvasElement)
                                .getContext('2d')!
                                .getImageData(24, 193, 16, 7).data,
                        ),
                    );
                await page.locator('#touch [data-action="fire"]').tap();
                await page.waitForFunction((before) => {
                    const pixels = (document.getElementById('game') as HTMLCanvasElement)
                        .getContext('2d')!
                        .getImageData(24, 193, 16, 7).data;
                    return pixels.some((value, index) => value !== before[index]);
                }, beforeTap);
            }
            await activate(page.locator('#platforms'));
            await page.locator('#platform-picker').waitFor();
            await assertSilent(page);
            await activate(page.locator('[data-platform="retro"][aria-disabled="false"]'));
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('split');
            for (const id of ['split-left', 'split-right'])
                assert.equal(await page.locator(`#${id} option[value="atari-st"]`).count(), 0);
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} Atari ST native/legacy controls and portrait/landscape real touch firing.`,
    );
    for (const selectedLevel of [false, true]) {
        const page = await browser.newPage({ hasTouch: true });
        const errors = await prepare(page);
        await observeState(page);
        if (selectedLevel)
            await page.route('**/audio/atari-st/*.{wav,m4a}*', (route) => route.abort());
        try {
            await enter(page, activate);
            const siblingKeys = ['exolon-amiga-scores', 'exolon-amiga-name', 'exolon-high-scores'];
            const siblingStorage = await page.evaluate(
                (keys) => keys.map((key) => localStorage.getItem(key)),
                siblingKeys,
            );
            if (selectedLevel) {
                await openSettings(page);
                await setChecked(page.locator('[data-cheat="infiniteAmmo"]'), true);
                await setChecked(page.locator('[data-cheat="retryLevel"]'), true);
                await setChecked(page.locator('[data-cheat="levelSelection"]'), true);
                await closeSettings(page);
                await activate(page.locator('#next-screen'));
                await openSettings(page);
                await setChecked(page.locator('[data-cheat="levelSelection"]'), false);
                await closeSettings(page);
            } else await waitForTitle(page);
            await activate(page.locator('#new-game'));
            await page.evaluate(() => {
                window.__atariState.score = 5000;
                window.__atariState.lives = 0;
                window.__atariState.player.deathTick = 14;
            });
            await page.waitForFunction(
                () => document.getElementById('game')?.dataset.menu === 'end',
            );
            if (!selectedLevel) {
                await page.waitForFunction(
                    (duration) =>
                        window.__atariAudio.some(
                            (source) =>
                                source.started &&
                                !source.loop &&
                                Math.abs(source.duration - duration) < 0.002,
                        ),
                    END_SECONDS,
                );
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.__atariAudio.filter(
                                (source) => source.started && !source.stopped && !source.ended,
                            ).length,
                    ),
                    1,
                    'Game Over replaces main music',
                );
                await page.waitForFunction(
                    (duration) =>
                        window.__atariAudio.some(
                            (source) =>
                                !source.loop &&
                                Math.abs(source.duration - duration) < 0.002 &&
                                source.ended,
                        ),
                    END_SECONDS,
                );
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.__atariAudio.filter((source) => source.started && !source.loop)
                                .length,
                    ),
                    1,
                    'Game Over plays once',
                );
                await waitForTitle(page);
                assert.equal(
                    await page.locator('#game').getAttribute('data-menu'),
                    'end',
                    'Main music restores without a Continue gesture',
                );
            }
            await activate(page.locator('#new-game'));
            await page.locator('#atari-st-player-name').waitFor({ state: 'visible' });
            await page.locator('#atari-st-player-name').fill('ST ORBIT');
            await page.locator('#atari-st-player-name').press('Enter');
            const rows = (await page.evaluate(() =>
                JSON.parse(localStorage.getItem('exolon-atari-st-scores') || '[]'),
            )) as { name: string; score: number }[];
            assert.equal(rows.length, 34);
            assert.deepEqual(rows[0], { name: 'ST ORBIT', score: 5000 });
            assert.equal(
                await page.evaluate(() => localStorage.getItem('exolon-atari-st-name')),
                'ST ORBIT',
            );
            if (selectedLevel) {
                await activate(page.locator('#new-game'));
                assert.equal(await page.locator('#game').getAttribute('data-menu'), 'playing');
                assert.equal(
                    await page.evaluate(() => window.__atariState.screenIndex),
                    1,
                    'Retry keeps the terminal screen after saving a qualifying score',
                );
            } else await waitForTitle(page);
            assert.deepEqual(
                await page.evaluate(
                    (keys) => keys.map((key) => localStorage.getItem(key)),
                    siblingKeys,
                ),
                siblingStorage,
                'ST never changes sibling score/name storage',
            );
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} Atari ST native-rate music, automatic restoration and isolated score entry.`,
    );
    // The legacy bundle reaches Game Over through real repeated falls, without a private-state hook.
    const pit = await browser.newPage({ hasTouch: true });
    const pitErrors = await prepare(pit);
    const pitAudioRequests: string[] = [];
    pit.on('requestfailed', (request) =>
        pitAudioRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
    );
    await pit.addInitScript(() => {
        let sequence = 0;
        const pending = new Map<number, FrameRequestCallback>();
        window.requestAnimationFrame = (callback) => {
            pending.set(++sequence, callback);
            return sequence;
        };
        window.cancelAnimationFrame = (id) => {
            pending.delete(id);
        };
        window.__atariFrame = (now) => {
            const frames = Array.from(pending.values());
            pending.clear();
            frames.forEach((frame) => frame(now));
        };
    });
    await pit.route('**/games/atari-st/data/world.json*', async (route) => {
        const response = await route.fetch();
        const world = (await response.json()) as NativeWorld;
        await route.fulfill({
            json: {
                ...world,
                screens: world.screens.map((screen, index) =>
                    index ? screen : { ...screen, static: [], tiles: Array<number>(920).fill(0) },
                ),
            },
        });
    });
    try {
        await enter(pit, activate, '&legacy=1');
        await activate(pit.locator('#new-game'));
        await pit.evaluate(() => {
            window.__atariFrame(0);
            for (let tick = 1; tick <= 300; tick++) window.__atariFrame(tick * 60);
        });
        assert.equal(await pit.locator('#game').getAttribute('data-menu'), 'end');
        await pit.waitForFunction(
            (duration) =>
                window.__atariAudio.some(
                    (source) =>
                        source.started &&
                        !source.loop &&
                        Math.abs(source.duration - duration) < 0.002,
                ),
            END_SECONDS,
            { polling: 50 },
        );
        assert.deepEqual(pitErrors, []);
    } catch (error) {
        const audio = await pit.evaluate(() =>
            window.__atariAudio.map(({ context, ...source }) => ({
                ...source,
                state: context.state,
            })),
        );
        throw new Error(
            `${name} legacy Game Over fixture: ${String(error)}; audio=${JSON.stringify(audio)}; failures=${JSON.stringify(pitAudioRequests)}; errors=${JSON.stringify(pitErrors)}`,
            { cause: error },
        );
    } finally {
        await pit.close();
    }
    for (const legacy of [false, true])
        for (const failure of ['missing-world', 'corrupt-art', 'no-audio', 'classic-data']) {
            const page = await browser.newPage({ hasTouch: true });
            const errors = await prepare(page);
            const pattern =
                failure === 'classic-data'
                    ? '**/data/world.json*'
                    : failure === 'missing-world'
                      ? '**/games/atari-st/data/world.json*'
                      : '**/assets/graphics/atari-st/resources.json*';
            if (failure === 'missing-world') await page.route(pattern, (route) => route.abort());
            if (failure === 'classic-data')
                await page.route(
                    (url) => url.pathname === '/data/world.json',
                    (route) => route.abort(),
                );
            if (failure === 'corrupt-art')
                await page.route(pattern, (route) => route.fulfill({ json: {} }));
            if (failure === 'no-audio')
                await page.addInitScript(() => {
                    Object.defineProperty(window, 'AudioContext', {
                        configurable: true,
                        value: undefined,
                    });
                    Object.defineProperty(window, 'webkitAudioContext', {
                        configurable: true,
                        value: undefined,
                    });
                });
            else await page.route('**/audio/atari-st/*.{wav,m4a}*', (route) => route.abort());
            try {
                await enter(page, activate, legacy ? '&legacy=1' : '');
                if (failure === 'missing-world' || failure === 'corrupt-art') {
                    assert.equal(await page.locator('#new-game').textContent(), 'Retry');
                    await page.unroute(pattern);
                    await activate(page.locator('#new-game'));
                    await page.waitForFunction(
                        () => document.getElementById('new-game')?.textContent === 'Start game',
                    );
                }
                await activate(page.locator('#new-game'));
                assert.equal(
                    await page.locator('#game').getAttribute('data-menu'),
                    'playing',
                    `${name} legacy${legacy} ${failure}`,
                );
                await activate(page.locator('#platforms'));
                await page.locator('#platform-picker').waitFor();
                assert.deepEqual(errors, []);
            } catch (error) {
                await page.screenshot({
                    path: `/tmp/exolon-atari-st-${name.toLowerCase()}-${legacy ? 'legacy' : 'modern'}-${failure}-failure.png`,
                    fullPage: true,
                });
                throw new Error(
                    `${name} legacy${legacy} ${failure}: ${String(error)}; errors=${JSON.stringify(errors)}`,
                    { cause: error },
                );
            } finally {
                await page.close();
            }
        }
    console.log(`PASS: ${name} Atari ST legacy Game Over and native/legacy resource retries.`);
    // A preset native identity must disappear when the picker chooses a classic game.
    for (const legacy of [false, true]) {
        const classic = await browser.newPage({ hasTouch: true });
        const errors = await prepare(classic);
        await classic.route(
            (url) => url.pathname.startsWith('/audio/') && /\.(wav|mp3|m4a)$/.test(url.pathname),
            (route) => route.abort(),
        );
        try {
            await classic.goto(ORIGIN + '?game=atari-st' + (legacy ? '&legacy=1' : ''));
            await activate(classic.locator('[data-platform="retro"][aria-disabled="false"]'));
            await classic.locator('#graphics-mode').waitFor({ state: 'attached' });
            assert.equal(await classic.locator('#graphics-mode').inputValue(), 'retro');
            assert.equal(
                await classic.evaluate(() => new URL(location.href).searchParams.get('game')),
                null,
                'Classic selection clears preset ST identity',
            );
            assert.equal(await classic.locator('[data-game="atari-st"]').count(), 0);
            assert.deepEqual(errors, []);
        } finally {
            await classic.close();
        }
    }
    // The latest choice wins while the ST component is still in flight, including
    // a classic choice that stays inside the original mounted picker.
    for (const target of ['amiga', 'retro']) {
        const rapid = await browser.newPage({ hasTouch: true });
        const rapidErrors = await prepare(rapid);
        let releaseModule!: () => void;
        const moduleGate = new Promise<void>((resolve) => {
            releaseModule = resolve;
        });
        await rapid.route('**/components/AtariGame/index.js{,?v=*}', async (route) => {
            const body = await readReferenceModule(route.request().url());
            if (body === null) throw new Error('Missing test reference Atari module');
            await moduleGate;
            await route.fulfill({
                contentType: 'application/javascript',
                body: body + '\nwindow.__atariLateModuleReady = true;\n',
            });
        });
        await rapid.route(
            (url) => url.pathname.startsWith('/audio/') && /\.(wav|mp3|m4a)$/.test(url.pathname),
            (route) => route.abort(),
        );
        try {
            await rapid.goto(ORIGIN + (target === 'retro' ? '?game=atari-st' : ''));
            const pendingModule = rapid.waitForRequest('**/components/AtariGame/index.js{,?v=*}');
            await activate(rapid.locator('[data-platform="atari-st"][aria-disabled="false"]'));
            await pendingModule;
            await activate(rapid.locator(`[data-platform="${target}"][aria-disabled="false"]`));
            if (target === 'amiga')
                await rapid
                    .locator('[data-game="amiga"] #new-game:not([disabled])')
                    .waitFor({ state: 'attached' });
            else await rapid.locator('#graphics-mode').waitFor({ state: 'attached' });
            const moduleResponse = rapid.waitForResponse('**/components/AtariGame/index.js{,?v=*}');
            releaseModule();
            await moduleResponse;
            await rapid.waitForFunction(() => window.__atariLateModuleReady);
            assert.equal(
                await rapid.locator('[data-game="atari-st"]').count(),
                0,
                `Obsolete ST import cannot replace the latest${target} choice`,
            );
            assert.equal(
                await rapid.evaluate(() => new URL(location.href).searchParams.get('game')),
                target === 'amiga' ? 'amiga' : null,
            );
            if (target === 'retro')
                assert.equal(await rapid.locator('#graphics-mode').inputValue(), 'retro');
            assert.deepEqual(rapidErrors, []);
        } finally {
            releaseModule();
            await rapid.close();
        }
    }
    // Release an obsolete ST download after another native game has taken ownership.
    const late = await browser.newPage({ hasTouch: true });
    const lateErrors = await prepare(late);
    await late.addInitScript(() =>
        Object.defineProperty(window, 'AbortController', { configurable: true, value: undefined }),
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    // A short valid excerpt avoids backpressure from an intentionally unread18MB
    // response after the disposed controller rejects it before arrayBuffer().
    const originalWave = await readFile(
        new URL('../../originals/audio/atari-st/title.wav', import.meta.url),
    );
    const staleWave = Buffer.from(originalWave.subarray(0, 44 + 4410 * 2));
    staleWave.writeUInt32LE(staleWave.length - 8, 4);
    staleWave.writeUInt32LE(staleWave.length - 44, 40);
    await late.route('**/audio/atari-st/title.m4a*', async (route) => {
        await gate;
        await route.fulfill({ contentType: 'audio/wav', body: staleWave });
    });
    try {
        const pending = late.waitForRequest('**/audio/atari-st/title.m4a*');
        await enter(late, activate);
        await pending;
        await activate(late.locator('#platforms'));
        await activate(late.locator('[data-platform="amiga"][aria-disabled="false"]'));
        await late
            .locator('[data-game="amiga"] #new-game:not([disabled])')
            .waitFor({ state: 'attached' });
        const settled = late.waitForResponse('**/audio/atari-st/title.m4a*');
        release();
        const response = await settled;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                response.finished(),
                new Promise<never>((_, reject) => {
                    deadline = setTimeout(
                        () =>
                            reject(new Error('Late audio response did not finish within5seconds')),
                        5000,
                    );
                }),
            ]);
        } finally {
            clearTimeout(deadline);
        }
        await late.waitForTimeout(30);
        assert.equal(
            await late.evaluate(() => window.__atariClosedDecodes),
            0,
            'Disposed ST never decodes a late response',
        );
        assert.equal(
            await late.evaluate(() =>
                window.__atariAudio.some((source) => source.context.state === 'closed'),
            ),
            false,
            'Disposed ST never creates a source after the late response',
        );
        assert.equal(await late.locator('[data-game="atari-st"]').count(), 0);
        assert.equal(
            await late.evaluate(
                (duration) =>
                    window.__atariAudio.some(
                        (source) => source.started && Math.abs(source.duration - duration) < 0.002,
                    ),
                TITLE_SECONDS,
            ),
            false,
            'Disposed ST cannot start after a late response without AbortController',
        );
        await activate(late.locator('#platforms'));
        await late.locator('#platform-picker').waitFor();
        await assertSilent(late);
        assert.deepEqual(lateErrors, []);
    } finally {
        release();
        await late.close();
    }
    console.log(
        `PASS: ${name} Atari ST native/legacy identity, original two-track audio, controls, isolated scores/cheats, retry and stale-resource cancellation.`,
    );
}
