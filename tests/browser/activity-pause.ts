import { openHome } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { installVrSupport } from './vr-support.ts';

async function activity(page: Page, hidden: boolean, focused: boolean) {
    await page.evaluate(
        ({ hidden, focused }) => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: hidden });
            Object.defineProperty(document, 'hasFocus', {
                configurable: true,
                value: () => focused,
            });
            window.dispatchEvent(new Event(focused ? 'focus' : 'blur'));
            document.dispatchEvent(new Event('visibilitychange'));
        },
        { hidden, focused },
    );
}

async function expectPaused(page: Page, paused: boolean) {
    assert.equal(await page.locator('#pause').getAttribute('aria-pressed'), String(paused));
}

async function frames(page: Page) {
    await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
}

export async function checkActivityPause(browser: Browser, name: string) {
    for (const legacy of [false, true])
        for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
            if (platform === 'vr' && legacy) continue;
            const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.route(/\.(wav|mp3|m4a)(\?|$)/, (route) => route.abort());
            if (platform === 'vr') {
                await installVrSupport(page);
                await page.addInitScript(() => {
                    window.__exolonVirtualPad = {
                        id: 'Activity controller',
                        index: 0,
                        connected: true,
                        mapping: 'standard',
                        axes: [0, 0, 0, 0],
                        buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
                    };
                    window.__exolonVirtualPads = [window.__exolonVirtualPad];
                    Object.defineProperty(navigator, 'getGamepads', {
                        configurable: true,
                        value: () => window.__exolonVirtualPads,
                    });
                });
            }
            try {
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                await page
                    .locator(`[data-platform="${platform}"][aria-disabled="false"]`)
                    .press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                if (platform === 'vr') await page.locator('#game[data-ready="true"]').waitFor();
                await page.locator('#game').press('Enter');
                await expectPaused(page, false);

                // Blur and hidden may both arrive; neither may erase the pending resume.
                await activity(page, true, false);
                await expectPaused(page, true);
                await activity(page, false, false);
                await expectPaused(page, true);
                await activity(page, false, true);
                await expectPaused(page, false);
                assert.equal(await page.evaluate(() => document.activeElement?.id), 'game');

                // A window can lose focus without its tab becoming hidden.
                await activity(page, false, false);
                await expectPaused(page, true);
                await activity(page, false, true);
                await expectPaused(page, false);

                // Focus can arrive before visibility is restored on another browser.
                await activity(page, true, false);
                await activity(page, true, true);
                await expectPaused(page, true);
                await activity(page, false, true);
                await expectPaused(page, false);

                await activity(page, true, false);
                await page.evaluate(() => window.dispatchEvent(new Event('gamepaddisconnected')));
                await activity(page, false, true);
                await expectPaused(page, true);
                await page.locator('#game').press('Pause');
                await expectPaused(page, false);

                await page.locator('#game').press('Pause');
                await expectPaused(page, true);
                await activity(page, true, false);
                await activity(page, false, true);
                await expectPaused(page, true);

                await page.locator('#settings-toggle').press('Enter');
                await openHome(page);
                await page.locator('#pause').press('Enter');
                await expectPaused(page, false);
                await page.locator('#settings-toggle').press('Enter');
                await activity(page, true, false);
                await activity(page, false, true);
                await expectPaused(page, true);
                assert.equal(await page.locator('#settings-panel').isVisible(), true);
                await page.keyboard.press('Escape');
                await expectPaused(page, true);
                if (platform === 'vr') {
                    await page.locator('#game').press('Pause');
                    await frames(page);
                    await activity(page, true, false);
                    await frames(page);
                    await page.evaluate(() => {
                        // A background browser may deliver the disconnection event late.
                        window.__exolonVirtualPads = [];
                    });
                    await activity(page, false, true);
                    await frames(page);
                    await expectPaused(page, true);
                }
                assert.deepEqual(errors, []);
                console.log(
                    `PASS: ${name} ${platform} legacy=${legacy} activity resume and manual/modal pause ownership.`,
                );
            } finally {
                await page.close();
            }
        }
}
