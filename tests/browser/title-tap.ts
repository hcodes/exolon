import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { MOBILE_USER_AGENT } from './devices.ts';

export async function checkTitleTap(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        for (const tablet of [false, true]) {
            const context = await browser.newContext({
                hasTouch: true,
                viewport: tablet ? { width: 820, height: 1180 } : { width: 390, height: 844 },
                userAgent: tablet
                    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'
                    : MOBILE_USER_AGENT,
            });
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.addInitScript(
                ({ legacy }) => {
                    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 });
                    if (legacy)
                        delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
                },
                { legacy },
            );
            try {
                for (const mode of [
                    'retro',
                    'c64',
                    'cpc',
                    'sharp-mz800',
                    'remastered',
                    'amiga',
                    'atari-st',
                ]) {
                    const label = `${name} ${legacy ? 'legacy' : 'modern'} ${tablet ? 'tablet' : 'phone'} ${mode}`;
                    await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                    await page.locator(`[data-platform="${mode}"][aria-disabled="false"]`).tap();
                    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                    const canvas = page.locator('#game');
                    assert.equal(await canvas.getAttribute('data-menu'), 'title', label);
                    if (mode === 'sharp-mz800') {
                        // Sharp renders its control menu on the initial title. Tap
                        // its original Start Game row in native 320 × 200 geometry.
                        const box = (await canvas.boundingBox())!;
                        await page.touchscreen.tap(
                            box.x + (box.width * 160) / 320,
                            box.y + (box.height * 92) / 200,
                        );
                    } else await canvas.tap();
                    const native = mode === 'amiga' || mode === 'atari-st';
                    await page.waitForFunction(
                        (native) => {
                            const menu = document.getElementById('game')?.dataset.menu;
                            return native ? menu === 'playing' : menu === undefined;
                        },
                        native,
                        { timeout: 3000 },
                    );
                    assert.equal(
                        await page
                            .locator('#pause')
                            .evaluate((element: HTMLButtonElement) =>
                                Boolean(element.hidden || element.disabled),
                            ),
                        false,
                        label,
                    );
                    if (!native)
                        assert.equal(
                            await page.locator('#ammo').textContent(),
                            '99',
                            `${label}: starting tap must not fire a shot`,
                        );
                }
                assert.deepEqual(errors, []);
                console.log(
                    `PASS: ${name} ${legacy ? 'legacy' : 'modern'} ${tablet ? 'tablet' : 'phone'} title taps start all seven platforms.`,
                );
            } finally {
                await context.close();
            }
        }
    }
}
