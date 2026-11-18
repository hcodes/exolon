import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { useReferenceRuntime } from './reference-mode.ts';
import { openSettings, closeSettings } from './navigation.ts';
import type { World } from '../../src/types/game.ts';

declare global {
    interface Window {
        __cheatSounds: { seconds: number; peak: number; loop: boolean }[];
        __cheatDecodes: number[];
    }
}
async function prepare(page: Page) {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await page.addInitScript(() => {
        window.__cheatSounds = [];
        window.__cheatDecodes = [];
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        const decode = Audio.prototype.decodeAudioData;
        Audio.prototype.decodeAudioData = function (bytes, success, failure) {
            const result = decode.call(this, bytes, success, failure);
            if (result)
                void result
                    .then((buffer) => window.__cheatDecodes.push(buffer.duration))
                    .catch(() => {});
            return result;
        };
        const create = Audio.prototype.createBufferSource;
        Audio.prototype.createBufferSource = function (...args) {
            const source = create.apply(this, args);
            const start = source.start;
            source.start = function (...values) {
                let peak = 0;
                const samples = source.buffer?.getChannelData(0);
                if (samples)
                    for (let index = 0; index < samples.length; index += 97)
                        peak = Math.max(peak, Math.abs(samples[index]));
                window.__cheatSounds.push({
                    seconds: source.buffer?.duration || 0,
                    peak,
                    loop: source.loop,
                });
                return start.apply(this, values);
            };
            return source;
        };
    });
    return errors;
}
async function define(page: Page, keys = 'zorba', holdFinal = false) {
    await page.locator('#game').focus();
    await page.keyboard.press('2');
    for (const key of keys.slice(0, -1)) await page.keyboard.press(key);
    if (holdFinal) await page.keyboard.down(keys.slice(-1));
    else await page.keyboard.press(keys.slice(-1));
}
export async function checkZxGameOver(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage();
        const errors = await prepare(page);
        let recordings = 0;
        page.on('request', (request) => {
            if (new URL(request.url()).pathname.endsWith('/zx-spectrum/cheat-enabled.wav'))
                recordings++;
        });
        // Empty first-screen pit consumes the real nine lives and emits Game Over.
        await page.route('**/data/world.json{,?v=*}', async (route) => {
            const response = await route.fetch();
            const world = (await response.json()) as World;
            world.screens[0] = {
                tiles: Array.from({ length: 768 }, () => null),
                objects: [],
                actions: [],
            };
            world.enemies = [];
            await route.fulfill({ response, json: world });
        });
        try {
            await page.goto(`http://127.0.0.1:8091/?graphics=retro${legacy ? '&legacy=1' : ''}`);
            await page.locator('[data-platform="retro"][aria-disabled="false"]').focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            assert.equal(recordings, 0, 'Game Over does not preload on the title');
            await page.locator('#game').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(
                () => document.getElementById('mission-status')?.textContent === 'SESSION ENDED',
                undefined,
                { timeout: 45000 },
            );
            await page.waitForFunction(() =>
                window.__cheatSounds.some(
                    (sound) => !sound.loop && Math.abs(sound.seconds - 102919 / 44100) < 0.002,
                ),
            );
            await page.waitForTimeout(200);
            const jingles = await page.evaluate(() =>
                window.__cheatSounds.filter(
                    (sound) => !sound.loop && Math.abs(sound.seconds - 102919 / 44100) < 0.002,
                ),
            );
            assert.equal(jingles.length, 1, 'the model event and end screen play one jingle');
            assert.ok(jingles[0].peak > 0.01, 'original Game Over is audible');
            assert.equal(recordings, 1, 'one lazy versioned recording request');
            assert.deepEqual(errors, []);
        } catch (error) {
            console.error({ name, legacy, errors, page: await page.locator('body').innerText() });
            throw error;
        } finally {
            await page.close();
        }
    }
    console.log(`PASS: ${name} original ZX Game Over after nine lives, modern and legacy.`);
}
export async function checkOriginalCheats(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        for (const platform of ['retro', 'cpc', 'sharp-mz800', 'c64', 'gameboy', 'split']) {
            const page = await browser.newPage();
            const errors = await prepare(page);
            await page.addInitScript(() =>
                localStorage.setItem('exolon-cheats', JSON.stringify({ infiniteAmmo: true })),
            );
            try {
                await page.goto(
                    `http://127.0.0.1:8091/?graphics=${platform}${legacy ? '&legacy=1' : ''}`,
                );
                const banner = ['gameboy', 'split'].includes(platform) ? 'retro' : platform;
                await page.locator(`[data-platform="${banner}"][aria-disabled="false"]`).focus();
                await page.keyboard.press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                if (platform === 'gameboy') {
                    await openSettings(page);
                    await page.locator('#graphics-mode').selectOption('gameboy');
                    await closeSettings(page);
                }
                if (platform === 'split') {
                    await openSettings(page);
                    await page.locator('#graphics-mode').selectOption('split');
                    await openSettings(page);
                    await page.locator('#split-left').selectOption('cpc');
                    await page.waitForFunction(() =>
                        document
                            .getElementById('game')
                            ?.getAttribute('aria-label')
                            ?.includes('SPACE: fire'),
                    );
                    await openSettings(page);
                    await page.locator('#split-right').selectOption('retro');
                    await closeSettings(page);
                }
                await page.waitForFunction(
                    () => document.getElementById('game')?.dataset.menu !== undefined,
                );
                const supported = ['retro', 'cpc', 'sharp-mz800', 'split'].includes(platform);
                await define(page, 'zorba', true);
                assert.equal(await page.locator('#notifications').textContent(), '');
                await page.keyboard.up('a');
                if (supported) {
                    await page.waitForFunction(
                        () =>
                            document.getElementById('notifications')?.textContent ===
                            'Infinite lives enabled',
                    );
                    assert.equal(await page.locator('#notifications').isVisible(), true);
                    assert.ok(
                        ['title', 'menu'].includes(
                            (await page.locator('#game').getAttribute('data-menu')) || '',
                        ),
                        platform,
                    );
                    const stored = await page.evaluate(() =>
                        JSON.parse(localStorage.getItem('exolon-cheats') || '{}'),
                    );
                    assert.equal(stored.infiniteLives, true);
                    assert.equal(stored.infiniteAmmo, true);
                    if (platform !== 'sharp-mz800')
                        await page.waitForFunction(() =>
                            window.__cheatSounds.some((s) => !s.loop && s.peak > 0.01),
                        );
                    else
                        assert.equal(
                            await page.evaluate(
                                () => window.__cheatSounds.filter((s) => !s.loop).length,
                            ),
                            0,
                        );
                    if (platform === 'split')
                        assert.ok(
                            await page.evaluate(() =>
                                window.__cheatSounds.some(
                                    (s) => !s.loop && Math.abs(s.seconds - 92390 / 44100) < 0.002,
                                ),
                            ),
                            'Split left CPC uses its own confirmation while right ZX supplies music',
                        );
                    await define(page, 'opqam');
                    assert.equal(
                        await page.evaluate(
                            () =>
                                JSON.parse(localStorage.getItem('exolon-cheats') || '{}')
                                    .infiniteLives,
                        ),
                        true,
                    );
                    await define(page);
                    assert.equal(
                        await page.locator('#notifications').textContent(),
                        'Infinite lives disabled',
                    );
                    assert.equal(
                        await page.evaluate(
                            () =>
                                JSON.parse(localStorage.getItem('exolon-cheats') || '{}')
                                    .infiniteLives,
                        ),
                        false,
                    );
                    assert.equal(
                        await page.locator('#game').evaluate((e) => e === document.activeElement),
                        true,
                    );
                } else {
                    assert.equal(await page.locator('#notifications').textContent(), '');
                    assert.equal(
                        await page.evaluate(
                            () =>
                                JSON.parse(localStorage.getItem('exolon-cheats') || '{}')
                                    .infiniteLives,
                        ),
                        undefined,
                    );
                }
                assert.deepEqual(errors, []);
            } finally {
                await page.close();
            }
        }
    }
    const latePage = await browser.newPage();
    await prepare(latePage);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let requested!: () => void;
    const request = new Promise<void>((resolve) => (requested = resolve));
    await latePage.route('**/audio/zx-spectrum/cheat-enabled.wav*', async (route) => {
        requested();
        await gate;
        await route.continue();
    });
    try {
        await latePage.goto('http://127.0.0.1:8091/?graphics=retro');
        await latePage.locator('[data-platform="retro"][aria-disabled="false"]').focus();
        await latePage.keyboard.press('Enter');
        await latePage.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await define(latePage);
        await request;
        await latePage.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        release();
        await latePage.waitForFunction(() =>
            window.__cheatDecodes.some((seconds) => Math.abs(seconds - 102919 / 44100) < 0.002),
        );
        assert.equal(
            await latePage.evaluate(() => window.__cheatSounds.filter((s) => !s.loop).length),
            0,
            'hidden title cancels pending confirmation',
        );
    } finally {
        release();
        await latePage.close();
    }
    for (const platform of ['amiga', 'atari-st']) {
        const page = await browser.newPage();
        const errors = await prepare(page);
        await useReferenceRuntime(page);
        const create = platform === 'amiga' ? 'createAmigaState' : 'createAtariStState';
        const step = platform === 'amiga' ? 'stepAmiga' : 'stepAtariSt';
        await page.route(`**/games/${platform}/model/index.js{,?v=*}`, (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `export * from './index.js?original';
                import {${create} as create} from './index.js?original';
                export function ${create}(...args){return create(...args);}
                export function ${step}(state){return {state:{...state,status:'over',score:999999},events:[]};}`,
            }),
        );
        try {
            await page.goto(`http://127.0.0.1:8091/?game=${platform}`);
            await page.locator(`[data-platform="${platform}"][aria-disabled="false"]`).focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await page.locator('#game').focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(
                () => document.getElementById('game')?.dataset.menu === 'end',
            );
            await page.locator('#game').focus();
            await page.keyboard.press('Enter');
            const field = page.locator(`#${platform}-player-name`);
            await field.waitFor({ state: 'attached' });
            await field.fill('');
            await page.keyboard.type('ad astra');
            await page.keyboard.press('Enter');
            await page.waitForFunction(
                () =>
                    document.getElementById('notifications')?.textContent ===
                    'Infinite lives enabled',
            );
            const saved = await page.evaluate(
                (platform) => ({
                    cheats: JSON.parse(localStorage.getItem(`exolon-${platform}-cheats`) || '{}'),
                    name: localStorage.getItem(`exolon-${platform}-name`),
                    scores: localStorage.getItem(`exolon-${platform}-scores`),
                }),
                platform,
            );
            assert.equal(saved.cheats.infiniteLives, true);
            assert.equal(saved.name, platform === 'amiga' ? 'AD ASTRA' : 'ad astra');
            const rows = JSON.parse(saved.scores || '[]') as { name: string; score: number }[];
            assert.equal(rows.length, 34);
            assert.deepEqual(
                rows[0],
                { name: platform === 'amiga' ? 'AD ASTRA' : 'ad astra', score: 999999 },
                'Secret activation saves its qualifying local score',
            );
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'scores');
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} original cheat definitions, notifications, toggle, sounds, legacy and native names.`,
    );
}
