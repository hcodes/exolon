import { prepareControl } from './control-navigation.ts';
import { openSettings, closeSettings, closeHome } from './navigation.ts';
import type { AmigaWorld } from '../../src/games/amiga/data/types.ts';
import type { AmigaGraphics } from '../../src/assets/graphics/amiga/types.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Browser, Locator, Page } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { AmigaState } from '../../src/games/amiga/types/index.ts';

declare global {
    interface Window {
        __amigaState: AmigaState;
        __amigaFrame: (now: number) => void;
        __amigaRaf: Set<number>;
        __amigaPad: {
            id: string;
            index: number;
            connected: boolean;
            mapping: string;
            axes: number[];
            buttons: { pressed: boolean; value: number }[];
        };
    }
}
async function observeAmiga(page: Page) {
    await page.route('**/games/amiga/model/index.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
        export * from './index.js?original';
        import {createAmigaState as create,stepAmiga as advance} from './index.js?original';
        export function createAmigaState(...args){return window.__amigaState=create(...args);}
        export function stepAmiga(...args){const result=advance(...args);window.__amigaState=result.state;return result;}
    `,
        }),
    );
}
export async function checkAmiga(
    browser: Browser,
    name: string,
    { prepare }: Pick<BrowserHelpers, 'prepare'>,
) {
    // Headless WebKit on macOS can deliver mouse coordinates outside the viewport.
    // Use touch activation there; pointer clicks remain covered in the other engines.
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
    const setChecked = async (locator: Locator, checked = true) => {
        if (name !== 'WebKit') {
            await locator.setChecked(checked);
            return;
        }
        // macOS headless WebKit mouse coordinates can miss controls; exercise native keyboard input.
        await locator.focus();
        if ((await locator.isChecked()) !== checked) await locator.press('Space');
        assert.equal(await locator.isChecked(), checked);
    };
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            viewport: { width: 1100, height: 900 },
            hasTouch: true,
        });
        await prepare(page);
        const removedModeRequests: string[] = [];
        page.on('request', (request) => {
            if (/\/amiga\/.*remastered|AmigaRemasteredSetting/i.test(request.url()))
                removedModeRequests.push(request.url());
        });
        // A saved value from the removed mode must not change the original game.
        await page.addInitScript(() => localStorage.setItem('exolon-amiga-remastered', 'true'));
        if (!legacy)
            await page.route('**/games/amiga/model/index.js{,?v=*}', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `
            export * from './index.js?original';
            import {createAmigaState as create,stepAmiga as advance} from './index.js?original';
            export function createAmigaState(...args){return window.__amigaState=create(...args);}
            export function stepAmiga(...args){const result=advance(...args);window.__amigaState=result.state;return result;}
        `,
                }),
            );
        try {
            await page.goto(
                `http://127.0.0.1:8091/?game=amiga&level=41${legacy ? '&legacy=1' : ''}`,
            );
            const link = page.locator('[data-platform="amiga"][aria-disabled="false"]');
            await link.waitFor();
            assert.equal(
                await link
                    .locator('img')
                    .evaluate((image) => (image as HTMLImageElement).naturalWidth),
                320,
            );
            await link.focus();
            await page.keyboard.press('Enter');
            await page
                .locator('[data-game="amiga"] #new-game:not([disabled])')
                .waitFor({ state: 'attached' });
            assert.equal(await page.locator('#graphics-mode').inputValue(), 'amiga');
            assert.equal(await page.locator('#monochrome').count(), 0);
            assert.equal(await page.locator('#amiga-remastered').count(), 0);
            assert.equal(await page.locator('#pause.pause-button_amiga').count(), 1);
            assert.equal(await page.locator('.game-viewport #settings-toggle').count(), 1);
            assert.equal(await page.locator('#split-divider').count(), 0);
            assert.equal(await page.locator('#platform-picker').count(), 0);
            assert.equal(await page.locator('#game').getAttribute('width'), '320');
            await page.waitForFunction(() => window.__exolonAudioSnapshot().audible === 1);
            assert.deepEqual(removedModeRequests, [], 'removed Amiga mode must never load');
            const title = await page
                .locator('#game')
                .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
            await activate(page.locator('#new-game'));
            await page.waitForFunction(
                () => document.getElementById('game')?.dataset.menu === 'playing',
            );
            assert.equal(await page.locator('#new-game').isVisible(), false);
            if (!legacy) {
                assert.equal(await page.evaluate(() => window.__amigaState.screenIndex), 40);
                const before = await page.evaluate(() => ({
                    time: performance.now(),
                    tick: window.__amigaState.tick,
                }));
                await page.waitForTimeout(1020);
                const after = await page.evaluate(() => ({
                    time: performance.now(),
                    tick: window.__amigaState.tick,
                }));
                const expectedTicks = (after.time - before.time) / 60;
                assert.ok(
                    Math.abs(after.tick - before.tick - expectedTicks) <= 2,
                    `${name} Amiga uses a 60ms gameplay step, independently of RAF`,
                );
            }
            await page.locator('#game').focus();
            await page.keyboard.down('ArrowRight');
            await page.waitForTimeout(90);
            await page.keyboard.up('ArrowRight');
            await activate(page.locator('#pause'));
            assert.equal(await page.locator('#pause').textContent(), 'Resume');
            assert.equal(
                await page.locator('#pause').evaluate((node) => getComputedStyle(node).borderColor),
                'rgb(164, 245, 219)',
            );
            assert.equal(await page.locator('#game').getAttribute('data-status'), 'paused');
            if (!legacy) {
                const tick = await page.evaluate(() => window.__amigaState.tick);
                await page.waitForTimeout(80);
                assert.equal(await page.evaluate(() => window.__amigaState.tick), tick);
            }
            assert.notEqual(
                await page
                    .locator('#game')
                    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
                title,
            );
            await openSettings(page);
            await setChecked(page.locator('[data-cheat="invulnerable"]'));
            await setChecked(page.locator('[data-cheat="infiniteAmmo"]'));
            await setChecked(page.locator('[data-cheat="levelSelection"]'));
            await closeSettings(page);
            await activate(page.locator('#next-screen'));
            assert.match((await page.locator('#cheat-screen').textContent()) || '', /042/);
            assert.equal(
                await page.evaluate(
                    () =>
                        JSON.parse(localStorage.getItem('exolon-amiga-cheats') || '{}')
                            .infiniteAmmo,
                ),
                true,
            );
            assert.equal(
                await page.evaluate(() => localStorage.getItem('exolon-cheats')),
                null,
                'Separate cheat namespace',
            );
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
            assert.equal(await page.locator('#pause').isVisible(), false);
            await activate(page.locator('#new-game'));
            if (!legacy)
                assert.equal(
                    await page.evaluate(() => window.__amigaState.screenIndex),
                    0,
                    'Menu resets to first screen',
                );
            await page.keyboard.press('Escape');
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
                );
                await page.waitForTimeout(40);
                await openSettings(page);
                for (const id of ['fullscreen', 'sound', 'cheat-settings', 'volume']) {
                    const box = await page.locator(`#${id}`).boundingBox();
                    assert.ok(
                        box && box.x >= 0 && box.x + box.width <= width + 1,
                        `${id} must be visible at ${width}`,
                    );
                }
            }
            await page.screenshot({
                path: `/tmp/reex-amiga-${name}-${legacy}.png`,
                fullPage: true,
            });
            await activate(page.locator('#platforms'));
            await page.locator('#platform-picker').waitFor();
            assert.equal(await page.locator('[data-game="amiga"]').count(), 0);
            await activate(page.locator('[data-platform="retro"][aria-disabled="false"]'));
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('split');
            assert.equal(await page.locator('#split-left option[value="amiga"]').count(), 0);
            assert.equal(await page.locator('#split-right option[value="amiga"]').count(), 0);
        } finally {
            await page.close();
        }
    }
    for (const scenario of ['rank', 'selected', 'remote', 'gamepad']) {
        const page = await browser.newPage({
            hasTouch: name === 'WebKit',
            userAgent: scenario === 'remote' ? 'Mozilla/5.0 SmartTV Tizen 7.0' : undefined,
        });
        await prepare(page);
        await observeAmiga(page);
        await page.route('**/audio/amiga/title.{wav,m4a}*', (route) => route.abort());
        if (scenario === 'gamepad')
            await page.addInitScript(() => {
                window.__amigaPad = {
                    id: 'Amiga test pad',
                    index: 0,
                    connected: true,
                    mapping: 'standard',
                    axes: [0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                };
                Object.defineProperty(Navigator.prototype, 'getGamepads', {
                    configurable: true,
                    value: () => [window.__amigaPad],
                });
                const request = window.requestAnimationFrame,
                    cancel = window.cancelAnimationFrame;
                window.__amigaRaf = new Set();
                window.requestAnimationFrame = (callback) => {
                    const id = request.call(window, (now) => {
                        window.__amigaRaf.delete(id);
                        callback(now);
                    });
                    window.__amigaRaf.add(id);
                    return id;
                };
                window.cancelAnimationFrame = (id) => {
                    window.__amigaRaf.delete(id);
                    cancel.call(window, id);
                };
            });
        try {
            await page.goto('http://127.0.0.1:8091/?game=amiga');
            await page.locator('[data-platform="amiga"][aria-disabled="false"]').waitFor();
            if (scenario === 'gamepad') {
                await page.waitForTimeout(80);
                await page.evaluate(() => {
                    window.__amigaPad.buttons[0] = { pressed: true, value: 1 };
                });
            } else await activate(page.locator('[data-platform="amiga"]'));
            await page
                .locator('[data-game="amiga"] #new-game:not([disabled])')
                .waitFor({ state: 'attached' });
            if (scenario === 'gamepad') {
                await page.evaluate(() => {
                    window.__amigaPad.buttons[0] = { pressed: false, value: 0 };
                });
                await page.waitForTimeout(80);
                assert.equal(
                    await page.evaluate(() => window.__amigaRaf.size),
                    1,
                    'Only the selected game owns a RAF',
                );
            }
            if (scenario === 'selected') {
                await openSettings(page);
                await setChecked(page.locator('[data-cheat="infiniteAmmo"]'));
                await setChecked(page.locator('[data-cheat="retryLevel"]'));
                await setChecked(page.locator('[data-cheat="levelSelection"]'));
                await closeSettings(page);
                await activate(page.locator('#next-screen'));
                await openSettings(page);
                await setChecked(page.locator('[data-cheat="levelSelection"]'), false);
                await closeSettings(page);
            }
            await activate(page.locator('#new-game'));
            if (scenario === 'rank' || scenario === 'selected') {
                await page.evaluate(() => {
                    window.__amigaState.score = 5000;
                    window.__amigaState.lives = 0;
                    window.__amigaState.player.deathTick = 14;
                });
                await page.waitForFunction(
                    () => document.getElementById('game')?.dataset.menu === 'end',
                );
                await activate(page.locator('#new-game'));
                await page.locator('#amiga-player-name').waitFor({ state: 'visible' });
                await page.locator('#amiga-player-name').fill('ORBIT');
                await page.locator('#amiga-player-name').press('Enter');
                const rows = (await page.evaluate(() =>
                    JSON.parse(localStorage.getItem('exolon-amiga-scores') || '[]'),
                )) as { name: string; score: number }[];
                assert.equal(rows.length, 34);
                assert.deepEqual(rows[0], { name: 'ORBIT', score: 5000 });
                assert.equal(
                    await page.evaluate(() =>
                        (localStorage.getItem('exolon-high-scores') || '').includes('ORBIT'),
                    ),
                    false,
                );
                if (scenario === 'selected') {
                    await activate(page.locator('#new-game'));
                    assert.equal(await page.locator('#game').getAttribute('data-menu'), 'playing');
                    assert.equal(
                        await page.evaluate(() => window.__amigaState.screenIndex),
                        1,
                        'Retry keeps the terminal screen after saving a qualifying score',
                    );
                }
            } else {
                await openSettings(page);
                if (scenario === 'gamepad') {
                    await page.waitForTimeout(60);
                    await page.evaluate(() => {
                        window.__amigaPad.buttons[1] = { pressed: true, value: 1 };
                    });
                } else await page.keyboard.press('Escape');
                await page.locator('#settings-panel').waitFor({ state: 'hidden' });
                assert.equal(await page.locator('#game').getAttribute('data-menu'), 'playing');
            }
        } finally {
            await page.close();
        }
    }
    const teleportPage = await browser.newPage({ hasTouch: name === 'WebKit' });
    await prepare(teleportPage);
    await observeAmiga(teleportPage);
    try {
        await teleportPage.goto('http://127.0.0.1:8091/?game=amiga&level=6');
        await activate(teleportPage.locator('[data-platform="amiga"][aria-disabled="false"]'));
        await activate(teleportPage.locator('#new-game:not([disabled])'));
        await teleportPage.waitForFunction(() => window.__amigaState?.tick > 2);
        const idle = await teleportPage.evaluate(() => {
            const context = (document.getElementById('game') as HTMLCanvasElement).getContext(
                '2d',
            )!;
            return Array.from(context.getImageData(96, 32, 32, 32).data);
        });
        await teleportPage.waitForTimeout(900);
        assert.deepEqual(
            await teleportPage.evaluate(() => {
                const context = (document.getElementById('game') as HTMLCanvasElement).getContext(
                    '2d',
                )!;
                return Array.from(context.getImageData(96, 32, 32, 32).data);
            }),
            idle,
            `${name} an unused teleport chamber never flashes`,
        );
        await teleportPage.evaluate(() => {
            const state = window.__amigaState;
            state.player.x = 84;
            state.player.y = 176;
            state.player.deathTick = 15;
            state.player.jumpKind = 0;
            state.options.invulnerable = true;
            state.entities = state.entities.filter((entity) => entity.kind === 'teleport');
        });
        await teleportPage.locator('#game').focus();
        await teleportPage.keyboard.down('ArrowUp');
        await teleportPage.waitForFunction(() => window.__amigaState.teleportPhase < 13);
        await teleportPage.keyboard.up('ArrowUp');
        await teleportPage.waitForFunction(() => window.__amigaState.teleportFrame >= 0);
        assert.equal(await teleportPage.evaluate(() => window.__amigaState.player.x), 100);
        await teleportPage.waitForFunction(() => window.__amigaState.teleportFrame === -1);
        await teleportPage.waitForTimeout(300);
        assert.equal(await teleportPage.evaluate(() => window.__amigaState.teleportPhase), 13);
    } finally {
        await teleportPage.close();
    }
    const turretPage = await browser.newPage({ hasTouch: name === 'WebKit' });
    await prepare(turretPage);
    await observeAmiga(turretPage);
    try {
        await turretPage.goto('http://127.0.0.1:8091/?game=amiga&level=4');
        await activate(turretPage.locator('[data-platform="amiga"][aria-disabled="false"]'));
        await activate(turretPage.locator('#new-game:not([disabled])'));
        await turretPage.waitForFunction(() => window.__amigaState?.tick > 2);
        await turretPage.evaluate(() => {
            const state = window.__amigaState;
            state.entities = state.entities.filter((entity) => entity.kind === 'turret');
            state.randomSeed = 0;
            state.randomSeedHigh = 0;
            state.player.x = 3;
            state.options.invulnerable = true;
        });
        await turretPage.waitForFunction(() =>
            window.__amigaState.entities.some(
                (entity) => entity.kind === 'enemy-bullet' && entity.type === 1,
            ),
        );
        await activate(turretPage.locator('#pause'));
        const shots = await turretPage.evaluate(() =>
            window.__amigaState.entities.filter((entity) => entity.kind === 'enemy-bullet'),
        );
        assert.ok(shots.length > 0, `${name} screen4 double turret fires`);
        assert.ok(shots.every((shot) => shot.type === 1 && shot.dx === -12));
        assert.ok(shots.every((shot) => shot.y === 28 || shot.y === 36));
    } finally {
        await turretPage.close();
    }
    const rocketPage = await browser.newPage({ hasTouch: name === 'WebKit' });
    await prepare(rocketPage);
    await observeAmiga(rocketPage);
    try {
        await rocketPage.goto('http://127.0.0.1:8091/?game=amiga&level=6');
        await activate(rocketPage.locator('[data-platform="amiga"][aria-disabled="false"]'));
        await activate(rocketPage.locator('#new-game:not([disabled])'));
        await rocketPage.waitForFunction(() => window.__amigaState?.tick > 2);
        const tick = await rocketPage.evaluate(() => {
            const state = window.__amigaState;
            const launcher = state.entities.find(
                (entity) => entity.kind === 'laser' && entity.type === 0,
            )!;
            state.options.invulnerable = true;
            state.entities = [
                launcher,
                {
                    id: 900,
                    kind: 'hunter',
                    x: 140,
                    y: 100,
                    width: 24,
                    height: 15,
                    frame: 0,
                    type: 1,
                    alive: true,
                    phase: 0,
                    dx: -5,
                    dy: 0,
                    parentId: launcher.id,
                },
                {
                    id: 901,
                    kind: 'bullet',
                    x: 132,
                    y: 100,
                    width: 14,
                    height: 6,
                    frame: 0,
                    type: 0,
                    alive: true,
                    phase: 0,
                    dx: 8,
                    dy: 0,
                    life: 10,
                },
            ];
            return state.tick;
        });
        await rocketPage.waitForFunction((tick) => window.__amigaState.tick > tick, tick);
        assert.equal(
            await rocketPage.evaluate(() =>
                window.__amigaState.entities.some((entity) => entity.id === 900),
            ),
            true,
            'guided rocket survives direct bullet',
        );
        await rocketPage.evaluate(() => {
            const state = window.__amigaState;
            const launcher = state.entities.find(
                (entity) => entity.kind === 'laser' && entity.type === 0,
            )!;
            state.entities.push({
                id: 902,
                kind: 'grenade',
                x: launcher.x - 3,
                y: launcher.y + 4,
                width: 14,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: 1,
                dy: 0,
            });
        });
        await rocketPage.waitForFunction(
            () =>
                !window.__amigaState.entities.some(
                    (entity) => entity.kind === 'laser' && entity.type === 0,
                ),
        );
        assert.equal(
            await rocketPage.evaluate(() =>
                window.__amigaState.entities.some(
                    (entity) => entity.kind === 'hunter' && entity.type === 1,
                ),
            ),
            false,
            'grenade destroys launcher and ends guided flight',
        );
        assert.ok(
            await rocketPage.evaluate(() =>
                window.__amigaState.entities.some((entity) => entity.kind === 'debris'),
            ),
            'destroyed original launcher emits flying fragments in the actual game',
        );
    } finally {
        await rocketPage.close();
    }
    const scoreReference = JSON.parse(
        await readFile(new URL('../../research/amiga-score-scroll.json', import.meta.url), 'utf8'),
    ) as {
        rgbaFrames: Record<string, string>;
        fullRgbaFrames: Record<string, string>;
        menuRgbaFrames: Record<string, string>;
        gameOver: { rgbaByStage: string[] };
    };
    const gameStarReference = JSON.parse(
        await readFile(new URL('../../research/amiga-game-stars.json', import.meta.url), 'utf8'),
    ) as { frames: Record<string, string> };
    const gameStarGraphics = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
            'utf8',
        ),
    ) as AmigaGraphics;
    for (const legacy of [false, true]) {
        const scorePage = await browser.newPage({ hasTouch: name === 'WebKit' });
        let gameOverPit = false;
        let pistonScene = false;
        let mineScene = false;
        let impactScene = false;
        await prepare(scorePage);
        await scorePage.addInitScript(() => {
            let sequence = 0;
            const pending = new Map<number, FrameRequestCallback>();
            window.requestAnimationFrame = (callback) => {
                pending.set(++sequence, callback);
                return sequence;
            };
            window.cancelAnimationFrame = (id) => {
                pending.delete(id);
            };
            window.__amigaFrame = (now) => {
                const callbacks = Array.from(pending.values());
                pending.clear();
                callbacks.forEach((callback) => callback(now));
            };
        });
        // Isolate the original gameplay sparkle from moving actors while retaining
        // the real controller, clock, compositor and native/legacy browser bundle.
        await scorePage.route('**/games/amiga/data/world.json*', async (route) => {
            const response = await route.fetch();
            const world = (await response.json()) as AmigaWorld;
            await route.fulfill({
                json: {
                    ...world,
                    screens: world.screens.map((screen, index) =>
                        index !== (pistonScene ? 9 : 0)
                            ? screen
                            : {
                                  ...screen,
                                  static: [],
                                  tiles: Array.from({ length: 920 }, (_, at) =>
                                      impactScene && at === 688
                                          ? 0xff
                                          : mineScene && at === 881
                                            ? 0xa2
                                            : at >= 880 && !gameOverPit
                                              ? 0x79
                                              : 0,
                                  ),
                              },
                    ),
                },
            });
        });
        await scorePage.route('**/assets/graphics/amiga/resources.json*', async (route) => {
            const response = await route.fetch();
            const graphics = (await response.json()) as AmigaGraphics;
            const retained = [
                'logo',
                'menu-stars',
                'score-pipe',
                'game-stars',
                'bullets',
                'window-tiles',
                'spikes',
                'debris',
                'small-explosion',
                'large-explosion',
            ];
            await route.fulfill({
                json: {
                    ...graphics,
                    tilesets: graphics.tilesets.map((tiles) =>
                        tiles.map((tile) => tile.map(() => 0)),
                    ),
                    resources: Object.fromEntries(
                        Object.entries(graphics.resources).map(([name, shape]) => [
                            name,
                            retained.includes(name) && !(impactScene && name === 'game-stars')
                                ? shape
                                : {
                                      ...shape,
                                      frames: shape.frames.map((frame) => frame.map(() => 0)),
                                  },
                        ]),
                    ),
                },
            });
        });
        try {
            await scorePage.goto('http://127.0.0.1:8091/?game=amiga' + (legacy ? '&legacy=1' : ''));
            await activate(scorePage.locator('[data-platform="amiga"][aria-disabled="false"]'));
            await scorePage.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await scorePage.evaluate(() => window.__amigaFrame(0));
            for (const frame of [0, 1, 7, 16]) {
                await scorePage.evaluate((now) => window.__amigaFrame(now), frame * 80);
                const pixels = await scorePage
                    .locator('#game')
                    .evaluate((canvas) =>
                        Array.from(
                            (canvas as HTMLCanvasElement)
                                .getContext('2d')!
                                .getImageData(0, 0, 320, 200).data,
                        ),
                    );
                assert.equal(
                    createHash('sha256').update(Uint8Array.from(pixels)).digest('hex'),
                    scoreReference.menuRgbaFrames[frame],
                    `${name} legacy${legacy}: original animated title stars frame${frame}`,
                );
            }
            await activate(scorePage.locator('#show-scores'));
            await scorePage.evaluate(() => window.__amigaFrame(10000));
            for (const frame of [9, 16, 147]) {
                await scorePage.evaluate((now) => window.__amigaFrame(now), 10000 + frame * 80);
                const pixels = await scorePage.evaluate(() => {
                    const context = (
                        document.getElementById('game') as HTMLCanvasElement
                    ).getContext('2d')!;
                    return Array.from(context.getImageData(0, 0, 320, 200).data);
                });
                assert.equal(
                    createHash('sha256').update(Uint8Array.from(pixels)).digest('hex'),
                    scoreReference.fullRgbaFrames[frame],
                    `${name} legacy${legacy}: original full score screen with pipes frame${frame}`,
                );
            }
            await activate(scorePage.locator('#new-game'));
            await scorePage.evaluate(() => window.__amigaFrame(30000));
            for (let tick = 0; tick <= 24; tick++) {
                if (tick)
                    await scorePage.evaluate((now) => window.__amigaFrame(now), 30000 + tick * 60);
                if (![0, 7, 8, 12, 16, 24].includes(tick)) continue;
                const rgba = await scorePage
                    .locator('#game')
                    .evaluate((canvas) =>
                        Array.from(
                            (canvas as HTMLCanvasElement)
                                .getContext('2d')!
                                .getImageData(0, 0, 320, 184).data,
                        ),
                    );
                const palette = gameStarGraphics.stagePalettes[0];
                const pixels = Uint8Array.from({ length: 320 * 184 }, (_, index) =>
                    palette.findIndex(
                        ([r, g, b]) =>
                            r === rgba[index * 4] &&
                            g === rgba[index * 4 + 1] &&
                            b === rgba[index * 4 + 2],
                    ),
                );
                assert.equal(
                    createHash('sha256').update(pixels).digest('hex'),
                    gameStarReference.frames[tick],
                    `${name} legacy${legacy}: original gameplay sparkle tick${tick}`,
                );
            }
            await scorePage.locator('#game').focus();
            await scorePage.keyboard.down('Space');
            for (let tick = 25; tick <= 37; tick++)
                await scorePage.evaluate((now) => window.__amigaFrame(now), 30000 + tick * 60);
            await scorePage.keyboard.up('Space');
            const rocketPixels = await scorePage
                .locator('#game')
                .evaluate((canvas) =>
                    Array.from(
                        (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 132, 32, 15)
                            .data,
                    ),
                );
            const originalRocket = gameStarGraphics.resources.bullets.frames[2];
            const rocketWithSmoke = new Uint8Array(32 * 15);
            // Held fire launches at tick35; at37 the rocket has taken two arc steps.
            // Original $98dc overlays two stationary puffs after the projectile.
            for (const [frame, left, top] of [
                [2, 12, 0],
                [6, 1, 9],
                [7, 4, 5],
            ]) {
                const source = gameStarGraphics.resources.bullets.frames[frame];
                for (let y = 0; y < 6; y++)
                    for (let x = 0; x < 16; x++) {
                        const ink = source[y * 16 + x];
                        if (ink) rocketWithSmoke[(top + y) * 32 + left + x] = ink;
                    }
            }
            assert.ok(originalRocket.some(Boolean));
            for (const [index, ink] of rocketWithSmoke.entries()) {
                if (!ink) continue;
                assert.deepEqual(
                    rocketPixels.slice(index * 4, index * 4 + 3),
                    [...gameStarGraphics.stagePalettes[0][ink]],
                    `${name} legacy${legacy}: the original rocket and both smoke puffs follow held fire`,
                );
            }
            assert.equal(await scorePage.locator('#game').getAttribute('data-menu'), 'playing');
            await activate(scorePage.locator('#pause'));
            await scorePage.evaluate(() => window.__amigaFrame(32300));
            const frozen = await scorePage
                .locator('#game')
                .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
            await scorePage.evaluate(() => window.__amigaFrame(32420));
            assert.equal(
                await scorePage
                    .locator('#game')
                    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
                frozen,
                'paused gameplay stars freeze in the actual browser bundle',
            );
            // A blank first map produces real repeated falls and Game Over even
            // in the legacy bundle, without exposing private model state.
            gameOverPit = true;
            await activate(scorePage.locator('#platforms'));
            await activate(scorePage.locator('[data-platform="amiga"][aria-disabled="false"]'));
            await activate(scorePage.locator('#new-game:not([disabled])'));
            await scorePage.evaluate(() => {
                window.__amigaFrame(40000);
                for (let tick = 1; tick <= 300; tick++) window.__amigaFrame(40000 + tick * 60);
            });
            assert.equal(await scorePage.locator('#game').getAttribute('data-menu'), 'end');
            const gameOverPixels = await scorePage
                .locator('#game')
                .evaluate((canvas) =>
                    Array.from(
                        (canvas as HTMLCanvasElement)
                            .getContext('2d')!
                            .getImageData(96, 72, 128, 48).data,
                    ),
                );
            assert.equal(
                createHash('sha256').update(Uint8Array.from(gameOverPixels)).digest('hex'),
                scoreReference.gameOver.rgbaByStage[0],
                `${name} legacy${legacy}: original blue Game Over dialog after actual life depletion`,
            );
            // Exercise a real screen-10 piston in both bundles. Only unrelated
            // artwork is hidden; source metadata, movement and clock stay intact.
            pistonScene = true;
            gameOverPit = false;
            await scorePage.goto(
                'http://127.0.0.1:8091/?game=amiga&level=10' + (legacy ? '&legacy=1' : ''),
            );
            await activate(scorePage.locator('[data-platform="amiga"][aria-disabled="false"]'));
            await activate(scorePage.locator('#new-game:not([disabled])'));
            const expectedPiston = gameStarGraphics.resources.spikes.frames[0].flatMap((ink) => [
                ...gameStarGraphics.stagePalettes[0][ink],
                255,
            ]);
            const extensionTick = await scorePage.evaluate((expected) => {
                const context = (document.getElementById('game') as HTMLCanvasElement).getContext(
                    '2d',
                )!;
                window.__amigaFrame(0);
                for (let tick = 1; tick <= 240; tick++) {
                    window.__amigaFrame(tick * 60);
                    const rgba = context.getImageData(64, 127, 32, 49).data;
                    if (expected.every((byte, index) => rgba[index] === byte)) return tick;
                }
                return 0;
            }, expectedPiston);
            assert.ok(extensionTick, `${name} legacy${legacy}: original piston fully extends`);
            await activate(scorePage.locator('#pause'));
            await scorePage.evaluate((tick) => {
                window.__amigaFrame((tick + 1) * 60);
                window.__amigaFrame((tick + 2) * 60);
            }, extensionTick);
            const pausedPiston = await scorePage
                .locator('#game')
                .evaluate((canvas) =>
                    Array.from(
                        (canvas as HTMLCanvasElement)
                            .getContext('2d')!
                            .getImageData(64, 127, 32, 49).data,
                    ),
                );
            assert.deepEqual(pausedPiston, expectedPiston, 'pausing freezes the extended piston');
            mineScene = true;
            pistonScene = false;
            await scorePage.goto('http://127.0.0.1:8091/?game=amiga' + (legacy ? '&legacy=1' : ''));
            await activate(scorePage.locator('[data-platform="amiga"][aria-disabled="false"]'));
            await activate(scorePage.locator('#new-game:not([disabled])'));
            const orangeBurst = await scorePage.evaluate(() => {
                const context = (document.getElementById('game') as HTMLCanvasElement).getContext(
                    '2d',
                )!;
                const countOrange = () => {
                    const rgba = context.getImageData(0, 70, 160, 105).data;
                    let count = 0;
                    for (let i = 0; i < rgba.length; i += 4)
                        if (rgba[i] === 204 && rgba[i + 1] === 68 && rgba[i + 2] === 0) count++;
                    return count;
                };
                window.__amigaFrame(0);
                const before = countOrange();
                for (let tick = 1; tick <= 4; tick++) window.__amigaFrame(tick * 60);
                return { before, after: countOrange() };
            });
            assert.ok(
                orangeBurst.after > orangeBurst.before + 50,
                `${name} legacy${legacy}: stepping onto a mine scatters original orange particles`,
            );
            // A real fired bullet hits an intact barrier: native and ES5 must use
            // the source32x8 impact, never the enemy's48x24 fireball.
            impactScene = true;
            mineScene = false;
            await scorePage.goto('http://127.0.0.1:8091/?game=amiga' + (legacy ? '&legacy=1' : ''));
            await activate(scorePage.locator('[data-platform="amiga"][aria-disabled="false"]'));
            await activate(scorePage.locator('#new-game:not([disabled])'));
            await scorePage.evaluate(() => window.__amigaFrame(0));
            const impactBackground = await scorePage
                .locator('#game')
                .evaluate((canvas) =>
                    Array.from(
                        (canvas as HTMLCanvasElement)
                            .getContext('2d')!
                            .getImageData(48, 140, 48, 24).data,
                    ),
                );
            await scorePage.locator('#game').focus();
            await scorePage.keyboard.down('Space');
            await scorePage.evaluate(() => {
                for (let tick = 1; tick <= 4; tick++) window.__amigaFrame(tick * 60);
            });
            await scorePage.keyboard.up('Space');
            const impactPixels = await scorePage
                .locator('#game')
                .evaluate((canvas) =>
                    Array.from(
                        (canvas as HTMLCanvasElement)
                            .getContext('2d')!
                            .getImageData(48, 140, 48, 24).data,
                    ),
                );
            const impactFrame = gameStarGraphics.resources['small-explosion'].frames[1];
            const palette = gameStarGraphics.stagePalettes[0];
            const expectedImpact = Array.from({ length: 48 * 24 }, (_, index) => {
                const x = index % 48,
                    y = Math.floor(index / 48);
                const ink = y >= 8 && y < 16 && x < 32 ? impactFrame[(y - 8) * 32 + x] : 0;
                return ink
                    ? [...palette[ink], 255]
                    : impactBackground.slice(index * 4, index * 4 + 4);
            }).flat();
            assert.deepEqual(
                impactPixels,
                expectedImpact,
                `${name} legacy${legacy}: a real bullet hitting a barrier produces the original small impact`,
            );
        } finally {
            await scorePage.close();
        }
    }
    for (const failure of ['amiga-module', 'classic-data', 'corrupt-art']) {
        const safe = await browser.newPage({ hasTouch: name === 'WebKit' });
        await safe.addInitScript(() => localStorage.setItem('exolon-settings-collapsed', 'false'));
        try {
            if (failure === 'amiga-module')
                await safe.route('**/games/amiga/model/index.js{,?v=*}', (route) => route.abort());
            if (failure === 'classic-data')
                await safe.route(
                    (url) => url.pathname === '/data/world.json',
                    (route) => route.abort(),
                );
            if (failure === 'corrupt-art')
                await safe.route('**/assets/graphics/amiga/resources.json*', async (route) => {
                    const response = await route.fetch();
                    const data = (await response.json()) as { text: Record<string, unknown> };
                    delete data.text.menu;
                    await route.fulfill({ json: data });
                });
            await safe.goto('http://127.0.0.1:8091/');
            if (failure === 'amiga-module') {
                await activate(safe.locator('[data-platform="retro"][aria-disabled="false"]'));
                await safe.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                assert.equal(await safe.locator('#graphics-mode').inputValue(), 'retro');
            } else {
                await activate(safe.locator('[data-platform="amiga"][aria-disabled="false"]'));
                await safe
                    .locator('[data-game="amiga"] #new-game:not([disabled])')
                    .waitFor({ state: 'attached' });
                if (failure === 'corrupt-art') {
                    assert.equal(await safe.locator('#new-game').textContent(), 'Retry');
                    await safe.unroute('**/assets/graphics/amiga/resources.json*');
                    await activate(safe.locator('#new-game'));
                    await safe.waitForFunction(
                        () => document.getElementById('new-game')?.textContent === 'Start game',
                    );
                } else assert.equal(await safe.locator('#game').getAttribute('data-menu'), 'title');
            }
        } finally {
            await safe.close();
        }
    }
    const failed = await browser.newPage({ hasTouch: name === 'WebKit' });
    await prepare(failed);
    try {
        await failed.route('**/games/amiga/data/world.json*', (route) => route.abort());
        await failed.goto('http://127.0.0.1:8091/');
        await activate(failed.locator('[data-platform="amiga"][aria-disabled="false"]'));
        await failed.waitForFunction(
            () => document.getElementById('new-game')?.textContent === 'Retry',
        );
        await activate(failed.locator('#platforms'));
        await activate(failed.locator('[data-platform="retro"][aria-disabled="false"]'));
        assert.equal(await failed.locator('#graphics-mode').inputValue(), 'retro');
    } finally {
        await failed.close();
    }
    console.log(
        `PASS: ${name} independent Amiga native/legacy, original title audio,125-screen assets, launchlevel, pause, cheats, menu reset, mobile, Split exclusion and resource fallback.`,
    );
}
