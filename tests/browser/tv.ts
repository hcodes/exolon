import { activateControl, menuPresented } from './control-navigation.ts';
import { openGame, openHome, openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { World } from '../../src/types/game.ts';
import type { Browser, Page } from 'playwright';

const agents = [
    [
        'Samsung Tizen',
        'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 (KHTML, like Gecko) 108.0.5359.1/8.0 TV Safari/537.36',
        false,
    ],
    [
        'LG webOS',
        'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.211 Safari/537.36 WebAppManager',
        true,
    ],
    [
        'Android TV',
        'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
        false,
    ],
    [
        'Hisense VIDAA',
        'Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.65 Safari/537.36 OPR/46.0.2207.0 VIDAA/4.0',
        false,
    ],
    [
        'Hisense legacy',
        'Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.65 Safari/537.36 OPR/46.0.2207.0 Hisense',
        true,
    ],
] as const;

async function vendorKey(page: Page, keyCode: number) {
    return page.evaluate((keyCode) => {
        let prevented = false;
        for (const type of ['keydown', 'keyup']) {
            const event = new KeyboardEvent(type, {
                bubbles: true,
                cancelable: true,
                key: 'Unidentified',
            });
            Object.defineProperty(event, 'keyCode', { value: keyCode });
            (document.activeElement || document).dispatchEvent(event);
            prevented = prevented || event.defaultPrevented;
        }
        return prevented;
    }, keyCode);
}

export async function checkWebOs3Startup(browser: Browser, name: string) {
    for (const hasTouch of [false, true]) {
        const page = await browser.newPage({
            userAgent:
                'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.122 Safari/537.36 WebAppManager',
            viewport: { width: 1280, height: 720 },
            hasTouch,
        });
        const errors: string[] = [];
        const scripts: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (request.resourceType() === 'script') scripts.push(request.url());
        });
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.addInitScript(() => {
            for (const key of ['Symbol', 'fetch', 'URL', 'PointerEvent', 'AbortController'])
                delete (window as unknown as Record<string, unknown>)[key];
        });
        try {
            await page.goto('http://127.0.0.1:8091/');
            for (const platform of [
                'retro',
                'c64',
                'cpc',
                'sharp-mz800',
                'remastered',
                'amiga',
                'atari-st',
            ]) {
                const banner = page.locator(`[data-platform="${platform}"][aria-disabled="false"]`);
                await banner.focus();
                await page.keyboard.press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                const canvas = page.locator('#game');
                const bounds = await canvas.boundingBox();
                assert.ok(
                    bounds && bounds.height > 360 && bounds.width > 640,
                    `${name} webOS 3 touch${hasTouch} ${platform}: visible game canvas ${JSON.stringify(bounds)}`,
                );
                const drawn = await canvas.evaluate((canvas: HTMLCanvasElement) => {
                    const pixels = canvas
                        .getContext('2d')!
                        .getImageData(0, 0, canvas.width, canvas.height).data;
                    for (let index = 0; index < pixels.length; index += 4)
                        if (pixels[index] || pixels[index + 1] || pixels[index + 2]) return true;
                    return false;
                });
                assert.equal(drawn, true, `${name} webOS 3 ${platform}: title pixels are drawn`);
                await canvas.focus();
                await page.keyboard.press('Enter');
                if (platform === 'amiga' || platform === 'atari-st')
                    await page.locator('#game[data-menu="playing"]').waitFor();
                else await page.locator('#title-screen').waitFor({ state: 'hidden' });
                await page.getByRole('button', { name: 'Home', exact: true }).focus();
                await page.keyboard.press('Enter');
                await page.locator('#platforms').press('Enter');
                await page.locator('#platform-picker').waitFor();
            }
            assert.ok(scripts.some((url) => new URL(url).pathname === '/legacy/game.js'));
            assert.ok(!scripts.some((url) => new URL(url).pathname === '/runtime/main.js'));
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} webOS 3 automatic fallback without native Symbols, seven platforms drawn and started, with/without touch.`,
    );
}

async function checkTvSlowFrames(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            userAgent: agents[1][1],
            viewport: { width: 1920, height: 1080 },
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
        await page.addInitScript(() => {
            localStorage.setItem('exolon-cheats', JSON.stringify({ invulnerable: true }));
            const request = window.requestAnimationFrame.bind(window);
            window.requestAnimationFrame = function (callback) {
                return request(function (now) {
                    if (document.documentElement.dataset.tvTestSlow === 'true') {
                        window.setTimeout(function () {
                            const root = document.documentElement;
                            root.dataset.tvTestFrames = String(
                                Number(root.dataset.tvTestFrames || 0) + 1,
                            );
                            callback(performance.now());
                        }, 300);
                    } else callback(now);
                });
            };
            const clear = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                const root = document.documentElement;
                if (this.canvas.id === 'game' && root.dataset.tvTestDraws !== undefined)
                    root.dataset.tvTestDraws = String(Number(root.dataset.tvTestDraws) + 1);
                return clear.apply(this, args);
            };
        });
        try {
            await openGame(
                page,
                'http://127.0.0.1:8091/?mode=remastered' + (legacy ? '&legacy=1' : ''),
            );
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('remastered');
            await activateControl(page.locator('#new-game'));
            await page.waitForFunction(
                () => document.getElementById('pause')?.getAttribute('aria-pressed') === 'false',
            );
            await page.evaluate(() => {
                document.documentElement.dataset.tvTestSlow = 'true';
            });
            await page.waitForFunction(
                () => Number(document.documentElement.dataset.tvTestFrames) >= 5,
                null,
                { polling: 50 },
            );
            assert.equal(
                await page.locator('#pause').getAttribute('aria-pressed'),
                'false',
                `${name} legacy${legacy}: repeated 300ms frames must not auto-pause`,
            );
            await activateControl(page.locator('#pause'));
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
            await activateControl(page.locator('#pause'));
            await page.waitForFunction(
                () => Number(document.documentElement.dataset.tvTestFrames) >= 10,
                null,
                { polling: 50 },
            );
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
            assert.deepEqual(
                await page
                    .locator('#game')
                    .evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]),
                [512, 384],
                'TV Remastered reduces the backing raster without changing logical geometry',
            );
            await page.evaluate(() => {
                document.documentElement.dataset.tvTestSlow = 'false';
            });
            await page.waitForTimeout(400);
            const start = await page.evaluate(() => {
                document.documentElement.dataset.tvTestDraws = '0';
                return performance.now();
            });
            await page.waitForTimeout(1000);
            const rate = await page.evaluate((start) => {
                return (
                    (Number(document.documentElement.dataset.tvTestDraws) * 1000) /
                    (performance.now() - start)
                );
            }, start);
            assert.ok(rate > 0 && rate <= 32, `TV redraw rate must stay bounded: ${rate}`);
            await page.evaluate(() => window.dispatchEvent(new Event('blur')));
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(`PASS: ${name} TV slow frames, Resume, reduced raster, redraw cap and blur pause.`);
}

async function checkTvSettingsLayout(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            userAgent: agents[1][1],
            hasTouch: true,
            viewport: { width: 960, height: 540 },
        });
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
        try {
            await openGame(page, 'http://127.0.0.1:8091/' + (legacy ? '?legacy=1' : ''));
            for (const mode of ['retro', 'split']) {
                await openSettings(page);
                await page.locator('#graphics-mode').selectOption(mode);
                await page.waitForFunction(
                    (mode) => document.getElementById('game')?.dataset.graphics === mode,
                    mode,
                );
                for (const [width, height] of [
                    [960, 540],
                    [1280, 720],
                    [1920, 1080],
                ]) {
                    await page.setViewportSize({ width, height });
                    const layout = await page.evaluate(() => {
                        const footer = document.querySelector<HTMLElement>('.game-footer')!;
                        const bounds = footer.getBoundingClientRect();
                        return {
                            overflow: getComputedStyle(footer).overflowX,
                            containers: [
                                ...footer.querySelectorAll<HTMLElement>(
                                    '.game-footer__options, .settings-panel, .settings-group, .settings-group__body',
                                ),
                                footer,
                            ].map((element) => ({
                                className: element.className,
                                width: element.clientWidth,
                                scroll: element.scrollWidth,
                            })),
                            controls: [
                                ...footer.querySelectorAll<HTMLElement>(
                                    '#settings-panel button, #settings-panel select, #settings-panel input',
                                ),
                            ].map((element) => {
                                const rect = element.getBoundingClientRect();
                                return {
                                    id: element.id,
                                    bounds: {
                                        left: rect.left,
                                        right: rect.right,
                                        width: rect.width,
                                        height: rect.height,
                                    },
                                };
                            }),
                            left: bounds.left,
                            right: bounds.right,
                        };
                    });
                    for (const container of layout.containers) {
                        assert.ok(
                            container.scroll <= container.width + 1,
                            `${name} webOS legacy${legacy} ${mode} ${width}: horizontal overflow in ${JSON.stringify(container)}`,
                        );
                    }
                    assert.equal(
                        layout.overflow,
                        'hidden',
                        'TV settings have no horizontal scrollbar',
                    );
                    for (const control of layout.controls) {
                        if (!control.bounds.width || !control.bounds.height) continue;
                        assert.ok(
                            control.bounds.left >= layout.left &&
                                control.bounds.right <= layout.right,
                            `${name} webOS: ${control.id} stays inside the footer`,
                        );
                    }
                }
            }
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} webOS touch/legacy settings wrap without horizontal scrolling or clipped controls in ZX/Split.`,
    );
}

