import { activateControl, prepareControl } from './control-navigation.ts';
import { openGame, reloadGame, openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';

const URL = 'http://127.0.0.1:8091/';
const choices = ['retro', 'c64', 'cpc', 'sharp-mz800', 'gameboy', 'gameboy-color', 'remastered'];

export async function checkSplitPairUI(
    session: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
        overlayOpen,
        chooseCheats,
        expectMusic,
    }: Pick<
        BrowserHelpers,
        'prepare' | 'padFrames' | 'waitForPlaying' | 'overlayOpen' | 'chooseCheats' | 'expectMusic'
    >,
) {
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 }, hasTouch: true });
    await prepare(page);
    const activate = async (selector: string) => {
        if (selector === '#game') {
            await prepareControl(page.locator(selector));
            const options = { position: { x: 12, y: 12 } };
            if (name === 'WebKit') await page.locator(selector).tap(options);
            else await page.locator(selector).click(options);
        } else await activateControl(page.locator(selector), name === 'WebKit');
    };
    const pair = () =>
        page.evaluate(() => ({
            left: (document.getElementById('split-left') as HTMLSelectElement).value,
            right: (document.getElementById('split-right') as HTMLSelectElement).value,
        }));
    const select = async (side: string, value: string) => {
        await page.locator(`#split-${side}`).selectOption(value);
        await page.waitForFunction(
            ({ side, value }) =>
                (document.getElementById(`split-${side}`) as HTMLSelectElement).value === value,
            { side, value },
        );
    };
    const music = (label: string) =>
        page.waitForFunction(
            (label) => {
                const s = window.__exolonAudioSnapshot();
                return s.audible === 1 && s.active === 1 && s.status.includes(label);
            },
            label,
            { timeout: 30000 },
        );
    // Observe the real shared model without introducing production test hooks.
    await page.route('**/model/state.js{,?v=*}', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `
        export * from './state.js?pair-source';
        import {createState as create,step as advance} from './state.js?pair-source';
        export function createState(...args) {return window.__pairState=create(...args);}
        export function step(...args) {const result=advance(...args);window.__pairState=result.state;return result;}
    `,
        }),
    );
    try {
        await openGame(page, URL);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#split-options').isVisible(), false);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        await padFrames(page);
        assert.equal(await page.locator('#split-options').isVisible(), true);
        assert.deepEqual(await pair(), { left: 'retro', right: 'remastered' });
        assert.equal(
            await page.locator('#split-divider').getAttribute('aria-label'),
            'Boundary between ZX Spectrum and Remastered',
        );
        for (const side of ['left', 'right'])
            assert.deepEqual(
                await page
                    .locator(`#split-${side} option`)
                    .evaluateAll((options) =>
                        options.map((option) => (option as HTMLOptionElement).value),
                    ),
                choices,
            );
        await page.waitForFunction(
            () =>
                !document.querySelector<HTMLOptionElement>('#split-left option[value="c64"]')!
                    .disabled &&
                !document.querySelector<HTMLOptionElement>('#split-left option[value="cpc"]')!
                    .disabled,
        );
        await activate('#game');
        if (expectMusic) await expectMusic(page, `${name} default Split pair`, 'ambient');
        else await music('Ambient');
        await page.evaluate(() =>
            Promise.all(window.__exolonAudioContexts.map((context) => context.suspend())),
        );
        await select('left', 'gameboy');
        await music('Ambient');
        assert.equal(
            await page.evaluate(() =>
                window.__exolonAudioSnapshot().states.every((state) => state === 'running'),
            ),
            true,
            'A same-bank select gesture resumes suspended title audio',
        );
        for (const style of choices) {
            const before = await page.evaluate(() => window.__exolonAudioSnapshot().loops);
            await select('left', style);
            await padFrames(page);
            assert.equal(
                await page.evaluate(() => window.__exolonAudioSnapshot().loops),
                before,
                'Left graphics cannot restart the right music bank',
            );
            assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'split');
        }
        for (const [style, label] of [
            ['retro', 'ZX Spectrum'],
            ['c64', 'Commodore 64'],
            ['cpc', 'Amstrad CPC'],
            ['sharp-mz800', 'Sharp MZ-800'],
            ['gameboy', 'Game Boy'],
        ]) {
            await select('right', style);
            await music(label);
            assert.equal(
                await page.evaluate(() => window.__exolonAudioSnapshot().active),
                1,
                'Split has one right-pane music bank',
            );
        }
        const gb = await page.evaluate(() => window.__exolonAudioSnapshot().loops);
        await select('right', 'gameboy-color');
        await padFrames(page);
        assert.equal(
            await page.evaluate(() => window.__exolonAudioSnapshot().loops),
            gb,
            'Game Boy Color shares the existing Game Boy audio bank',
        );
        await select('left', 'gameboy-color');
        assert.deepEqual(
            await pair(),
            { left: 'gameboy-color', right: 'gameboy-color' },
            'Equal panes are valid',
        );
        await select('left', 'c64');
        await page.locator('#split-divider').focus();
        await page.keyboard.press('PageDown');
        assert.equal(
            await page.locator('#split-divider').getAttribute('aria-valuetext'),
            'Commodore 64 40%, Game Boy Color 60%',
        );
        if (chooseCheats) await chooseCheats(page, { invulnerable: true }, name === 'WebKit');
        await activate('#new-game');
        await waitForPlaying(page);
        await activate('#pause');
        const paused = await page.evaluate(() => JSON.stringify(window.__pairState)),
            hud = await page.locator('#hud').textContent();
        for (const style of choices) {
            await select('left', style);
            await select('right', style);
            await padFrames(page);
            assert.equal(
                await page.evaluate(() => JSON.stringify(window.__pairState)),
                paused,
                'Pair changes preserve paused model/tick',
            );
            assert.equal(await page.locator('#hud').textContent(), hud);
            assert.equal(await overlayOpen(page), true);
            assert.equal(await page.locator('#split-divider').getAttribute('aria-valuenow'), '40');
        }
        await activate('#pause');
        const live = await page.evaluate(() => ({
            tick: window.__pairState.tick,
            screen: window.__pairState.screenIndex,
            x: window.__pairState.player.x,
            ammo: window.__pairState.ammo,
        }));
        await select('left', 'retro');
        await select('right', 'cpc');
        await padFrames(page);
        const after = await page.evaluate(() => ({
            tick: window.__pairState.tick,
            screen: window.__pairState.screenIndex,
            x: window.__pairState.player.x,
            ammo: window.__pairState.ammo,
        }));
        assert.ok(after.tick >= live.tick, 'Live pair changes do not reset progress');
        assert.equal(after.screen, live.screen);
        assert.equal(after.x, live.x);
        assert.equal(after.ammo, live.ammo);
        assert.equal(await overlayOpen(page), false);
        await activate('#pause');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        assert.equal(await page.locator('#split-options').isVisible(), false);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('split');
        assert.deepEqual(await pair(), { left: 'retro', right: 'cpc' });
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.deepEqual(await pair(), { left: 'retro', right: 'cpc' });
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'split');
        assert.equal(await page.locator('#split-divider').getAttribute('aria-valuenow'), '50');
        for (const width of [320, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await padFrames(page);
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                'Footer pair controls wrap on mobile',
            );
            assert.equal(await page.locator('#split-left').isVisible(), true);
            assert.equal(await page.locator('#split-right').isVisible(), true);
        }
        await page.screenshot({
            path: `/tmp/exolon-split-pairs-mobile-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await page.setViewportSize({ width: 844, height: 390 });
        await activate('#fullscreen');
        await page.waitForFunction(
            () =>
                document
                    .querySelector<HTMLElement>('.game-app')!
                    .classList.contains('game-app_fullscreen') &&
                !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
        );
        await select('left', 'gameboy');
        await select('right', 'gameboy-color');
        assert.equal(await page.locator('#split-left').isVisible(), true);
        assert.equal(
            await page.locator('#split-divider').getAttribute('aria-label'),
            'Boundary between Game Boy and Game Boy Color',
        );
        await page.screenshot({
            path: `/tmp/exolon-split-pairs-fullscreen-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await activate('#fullscreen');
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-split-pairs-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }

    const menuPage = await session.newPage({
        viewport: { width: 1100, height: 1000 },
        hasTouch: true,
    });
    await prepare(menuPage);
    const clickPane = async (x: number, y = 92) => {
        const point = await menuPage.locator('#game').evaluate(
            (canvas, { x, y }) => {
                const box = canvas.getBoundingClientRect(),
                    width = Math.min(box.width, (box.height * 4) / 3),
                    height = (width * 3) / 4;
                return {
                    x: box.left + (box.width - width) / 2 + (x * width) / 256,
                    y: box.top + (box.height - height) / 2 + (y * height) / 192,
                };
            },
            { x, y },
        );
        if (name === 'WebKit') await menuPage.touchscreen.tap(point.x, point.y);
        else await menuPage.mouse.click(point.x, point.y);
        await padFrames(menuPage);
    };
    try {
        await openGame(menuPage, URL);
        await menuPage.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await openSettings(menuPage);
        await menuPage.locator('#graphics-mode').selectOption('split');
        await menuPage.waitForFunction(
            () =>
                !document.querySelector<HTMLOptionElement>('#split-left option[value="c64"]')!
                    .disabled &&
                !document.querySelector<HTMLOptionElement>('#split-left option[value="cpc"]')!
                    .disabled,
        );
        await openSettings(menuPage);
        await menuPage.locator('#split-left').selectOption('c64');
        await openSettings(menuPage);
        await menuPage.locator('#split-right').selectOption('cpc');
        await menuPage.waitForFunction(
            () =>
                (document.getElementById('split-left') as HTMLSelectElement).value === 'c64' &&
                (document.getElementById('split-right') as HTMLSelectElement).value === 'cpc',
        );
        await clickPane(160);
        assert.equal(
            await menuPage.locator('#game').getAttribute('data-menu'),
            'title',
            'CPC planet artwork has no drawn Start action',
        );
        await clickPane(96);
        assert.equal(
            await menuPage.locator('#game').getAttribute('data-menu'),
            'title',
            'C64 planet artwork has no drawn Start action',
        );
        await menuPage.waitForFunction(
            () => (document.getElementById('game') as HTMLCanvasElement).dataset.menu === 'menu',
            {},
            { timeout: 9000 },
        );
        await clickPane(96);
        await waitForPlaying(menuPage);
        await menuPage.keyboard.press('Escape');
        await openSettings(menuPage);
        await menuPage.locator('#split-left').selectOption('cpc');
        await openSettings(menuPage);
        await menuPage.locator('#split-right').selectOption('c64');
        await clickPane(96);
        assert.equal(await menuPage.locator('#game').getAttribute('data-menu'), 'title');
        await menuPage.locator('#split-divider').focus();
        await menuPage.keyboard.press('Home');
        for (let i = 0; i < 3; i++) await menuPage.keyboard.press('PageUp');
        await menuPage.waitForFunction(
            () => (document.getElementById('game') as HTMLCanvasElement).dataset.menu === 'menu',
            {},
            { timeout: 9000 },
        );
        await clickPane(96);
        await clickPane(96, 108);
        assert.equal(
            await menuPage.locator('#game').getAttribute('data-menu'),
            'menu',
            'The right pane does not own menu input',
        );
        await clickPane(64, 108);
        await waitForPlaying(menuPage);
        await menuPage.keyboard.press('Escape');
        await menuPage.locator('#split-divider').focus();
        await menuPage.keyboard.press('Home');
        for (let i = 0; i < 5; i++) await menuPage.keyboard.press('PageUp');
        await openSettings(menuPage);
        await menuPage.locator('#split-right').selectOption('retro');
        await clickPane(160);
        assert.equal(
            await menuPage.locator('#game').getAttribute('data-menu'),
            'title',
            'ZX loading artwork has no clickable Start Game yet',
        );
        await menuPage.waitForFunction(
            () => (document.getElementById('game') as HTMLCanvasElement).dataset.menu === 'menu',
            {},
            { timeout: 9000 },
        );
        await clickPane(96);
        assert.equal(
            await menuPage.locator('#game').getAttribute('data-menu'),
            'menu',
            'CPC Start Game uses its original lower row',
        );
        await clickPane(160);
        await clickPane(160, 108);
        assert.equal(
            await menuPage.locator('#game').getAttribute('data-menu'),
            'menu',
            'The right ZX pane does not own menu input',
        );
        await clickPane(96, 108);
        await waitForPlaying(menuPage);
    } finally {
        await menuPage.close();
    }

    // Desired preferences survive failed artwork and demand-driven installs. Pending
    // optional assets use a fallback after choosing an available startup banner.
    for (const scenario of [
        'missing-left',
        'missing-right',
        'selected-delay',
        'late-install',
        'malformed',
        'blocked',
    ]) {
        const safe = await session.newPage({ hasTouch: true });
        await prepare(safe);
        const gates: Partial<Record<'c64' | 'cpc', () => void>> = {};
        let markC64Held!: () => void;
        const c64Held = new Promise<void>((resolve) => {
            markC64Held = resolve;
        });
        try {
            await safe.addInitScript((scenario) => {
                localStorage.setItem(
                    'exolon-graphics',
                    scenario === 'late-install' ? 'retro' : 'split',
                );
                const desired = ['missing-right', 'late-install'].includes(scenario)
                    ? { left: 'gameboy-color', right: 'c64' }
                    : { left: 'c64', right: 'gameboy-color' };
                localStorage.setItem(
                    'exolon-split-pair',
                    scenario === 'malformed' ? '{' : JSON.stringify(desired),
                );
                if (scenario === 'blocked')
                    Storage.prototype.getItem = Storage.prototype.setItem = () => {
                        throw Error('Storage disabled');
                    };
            }, scenario);
            if (scenario.startsWith('missing'))
                await safe.route('**/assets/graphics/c64/c64-graphics.json*', (route) =>
                    route.abort(),
                );
            if (['selected-delay', 'late-install'].includes(scenario)) {
                await safe.route('**/assets/graphics/c64/c64-graphics.json*', async (route) => {
                    await new Promise<void>((resolve) => {
                        gates.c64 = resolve;
                        markC64Held();
                    });
                    await route.continue();
                });
                await safe.route(
                    '**/assets/graphics/amstrad-cpc/cpc-graphics.json*',
                    async (route) => {
                        await new Promise<void>((resolve) => {
                            gates.cpc = resolve;
                        });
                        await route.abort();
                    },
                );
            }
            await openGame(safe, URL);
            if (scenario === 'selected-delay') {
                await c64Held;
                await padFrames(safe);
                assert.equal(
                    await safe.locator('#new-game').isDisabled(),
                    false,
                    'An available startup banner opens while optional Split artwork is pending',
                );
                assert.equal(await safe.locator('#split-left').inputValue(), 'retro');
                gates.c64!();
                delete gates.c64;
                await safe.waitForFunction(
                    () =>
                        (document.getElementById('split-left') as HTMLSelectElement).value ===
                        'c64',
                );
            }
            await safe.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            if (scenario === 'late-install') {
                assert.equal(gates.c64, undefined, 'Inactive saved Split banks stay unrequested');
                await openSettings(safe);
                await safe.locator('#graphics-mode').selectOption('split');
                await c64Held;
                assert.equal(await safe.locator('#game').getAttribute('data-graphics'), 'retro');
                assert.equal(await safe.locator('#split-options').isVisible(), false);
                assert.equal(await safe.locator('#split-divider').isVisible(), false);
                assert.equal(await safe.locator('#split-left').inputValue(), 'gameboy-color');
                assert.equal(await safe.locator('#split-right').inputValue(), 'remastered');
                if (name === 'WebKit')
                    await safe.locator('#game').tap({ position: { x: 12, y: 12 } });
                else await safe.locator('#game').click({ position: { x: 12, y: 12 } });
                await safe.waitForFunction(
                    () =>
                        window.__exolonAudioSnapshot().audible === 1 &&
                        window.__exolonAudioSnapshot().status.includes('ZX Spectrum'),
                );
                gates.c64!();
                delete gates.c64;
                await safe.waitForFunction(
                    () =>
                        (document.getElementById('split-right') as HTMLSelectElement).value ===
                        'c64',
                );
                await safe.waitForFunction(() => {
                    const s = window.__exolonAudioSnapshot();
                    return s.active === 1 && s.audible === 1 && s.status.includes('Commodore 64');
                });
            }
            if (scenario === 'blocked') await safe.locator('#graphics-mode').selectOption('split');
            if (scenario.startsWith('missing'))
                await safe.waitForFunction(
                    () =>
                        document.querySelector<HTMLOptionElement>(
                            '#split-left option[value="c64"]',
                        )!.disabled,
                );
            const actual = await safe.evaluate(() => ({
                left: (document.getElementById('split-left') as HTMLSelectElement).value,
                right: (document.getElementById('split-right') as HTMLSelectElement).value,
            }));
            const expected = ['blocked', 'malformed'].includes(scenario)
                ? { left: 'retro', right: 'remastered' }
                : scenario === 'missing-left'
                  ? { left: 'retro', right: 'gameboy-color' }
                  : scenario === 'missing-right'
                    ? { left: 'gameboy-color', right: 'remastered' }
                    : scenario === 'late-install'
                      ? { left: 'gameboy-color', right: 'c64' }
                      : { left: 'c64', right: 'gameboy-color' };
            assert.deepEqual(actual, expected, `${name}: ${scenario} pair`);
            if (!['blocked', 'malformed'].includes(scenario))
                assert.deepEqual(
                    await safe.evaluate(() =>
                        JSON.parse(localStorage.getItem('exolon-split-pair')!),
                    ),
                    ['missing-right', 'late-install'].includes(scenario)
                        ? { left: 'gameboy-color', right: 'c64' }
                        : { left: 'c64', right: 'gameboy-color' },
                    'Effective fallback cannot overwrite the desired pair',
                );
            if (scenario === 'blocked') {
                await openSettings(safe);
                await safe.locator('#split-left').selectOption('gameboy');
                assert.equal(await safe.locator('#split-left').inputValue(), 'gameboy');
            }
        } finally {
            for (const release of Object.values(gates)) release();
            await safe.unrouteAll({ behavior: 'wait' });
            await safe.close();
        }
    }
    console.log(
        `PASS: ${name} Split pair footer choices, equal styles, saved/default/fallback/late artwork, state/HUD/divider, right audio bank, Game Boy alias, aria, mobile and Fullscreen.`,
    );
}
