import { openGame, reloadGame, openHome, openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { installVrSupport } from './vr-support.ts';

async function frames(page: Page) {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                let count = 6;
                function next() {
                    if (--count === 0) resolve();
                    else requestAnimationFrame(next);
                }
                requestAnimationFrame(next);
            }),
    );
}

async function expectPaused(page: Page, paused: boolean) {
    await page.waitForFunction(
        (paused) =>
            document.getElementById('pause')?.getAttribute('aria-pressed') === String(paused),
        paused,
    );
}

async function checkModalScroll(page: Page, id: string, actionId: string) {
    const dialog = page.locator(`#${id}`);
    const heading = dialog.locator('h2').first();
    const action = dialog.locator(`#${actionId}`);
    const close = dialog.getByRole('button', { name: /^Close / });
    const content = dialog.locator('.modal-card__content');
    const before = {
        heading: await heading.boundingBox(),
        action: await action.boundingBox(),
        close: await close.boundingBox(),
    };
    const scroll = await content.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return element.scrollTop;
    });
    assert.ok(scroll > 0, `${id}: short viewports must allow content scrolling`);
    assert.deepEqual(await heading.boundingBox(), before.heading, 'The heading stays in place');
    assert.deepEqual(await action.boundingBox(), before.action, 'Actions stay in place');
    assert.deepEqual(await close.boundingBox(), before.close, 'The close button stays in place');
    assert.equal(
        await close.evaluate((element) => getComputedStyle(element).borderTopWidth),
        '0px',
        'The close button has no border',
    );
    const bounds = await dialog.locator('.modal-card').boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 241);
}