async function checkTvName(browser: Browser) {
    const context = await browser.newContext({
        userAgent: agents[0][1],
        viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await page.addInitScript(() => localStorage.setItem('exolon-settings-collapsed', 'true'));
    await page.route('**/data/world.json*', async (route) => {
        const response = await route.fetch();
        const world: World = await response.json(),
            last = world.screens[124];
        last.tiles = Array.from({ length: 768 }, (_, index) =>
            index >= 576
                ? { ...(last.tiles[index] || { shape: 0, color: 0 }), collision: 1, block: 33 }
                : null,
        );
        last.objects = [{ id: 1, type: 16, x: 2, y: 14 }];
        last.actions = [];
        last.placements = [];
        world.enemies = (world.enemies || []).filter((enemy) => enemy.screen !== 124);
        await route.fulfill({ json: world });
    });
    try {
        await openGame(page, 'http://127.0.0.1:8091/?debug=1&screen=124', {
            expandSettings: false,
        });
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve)),
                ),
        );
        await page.locator('#game').focus();
        await page.keyboard.press('Enter');
        await page.keyboard.down('ArrowRight');
        await page.locator('#name-entry:not([hidden])').waitFor();
        await page.keyboard.up('ArrowRight');
        assert.equal(
            await page
                .locator('#player-name')
                .evaluate((element) => element === document.activeElement),
            true,
        );
        assert.equal(
            await vendorKey(page, 461),
            false,
            'Back must remain available to the native TV keyboard',
        );
        assert.equal(await page.locator('#name-entry').getAttribute('hidden'), null);
        for (const keyCode of [50, 52, 53, 54, 56])
            assert.equal(await vendorKey(page, keyCode), false, 'Digits belong to name entry');
        await page.locator('#player-name').fill('TV');
        await page.keyboard.type('24568');
        assert.equal(await page.locator('#player-name').inputValue(), 'TV24568');
        const prevented = await page.locator('#player-name').evaluate((element) => {
            element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            const key = new KeyboardEvent('keydown', {
                code: 'Escape',
                key: 'Escape',
                bubbles: true,
                cancelable: true,
                isComposing: true,
            });
            element.dispatchEvent(key);
            element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
            return key.defaultPrevented;
        });
        assert.equal(prevented, false);
        assert.equal(await page.locator('#name-entry').getAttribute('hidden'), null);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('name-entry')!.hidden);
        assert.equal(
            await page.evaluate(
                () => JSON.parse(localStorage.getItem('exolon-player-record') || '{}').playerName,
            ),
            'TV24568',
        );
    } finally {
        await context.close();
    }
}

