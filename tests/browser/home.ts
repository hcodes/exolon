import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { World } from '../../src/types/game.ts';
import { MOBILE_USER_AGENT } from './devices.ts';
import { installVrSupport } from './vr-support.ts';
import { closeHome, openHome, openSettings } from './navigation.ts';

export async function checkHome(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await installVrSupport(page);
        try {
            await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            for (const platform of legacy
                ? ['retro', 'amiga', 'atari-st']
                : ['retro', 'amiga', 'atari-st', 'vr']) {
                await page.locator('#platform-picker').waitFor();
                assert.equal(
                    await page.getByRole('button', { name: 'Home', exact: true }).count(),
                    0,
                );
                if (platform === 'vr') {
                    await page.route('**/data/world.json{,?*}', async (route) => {
                        const response = await route.fetch();
                        const world = (await response.json()) as World;
                        world.screens[0].objects = Array.from({ length: 5 }, (_, index) => ({
                            id: 9000 + index,
                            type: 14,
                            x: 4,
                            y: 14,
                        }));
                        await route.fulfill({ response, json: world });
                    });
                }
                await page.locator(`[data-platform="${platform}"][aria-disabled="false"]`).click();
                await page.locator('#game').waitFor();
                const home = page.getByRole('button', { name: 'Home', exact: true });
                await home.waitFor();
                assert.equal(await home.getAttribute('aria-haspopup'), 'dialog');
                assert.equal(await home.locator('svg').isVisible(), true);
                const homeBox = (await home.boundingBox())!;
                const fullscreenBox = (await page.locator('#fullscreen').boundingBox())!;
                assert.equal(homeBox.y, fullscreenBox.y);
                assert.equal(homeBox.width, fullscreenBox.width);
                assert.equal(homeBox.x, 12, 'Home stays at the left screen edge');
                assert.ok(homeBox.x + homeBox.width < fullscreenBox.x);
                if (platform === 'vr') {
                    await page.locator('#game[data-ready="true"]').waitFor();
                    await page.locator('#game').press('Enter');
                    await page.waitForFunction(
                        () => document.getElementById('game')?.dataset.score === '5000',
                    );
                }
                // SVG clicks and keyboard activation open navigation without replacing the engine.
                if (platform === 'retro') await home.locator('svg').click();
                else {
                    await home.focus();
                    await page.keyboard.press('Enter');
                }
                const panel = page.getByRole('dialog', { name: 'Home', exact: true });
                await panel.waitFor();
                assert.equal(await page.locator('#game').count(), 1);
                assert.equal(await page.locator('#settings-panel #new-game').count(), 0);
                assert.equal(await panel.locator('#new-game').count(), 1);
                assert.equal(
                    await panel.getByRole('heading', { name: 'Home', exact: true }).count(),
                    0,
                    'Home is a popup without a heading, cross or Close action',
                );
                assert.equal(await panel.locator('[data-modal-close]').count(), 0);
                const firstAction = platform === 'vr' ? 'vr-platforms' : 'platforms';
                assert.equal(
                    await panel.getByRole('button').first().getAttribute('id'),
                    firstAction,
                );
                const actionRows = await panel.getByRole('button').evaluateAll((buttons) =>
                    buttons
                        .filter((button) => button.getClientRects().length > 0)
                        .map((button) => {
                            const box = button.getBoundingClientRect();
                            return Math.round(box.top + box.height / 2);
                        }),
                );
                assert.equal(new Set(actionRows).size, 1, 'Home actions stay in one row');
                const popupBox = (await panel.locator('.home-panel__content').boundingBox())!;
                assert.equal(popupBox.x, homeBox.x);
                assert.ok(popupBox.y > homeBox.y + homeBox.height);
                assert.equal(await home.getAttribute('aria-expanded'), 'true');
                assert.equal(await page.evaluate(() => document.activeElement?.id), firstAction);
                await panel.getByRole('button').last().focus();
                await page.keyboard.press('Tab');
                assert.equal(await page.evaluate(() => document.activeElement?.id), firstAction);
                await page.keyboard.press('Escape');
                assert.equal(await panel.isVisible(), false);
                assert.equal(
                    await page.evaluate(() => document.activeElement?.id),
                    platform === 'vr' ? 'game' : 'home',
                );
                await openHome(page);
                await panel.click({ position: { x: 2, y: 2 } });
                assert.equal(await panel.isVisible(), false, 'An outside click closes Home');
                await openSettings(page);
                assert.equal(await page.locator('#settings-panel').isVisible(), true);
                await openHome(page);
                assert.equal(await page.locator('#settings-panel').isVisible(), false);
                assert.equal(await page.getByRole('dialog').count(), 1);
                if (platform === 'vr') await closeHome(page);
                else await panel.locator('#new-game').press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('pause')?.getAttribute('aria-pressed') === 'false',
                );
                await openHome(page);
                assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
                await openSettings(page);
                assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), 'true');
                await openHome(page);
                await closeHome(page);
                await page.waitForFunction(
                    () =>
                        document.getElementById('pause')?.getAttribute('aria-pressed') === 'false',
                );
                await page.locator('#game').press('Pause');
                await openHome(page);
                await closeHome(page);
                assert.equal(
                    await page.locator('#pause').getAttribute('aria-pressed'),
                    'true',
                    'Closing Home preserves a manually paused game',
                );
                await openHome(page);
                await panel.locator('#pause').press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('pause')?.getAttribute('aria-pressed') === 'false',
                );
                await openHome(page);
                await page.evaluate(() => {
                    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                    document.dispatchEvent(new Event('visibilitychange'));
                    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                await closeHome(page);
                assert.equal(
                    await page.locator('#pause').getAttribute('aria-pressed'),
                    'true',
                    'Visibility loss revokes Home resumption',
                );
                await openHome(page);
                const platforms = panel.getByRole('button', { name: 'Platforms', exact: true });
                await platforms.press('Enter');
                await page.locator('#platform-picker').waitFor();
                assert.equal(await page.locator('#game').count(), 0);
                assert.equal(await home.count(), 0);
                assert.equal(await page.locator('[data-platform]').count(), 8);
                assert.equal(await page.locator('#fullscreen').isVisible(), true);
                if (platform === 'vr')
                    assert.equal(
                        await page.evaluate(() => localStorage.getItem('exolon-vr-best-score')),
                        '5000',
                        'Returning Home preserves the current VR best score',
                    );
            }
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
        const touch = await browser.newPage({
            viewport: { width: 390, height: 844 },
            userAgent: MOBILE_USER_AGENT,
            hasTouch: true,
        });
        await touch.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        try {
            await touch.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            await touch.locator('[data-platform="retro"][aria-disabled="false"]').tap();
            await touch.locator('#game').waitFor();
            const home = touch.getByRole('button', { name: 'Home', exact: true });
            for (const viewport of [
                { width: 390, height: 844 },
                { width: 844, height: 390 },
            ]) {
                await touch.setViewportSize(viewport);
                const homeBox = (await home.boundingBox())!;
                const fullscreenBox = (await touch.locator('#fullscreen').boundingBox())!;
                assert.equal(homeBox.y, 12, 'Home stays at the top edge in both orientations');
                assert.equal(homeBox.width, 44);
                assert.equal(homeBox.height, 44);
                assert.equal(homeBox.x, 12, 'Home stays at the left edge in both orientations');
                assert.ok(homeBox.x >= 0 && homeBox.x + homeBox.width < fullscreenBox.x);
            }
            await touch.setViewportSize({ width: 390, height: 844 });
            await home.tap();
            await touch.getByRole('dialog', { name: 'Home', exact: true }).waitFor();
            const mobileRows = await touch.locator('#home-panel button').evaluateAll((buttons) =>
                buttons
                    .filter((button) => button.getClientRects().length > 0)
                    .map((button) => {
                        const box = button.getBoundingClientRect();
                        return Math.round(box.top + box.height / 2);
                    }),
            );
            assert.equal(new Set(mobileRows).size, 1, 'Touch Home actions never wrap');
            assert.equal(
                await touch.locator('#home-panel button').evaluateAll((buttons) =>
                    buttons
                        .filter((button) => button.getClientRects().length > 0)
                        .every((button) => {
                            const range = document.createRange();
                            range.selectNodeContents(button);
                            return range.getClientRects().length === 1;
                        }),
                ),
                true,
                'Popup button labels stay on one line',
            );
            const scrolling = await touch.locator('.home-panel__content').evaluate((element) => ({
                scrolls: element.scrollWidth > element.clientWidth,
                right: element.getBoundingClientRect().right,
            }));
            assert.equal(scrolling.scrolls, true, 'Narrow screens can scroll the action row');
            assert.ok(scrolling.right <= 390 - 12);
            await home.tap();
            assert.equal(await touch.locator('#home-panel').isVisible(), false);
            await home.tap();
            await closeHome(touch);
            assert.equal(await touch.locator('#game').count(), 1);
            await home.tap();
            await touch.getByRole('button', { name: 'Platforms', exact: true }).press('Enter');
            await touch.locator('#platform-picker').waitFor();
            assert.equal(await home.count(), 0);
        } finally {
            await touch.close();
        }
    }
    console.log(
        `PASS: ${name} Home navigation popup, exclusive Settings, focus, Platforms action, keyboard/SVG/touch, modern/legacy and fixed top-left position in both orientations.`,
    );
}