export async function checkGrayscale(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.route(/\.(wav|mp3|m4a)(\?|$)/, (route) => route.abort());
        try {
            await openGame(page, `http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            const grayscale = page.getByRole('checkbox', { name: 'Grayscale', exact: true });
            const canvasFilter = () =>
                page.locator('#game').evaluate((element) => getComputedStyle(element).filter);
            assert.equal(await grayscale.count(), 1, 'Settings offer a Grayscale checkbox');
            assert.equal(await grayscale.isChecked(), false);
            assert.equal(await canvasFilter(), 'none');
            await grayscale.focus();
            await page.keyboard.press('Space');
            assert.equal(await grayscale.isChecked(), true);
            assert.equal(await canvasFilter(), 'grayscale(1)');
            assert.equal(
                await page.evaluate(() => localStorage.getItem('exolon-monochrome')),
                'true',
            );
            await page.locator('#graphics-mode').selectOption('remastered');
            await page.locator('#game[data-graphics="remastered"]').waitFor();
            assert.equal(await canvasFilter(), 'grayscale(1)');
            await page.locator('#graphics-mode').selectOption('split');
            await page.locator('#game[data-graphics="split"]').waitFor();
            assert.equal(await canvasFilter(), 'grayscale(1)', 'Both Split sides use Grayscale');
            await reloadGame(page);
            assert.equal(await grayscale.isChecked(), true, 'Grayscale survives reload');
            assert.equal(await canvasFilter(), 'grayscale(1)');
            await grayscale.focus();
            await page.keyboard.press('Space');
            assert.equal(await grayscale.isChecked(), false);
            assert.equal(await canvasFilter(), 'none');
            assert.equal(
                await page.evaluate(() => localStorage.getItem('exolon-monochrome')),
                'false',
            );
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} Grayscale keyboard toggle, canvas filter, graphics/Split changes and saved preference in modern/legacy.`,
    );
}

export async function checkSettingsPanel(browser: Browser, name: string) {
    await checkGrayscale(browser, name);
    // macOS WebKit includes checkbox controls in keyboard navigation with Option+Tab.
    const checkboxTab = browser.browserType().name() === 'webkit' ? 'Alt+Tab' : 'Tab';
    for (const legacy of [false, true])
        for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
            if (platform === 'vr' && legacy) continue;
            const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
            if (platform === 'vr') await installVrSupport(page);
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.route(/\.(wav|mp3|m4a)(\?|$)/, (route) => route.abort());
            await page.addInitScript(() =>
                localStorage.setItem('exolon-settings-collapsed', 'false'),
            );
            await page.addInitScript(() => {
                window.__exolonVirtualPad = {
                    id: 'Settings controller',
                    index: 0,
                    connected: true,
                    mapping: 'standard',
                    axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                };
                window.__exolonVirtualPads = [];
                Object.defineProperty(navigator, 'getGamepads', {
                    configurable: true,
                    value: () => window.__exolonVirtualPads,
                });
            });
            try {
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                await page
                    .locator(`[data-platform="${platform}"][aria-disabled="false"]`)
                    .press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                if (platform === 'vr') await page.locator('#game[data-ready="true"]').waitFor();
                await frames(page);
                const panel = page.locator('#settings-panel');
                assert.equal(
                    await panel.isVisible(),
                    false,
                    'A saved expanded footer must not reopen a modal',
                );
                const bounds = await page.locator('#game').boundingBox();
                await openSettings(page);
                const settingsBounds = await panel.locator('.modal-card').boundingBox();
                assert.ok(
                    settingsBounds && settingsBounds.height <= 900 * 0.95 + 1,
                    `${name} ${platform} legacy=${legacy}: Settings must not exceed 95% of the viewport height`,
                );
                const cheats = panel.locator('#cheat-settings');
                const cheatGroup = panel.getByRole('group', { name: 'CHEAT MODE', exact: true });
                const cheatStorageKey =
                    platform === 'retro' ? 'exolon-cheats' : `exolon-${platform}-cheats`;
                assert.equal(
                    await page.getByRole('dialog').count(),
                    1,
                    'Settings is the only modal',
                );
                assert.equal(
                    await panel.getByRole('dialog').count(),
                    0,
                    'Cheats have no nested dialog',
                );
                assert.equal(await cheatGroup.evaluate((element) => element.tagName), 'FIELDSET');
                assert.equal(await cheatGroup.locator('legend').isVisible(), true);
                assert.equal(await cheatGroup.locator('#cheat-settings').count(), 1);
                assert.deepEqual(
                    await cheats
                        .locator('[data-cheat]')
                        .evaluateAll((fields) =>
                            fields.map((field) => field.getAttribute('data-cheat')),
                        ),
                    [
                        'infiniteLives',
                        'infiniteRockets',
                        'infiniteAmmo',
                        'invulnerable',
                        'levelSelection',
                        'retryLevel',
                    ],
                );
                assert.equal(await cheats.locator('input:enabled').count(), 6);
                const cheatRows = await cheats
                    .locator('.cheat-settings__option')
                    .evaluateAll((options) => {
                        const rows = new Map<number, number>();
                        for (const option of options) {
                            const top = Math.round(option.getBoundingClientRect().top);
                            rows.set(top, (rows.get(top) ?? 0) + 1);
                        }
                        return Array.from(rows.values());
                    });
                assert.deepEqual(
                    cheatRows,
                    [3, 3],
                    `${name} ${platform} legacy=${legacy}: wide Settings show three cheat options in each of two rows`,
                );
                const infiniteLives = cheats.locator('[data-cheat="infiniteLives"]');
                await infiniteLives.focus();
                for (const key of [
                    'infiniteRockets',
                    'infiniteAmmo',
                    'invulnerable',
                    'levelSelection',
                    'retryLevel',
                ]) {
                    await page.keyboard.press(checkboxTab);
                    assert.equal(
                        await page.evaluate(
                            () => (document.activeElement as HTMLElement | null)?.dataset.cheat,
                        ),
                        key,
                        'Tab visits each cheat option inside Settings',
                    );
                }
                const showFps = panel.getByRole('checkbox', { name: 'Show FPS', exact: true });
                assert.equal(await showFps.count(), 1, 'Settings offer an FPS checkbox');
                assert.equal(await showFps.isChecked(), false, 'FPS starts disabled');
                const fps = page.locator('#fps-counter');
                assert.equal(await fps.isVisible(), false);
                await showFps.focus();
                await page.keyboard.press('Space');
                assert.equal(await showFps.isChecked(), true);
                await page.waitForFunction(() =>
                    /^FPS: [1-9]\d*$/.test(
                        document.getElementById('fps-counter')?.textContent || '',
                    ),
                );
                assert.equal(await fps.isVisible(), true);
                assert.equal(
                    await page.evaluate(() => localStorage.getItem('exolon-show-fps')),
                    'true',
                );
                await showFps.press('Space');
                assert.equal(await fps.isVisible(), false);
                await panel.locator('#settings-close').focus();
                assert.equal(
                    await panel.getByRole('group', { name: 'Navigation', exact: true }).count(),
                    0,
                    'Navigation belongs to Home',
                );
                assert.equal(
                    await panel
                        .locator(
                            '#new-game, #pause, #restart, #menu, #show-controls, #show-scores, #back-title, #platforms, #vr-platforms',
                        )
                        .count(),
                    0,
                    'Settings contains no Home navigation controls',
                );
                const dismiss = panel
                    .locator('.modal-card__footer')
                    .getByRole('button', { name: 'Close', exact: true });
                assert.equal(await dismiss.count(), 1);
                assert.equal(await panel.getAttribute('aria-modal'), 'true');
                assert.equal(
                    await page.locator('#settings-toggle').getAttribute('aria-expanded'),
                    'true',
                );
                assert.deepEqual(
                    await page.locator('#game').boundingBox(),
                    bounds,
                    `${name} ${platform} legacy=${legacy}: Settings do not resize or scroll the game`,
                );
                assert.equal(
                    await page.evaluate(() => document.activeElement?.id),
                    'settings-close',
                );
                const lastControl = 'settings-dismiss';
                await page.locator(`#${lastControl}`).focus();
                await page.keyboard.press('Tab');
                assert.equal(
                    await page.evaluate(() => document.activeElement?.id),
                    'settings-close',
                );
                await page.keyboard.press('Shift+Tab');
                assert.equal(await page.evaluate(() => document.activeElement?.id), lastControl);
                await dismiss.press('Enter');
                await panel.waitFor({ state: 'hidden' });
                assert.equal(
                    await page.evaluate(() => document.activeElement?.id),
                    'settings-toggle',
                );
                await openSettings(page);
                await infiniteLives.press('Space');
                assert.equal(await infiniteLives.isChecked(), true);
                assert.equal(await panel.isVisible(), true, 'Changing cheats keeps Settings open');
                assert.equal(await page.getByRole('dialog').count(), 1);
                assert.equal(
                    await page.evaluate(
                        (key) =>
                            (
                                JSON.parse(localStorage.getItem(key) || '{}') as {
                                    infiniteLives?: boolean;
                                }
                            ).infiniteLives,
                        cheatStorageKey,
                    ),
                    true,
                    'A checkbox change is saved immediately',
                );
                await page.keyboard.press('Escape');
                assert.equal(await panel.isVisible(), false);
                assert.equal(
                    await page.evaluate(() => document.activeElement?.id),
                    'settings-toggle',
                );
                await openSettings(page);
                assert.equal(await infiniteLives.isChecked(), true, 'Escape keeps the change');
                await openHome(page);
                await page.locator('#new-game').press('Enter');
                await panel.waitFor({ state: 'hidden' });
                await expectPaused(page, false);

                await openSettings(page);
                await expectPaused(page, true);
                await page.keyboard.press('Escape');
                await panel.waitFor({ state: 'hidden' });
                await expectPaused(page, false);
                assert.equal(await page.evaluate(() => document.activeElement?.id), 'game');

                await openSettings(page);
                await infiniteLives.focus();
                await page.keyboard.press('Space');
                assert.equal(await infiniteLives.isChecked(), false);
                await page.keyboard.press('Escape');
                await expectPaused(page, false);
                assert.equal(await page.evaluate(() => document.activeElement?.id), 'game');

                await openSettings(page);
                assert.equal(
                    await infiniteLives.isChecked(),
                    false,
                    'Escape also keeps disabled cheats',
                );
                await openHome(page);
                await page.locator('#pause').press('Enter');
                await panel.waitFor({ state: 'hidden' });
                await expectPaused(page, false);
                await page.locator('#game').press('Pause');
                await expectPaused(page, true);
                await openSettings(page);
                await page.locator('#settings-dismiss').click();
                await expectPaused(page, true);

                await openHome(page);
                await page.locator('#pause').press('Enter');
                await expectPaused(page, false);
                await openSettings(page);
                await page.evaluate(() => {
                    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
                    document.dispatchEvent(new Event('visibilitychange'));
                    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
                    document.dispatchEvent(new Event('visibilitychange'));
                });
                await page.keyboard.press('Escape');
                await expectPaused(page, true);
                await openHome(page);
                await page.locator('#pause').press('Enter');
                await expectPaused(page, false);
                await openSettings(page);
                await panel.click({ position: { x: 2, y: 2 } });
                await expectPaused(page, false);

                await page.evaluate(() => {
                    window.__exolonVirtualPads = [window.__exolonVirtualPad];
                });
                await frames(page);
                await openSettings(page);
                await frames(page);
                await infiniteLives.focus();
                await frames(page);
                await page.evaluate(() => {
                    window.__exolonVirtualPads = [];
                });
                await frames(page);
                await page.keyboard.press('Escape');
                await expectPaused(page, true);
                await page.evaluate(() => {
                    window.__exolonVirtualPads = [window.__exolonVirtualPad];
                });
                await openHome(page);
                await page.locator('#pause').press('Enter');
                await expectPaused(page, false);

                await page.locator('#fullscreen').press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                            'true' &&
                        !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                );
                await openSettings(page);
                await page.locator('#settings-close').click();
                assert.equal(
                    await page.locator('#fullscreen').getAttribute('aria-pressed'),
                    'true',
                );
                await page.locator('#fullscreen').press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                            'false' &&
                        !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                );
                // Browsers may reserve Escape for leaving native fullscreen. Exercise
                // modal cancellation independently in the supported window fallback.
                await frames(page);
                await page.evaluate(() =>
                    Object.defineProperty(document, 'fullscreenEnabled', {
                        configurable: true,
                        value: false,
                    }),
                );
                await page.locator('#fullscreen').press('Enter');
                await page.waitForFunction(
                    () => !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                );
                await openSettings(page);
                await infiniteLives.focus();
                assert.equal(await page.getByRole('dialog').count(), 1);
                assert.equal(await panel.isVisible(), true);
                assert.equal(
                    await page.locator('#fullscreen').getAttribute('aria-pressed'),
                    'true',
                );
                await page.keyboard.press('Escape');
                assert.equal(
                    await page.locator('#fullscreen').getAttribute('aria-pressed'),
                    'true',
                    'Escape closes settings without leaving fullscreen',
                );
                await page.locator('#fullscreen').press('Enter');
                await page.waitForFunction(
                    () =>
                        document.getElementById('fullscreen')?.getAttribute('aria-pressed') ===
                            'false' &&
                        !(document.getElementById('fullscreen') as HTMLButtonElement).disabled,
                );
                await openSettings(page);
                await page.setViewportSize({ width: 320, height: 568 });
                const dialogBounds = await panel.locator('.modal-card').boundingBox();
                assert.ok(
                    dialogBounds &&
                        dialogBounds.x >= 0 &&
                        dialogBounds.x + dialogBounds.width <= 321 &&
                        dialogBounds.y >= 0 &&
                        dialogBounds.y + dialogBounds.height <= 569 &&
                        dialogBounds.height <= 568 * 0.95 + 1,
                );
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                    true,
                );
                await page.locator('#settings-close').click();
                await page.setViewportSize({ width: 568, height: 240 });
                await openSettings(page);
                await checkModalScroll(page, 'settings-panel', 'settings-dismiss');
                await cheats.locator('[data-cheat="retryLevel"]').focus();
                assert.equal(await cheats.locator('[data-cheat]').count(), 6);
                assert.equal(await page.getByRole('dialog').count(), 1);
                await page.locator('#settings-close').click();
                await page.setViewportSize({ width: 1100, height: 900 });
                await openSettings(page);
                await showFps.check();
                await page.locator('#settings-close').click();
                assert.equal(await fps.isVisible(), true, 'FPS stays visible outside Settings');
                if (platform === 'retro') {
                    // The same FPS controller and preference key serve every platform.
                    await reloadGame(page, false);
                }
                await openSettings(page);
                assert.equal(await showFps.isChecked(), true, 'FPS preference stays enabled');
                assert.equal(await fps.isVisible(), true);
                await showFps.uncheck();
                assert.equal(await fps.isVisible(), false);
                assert.deepEqual(errors, []);
            } finally {
                await page.close();
            }
        }
    const tv = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        userAgent:
            'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 WebAppManager',
    });
    try {
        await tv.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await openGame(tv, 'http://127.0.0.1:8091/?legacy=1', { expandSettings: false });
        await openHome(tv);
        assert.equal(
            await tv.evaluate(() => document.activeElement?.id),
            'platforms',
            'Home starts remote navigation at Platforms',
        );
        await tv.keyboard.press('ArrowDown');
        assert.equal(await tv.evaluate(() => document.activeElement?.id), 'new-game');
        await tv.evaluate(() => {
            const event = new KeyboardEvent('keydown', {
                key: 'Unidentified',
                bubbles: true,
                cancelable: true,
            });
            Object.defineProperty(event, 'keyCode', { value: 461 });
            document.activeElement!.dispatchEvent(event);
        });
        assert.equal(await tv.locator('#home-panel').isVisible(), false);
        await openSettings(tv);
        await tv.locator('#volume').focus();
        await tv.keyboard.press('ArrowDown');
        const lives = tv.locator('#settings-panel [data-cheat="infiniteLives"]');
        assert.equal(await lives.evaluate((element) => element === document.activeElement), true);
        await tv.keyboard.press('Enter');
        assert.equal(await lives.isChecked(), true);
        assert.equal(await tv.getByRole('dialog').count(), 1);
        await tv.keyboard.press('ArrowDown');
        assert.equal(
            await tv.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.cheat),
            'infiniteRockets',
        );
        await tv.keyboard.press('ArrowUp');
        assert.equal(await lives.evaluate((element) => element === document.activeElement), true);
        await tv.locator('#settings-close').focus();
        await tv.keyboard.press('ArrowUp');
        assert.equal(await tv.evaluate(() => document.activeElement?.id), 'settings-dismiss');
        await tv.keyboard.press('Enter');
        assert.equal(await tv.locator('#settings-panel').isHidden(), true);
        assert.equal(await tv.evaluate(() => document.activeElement?.id), 'settings-toggle');
        await openSettings(tv);
        assert.equal(await lives.isChecked(), true, 'TV changes survive closing Settings');
        await openHome(tv);
        await tv.locator('#new-game').press('Enter');
        await openSettings(tv);
        await expectPaused(tv, true);
        await tv.keyboard.press('Pause');
        assert.equal(await tv.locator('#settings-panel').isVisible(), false);
        await expectPaused(tv, false);
    } finally {
        await tv.close();
    }
    const blocked = await browser.newPage();
    try {
        await blocked.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await blocked.addInitScript(() => {
            Storage.prototype.getItem = () => {
                throw new DOMException('Blocked', 'SecurityError');
            };
            Storage.prototype.setItem = () => {
                throw new DOMException('Blocked', 'SecurityError');
            };
        });
        await openGame(blocked, 'http://127.0.0.1:8091/', { expandSettings: false });
        await openSettings(blocked);
        const showFps = blocked.getByRole('checkbox', { name: 'Show FPS', exact: true });
        assert.equal(await showFps.isChecked(), false);
        await showFps.check();
        assert.equal(await blocked.locator('#fps-counter').isVisible(), true);
        await showFps.uncheck();
        await blocked.locator('#settings-close').click();
        assert.equal(await blocked.locator('#settings-panel').isVisible(), false);
        assert.equal(
            await blocked.locator('#settings-toggle').getAttribute('aria-expanded'),
            'false',
        );
    } finally {
        await blocked.close();
    }
    console.log(
        `PASS: ${name} settings modal focus, pause ownership, immediate inline cheats, visibility, fullscreen, small screens and webOS Back in modern/legacy.`,
    );
}