export async function checkTv(browser: Browser, name: string) {
    await checkWebOs3Startup(browser, name);
    await checkTvSlowFrames(browser, name);
    await checkTvSettingsLayout(browser, name);
    for (const [platform, userAgent, legacy] of agents) {
        const context = await browser.newContext({
            userAgent,
            viewport: { width: 1280, height: 720 },
        });
        const page = await context.newPage(),
            errors: string[] = [];
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        page.setDefaultTimeout(12000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() =>
            localStorage.setItem('exolon-cheats', JSON.stringify({ invulnerable: true })),
        );
        try {
            // Exercise legacy CSS/geometry together with the modern TV mode too.
            await page.goto('http://127.0.0.1:8091/' + (legacy ? '?legacy=1' : ''));
            await page.locator('[data-platform="remastered"][aria-disabled="false"]').waitFor();
            await page.locator('[data-platform="retro"][aria-disabled="false"]').focus();
            await page.keyboard.press('2');
            assert.equal(
                await page
                    .locator('[data-platform="remastered"]')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            await page.keyboard.press('6');
            assert.equal(
                await page
                    .locator('[data-platform="retro"]')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            await page.keyboard.press('5');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            const collapsed = await page.locator('#game').boundingBox();
            assert.ok(
                collapsed && collapsed.y >= 0 && collapsed.y + collapsed.height <= 721,
                `${name} ${platform}: the game must fit the screen with settings hidden`,
            );
            await page.locator('#settings-toggle').focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            assert.equal(await page.locator('.game-app_tv').count(), 1, platform);
            assert.equal(await page.locator('.tv-help').isVisible(), true);
            assert.equal(await page.locator('#touch').isVisible(), false);
            await openHome(page);
            await page.locator('#show-controls').focus();
            await page.keyboard.press('Enter');
            await page.keyboard.press('8');
            await page.keyboard.press('5');
            assert.match((await page.locator('#game').getAttribute('aria-label'))!, /Define keys/);
            for (const digit of ['2', '4', '5', '6', '8']) await page.keyboard.press(digit);
            assert.doesNotMatch(
                (await page.locator('#game').getAttribute('aria-label'))!,
                /Define keys/,
                'TV number buttons remain assignable during Define Keys',
            );
            await vendorKey(page, 461);
            for (const [width, height] of [
                [1280, 720],
                [1920, 1080],
                [3840, 2160],
            ]) {
                await page.setViewportSize({ width, height });
                const layout = await page.evaluate(() => {
                    const game = document.getElementById('game')!.getBoundingClientRect();
                    const footer = document.querySelector('footer')!.getBoundingClientRect();
                    return {
                        viewport: [innerWidth, innerHeight],
                        game: {
                            top: game.top,
                            bottom: game.bottom,
                            height: game.height,
                            left: game.left,
                            right: game.right,
                        },
                        footer: { top: footer.top, bottom: footer.bottom },
                        overflow:
                            document.documentElement.scrollWidth > innerWidth + 1 ||
                            document.documentElement.scrollHeight > innerHeight + 1,
                    };
                });
                assert.equal(layout.overflow, false, JSON.stringify({ name, platform, layout }));
                assert.ok(layout.game.height > height * 0.5, JSON.stringify(layout));
                assert.ok(layout.game.left > 0 && layout.game.right < width && layout.game.top > 0);
                assert.ok(
                    layout.footer.top >= layout.game.bottom - 1 && layout.footer.bottom < height,
                );
            }
            await page.setViewportSize({ width: 1280, height: 720 });
            await page.locator('#game').focus();
            await page.keyboard.down('5');
            await page.keyboard.down('5');
            await page.waitForFunction(() => document.getElementById('title-screen')!.hidden);
            assert.equal(
                await page.locator('#ammo').textContent(),
                '99',
                'Start 5 must not leak into fire',
            );
            await page.keyboard.up('5');
            await page.keyboard.down('Enter');
            await page.waitForFunction(() => document.getElementById('ammo')!.textContent !== '99');
            await page.keyboard.up('Enter');
            const rockets = await page.locator('#grenades').textContent();
            await page.keyboard.down('Enter');
            await page.waitForFunction(
                (before) => document.getElementById('grenades')!.textContent !== before,
                rockets,
            );
            await page.keyboard.up('Enter');
            // A fresh fire press needs a simulation step that observes release.
            await page.waitForTimeout(100);
            const beforeNumberFire = await page.locator('#ammo').textContent();
            await page.keyboard.down('5');
            await page.waitForFunction(
                (before) => document.getElementById('ammo')!.textContent !== before,
                beforeNumberFire,
            );
            const beforeNumberRocket = await page.locator('#grenades').textContent();
            await page.waitForFunction(
                (before) => document.getElementById('grenades')!.textContent !== before,
                beforeNumberRocket,
            );
            await page.keyboard.up('5');
            for (const keyCode of [50, 52, 54, 56])
                assert.equal(await vendorKey(page, keyCode), true, 'Legacy number controls');
            assert.equal(await vendorKey(page, 10252), true);
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'false');
            assert.equal(await vendorKey(page, platform === 'LG webOS' ? 461 : 10009), true);
            assert.equal(await menuPresented(page, 'title-screen'), true);
            await page.keyboard.press('8');
            assert.equal(
                await page
                    .locator('#fullscreen')
                    .evaluate((element) => element === document.activeElement),
                true,
                'The page-level Fullscreen control is first in remote navigation',
            );
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
            // Native fullscreen exit can restore the pre-entry canvas focus.
            await page.locator('#fullscreen').focus();
            await page.keyboard.press('ArrowDown');
            assert.equal(
                await page
                    .locator('#settings-toggle')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            await page.keyboard.press('Enter');
            assert.equal(
                await page.locator('#settings-toggle').getAttribute('aria-expanded'),
                'false',
            );
            await page.keyboard.press('Enter');
            assert.equal(
                await page.locator('#settings-toggle').getAttribute('aria-expanded'),
                'true',
            );
            await page.keyboard.press('ArrowDown');
            assert.equal(
                await page
                    .locator('#graphics-mode')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            const previous = await page.locator('#graphics-mode').inputValue();
            await page.keyboard.press('6');
            assert.notEqual(await page.locator('#graphics-mode').inputValue(), previous);
            assert.notEqual(
                await page
                    .locator('#graphics-mode')
                    .evaluate((element) => getComputedStyle(element).outlineStyle),
                'none',
            );
            // Prepare the last classic choice; intermediate native choices launch another engine.
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('remastered');
            await openSettings(page);
            await page.locator('#graphics-mode').focus();
            await page.keyboard.press('ArrowRight');
            assert.equal(await page.locator('#graphics-mode').inputValue(), 'split');
            await page.keyboard.press('2');
            assert.equal(
                await page
                    .locator('#settings-toggle')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            await page.keyboard.press('ArrowUp');
            assert.equal(
                await page
                    .locator('#split-divider')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            const boundary = Number(
                await page.locator('#split-divider').getAttribute('aria-valuenow'),
            );
            await page.keyboard.press('6');
            assert.ok(
                Number(await page.locator('#split-divider').getAttribute('aria-valuenow')) >
                    boundary,
                'Remote arrows must adjust Split',
            );
            await page.keyboard.press('ArrowDown');
            for (let i = 0; i < 30; i++) {
                if (
                    await page
                        .locator('#settings-panel [data-cheat="infiniteLives"]')
                        .evaluate((element) => element === document.activeElement)
                )
                    break;
                await page.keyboard.press('ArrowDown');
            }
            assert.equal(
                await page
                    .locator('#settings-panel [data-cheat="infiniteLives"]')
                    .evaluate((element) => element === document.activeElement),
                true,
            );
            const panel = page.locator('#settings-panel');
            const cheats = panel.locator('#cheat-settings');
            assert.equal(await page.getByRole('dialog').count(), 1, 'Settings is the only modal');
            assert.equal(await panel.getByRole('dialog').count(), 0);
            assert.equal(await cheats.locator('[data-cheat]').count(), 6);
            const group = panel.getByRole('group', { name: 'CHEAT MODE', exact: true });
            assert.equal(await group.evaluate((element) => element.tagName), 'FIELDSET');
            assert.equal(await group.locator('legend').isVisible(), true);
            const field = cheats.locator('[data-cheat="infiniteLives"]');
            const checked = await field.isChecked();
            await page.keyboard.press('5');
            assert.equal(await field.isChecked(), !checked);
            assert.equal(
                await page.evaluate(
                    () =>
                        (
                            JSON.parse(localStorage.getItem('exolon-cheats') || '{}') as {
                                infiniteLives?: boolean;
                            }
                        ).infiniteLives,
                ),
                !checked,
                'Remote checkbox changes apply immediately',
            );
            await page.keyboard.press('ArrowDown');
            assert.equal(
                await page.evaluate(
                    () => (document.activeElement as HTMLElement | null)?.dataset.cheat,
                ),
                'infiniteRockets',
            );
            await page.keyboard.press('ArrowUp');
            assert.equal(
                await field.evaluate((element) => element === document.activeElement),
                true,
            );
            await page.locator('#settings-close').focus();
            await page.keyboard.press('ArrowUp');
            assert.equal(
                await page.evaluate(() => document.activeElement?.id),
                'settings-dismiss',
                'Focus stays within Settings',
            );
            await vendorKey(page, 461);
            assert.equal(await panel.isVisible(), false);
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'settings-toggle');
            await page.keyboard.press('Enter');
            assert.equal(await field.isChecked(), !checked, 'Closing Settings keeps the change');
            await vendorKey(page, 461);
            assert.deepEqual(errors, []);
        } catch (error) {
            console.error(
                name,
                platform,
                await page.evaluate(() => ({
                    focus: document.activeElement?.id,
                    title: document.getElementById('title-screen')?.hidden,
                    intro: document.getElementById('game')?.hasAttribute('data-intro'),
                    status: document.getElementById('mission-status')?.textContent,
                    paused: document.getElementById('pause')?.getAttribute('aria-pressed'),
                    errors: document.getElementById('overlay-copy')?.textContent,
                })),
                errors,
            );
            throw error;
        } finally {
            await context.close();
        }
    }
    await checkTvName(browser);
    const desktop = await browser.newPage();
    try {
        await desktop.goto('http://127.0.0.1:8091/');
        await desktop.locator('[data-platform="retro"][aria-disabled="false"]').focus();
        await desktop.keyboard.press('2');
        await desktop.keyboard.press('5');
        assert.equal(await desktop.locator('#platform-picker').isVisible(), true);
        assert.equal(
            await desktop
                .locator('[data-platform="retro"]')
                .evaluate((element) => element === document.activeElement),
            true,
            'Desktop digits do not navigate or launch platforms',
        );
        await openGame(desktop, 'http://127.0.0.1:8091/');
        await desktop.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await desktop.locator('.game-app_tv').count(), 0);
        assert.equal(await desktop.locator('.tv-help').isVisible(), false);
    } finally {
        await desktop.close();
    }
    console.log(
        `PASS: ${name} Samsung/LG/Android/Hisense VIDAA TV UA, 720p/1080p/4K and legacy layout, collapsed/expanded game bounds, arrow/number controls, fire/rocket/start isolation, pause/Back, settings/modal focus, native numeric name entry and desktop isolation.`,
    );
}
