import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { installVrSupport } from './vr-support.ts';
import { MOBILE_USER_AGENT } from './devices.ts';

async function expectPaused(page: Page, paused: boolean) {
    await page.waitForFunction(
        (paused) =>
            document.getElementById('pause')?.getAttribute('aria-pressed') === String(paused),
        paused,
        { timeout: 3000 },
    );
}

async function frames(page: Page) {
    await page.evaluate(async () => {
        for (let frame = 0; frame < 8; frame++) await new Promise<number>(requestAnimationFrame);
    });
}

async function padButton(page: Page, button: number, pressed: boolean) {
    await page.evaluate(
        ({ button, pressed }) => {
            window.__exolonVirtualPad.buttons[button] = { pressed, value: Number(pressed) };
        },
        { button, pressed },
    );
    await frames(page);
}

export async function checkPauseResume(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
            if (legacy && platform === 'vr') continue;
            const page = await browser.newPage({
                hasTouch: true,
                userAgent: MOBILE_USER_AGENT,
                viewport: { width: 390, height: 844 },
            });
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.route(/\.(wav|mp3|m4a)(\?|$)/, (route) => route.abort());
            if (platform === 'vr') await installVrSupport(page);
            await page.addInitScript(
                ({ legacy }) => {
                    if (legacy)
                        delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
                    window.__exolonVirtualPad = {
                        id: 'Resume controller',
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
                },
                { legacy },
            );
            try {
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                await page.locator(`[data-platform="${platform}"][aria-disabled="false"]`).tap();
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                const canvas = page.locator('#game');
                if (platform === 'vr') await page.locator('#game[data-ready="true"]').waitFor();
                await canvas.press('Enter');
                await expectPaused(page, false);
                for (const key of ['Enter', 'Space', 'KeyM', 'Pause']) {
                    await canvas.press('Pause');
                    await expectPaused(page, true);
                    await canvas.press(key);
                    await expectPaused(page, false);
                }
                for (const target of ['#game', '#touch [data-action="fire"]']) {
                    await canvas.press('Pause');
                    await expectPaused(page, true);
                    const ammo =
                        platform === 'retro'
                            ? await page.locator('#ammo').textContent()
                            : await canvas.getAttribute('data-ammo');
                    await page
                        .locator(target)
                        .tap(target === '#game' ? { position: { x: 8, y: 8 } } : {});
                    await expectPaused(page, false);
                    await frames(page);
                    if (ammo !== null)
                        assert.equal(
                            platform === 'retro'
                                ? await page.locator('#ammo').textContent()
                                : await canvas.getAttribute('data-ammo'),
                            ammo,
                            'A resume tap must not also fire',
                        );
                }
                for (const button of [0, 9, 2]) {
                    await canvas.press('Pause');
                    await expectPaused(page, true);
                    await frames(page);
                    await padButton(page, button, true);
                    await expectPaused(page, false);
                    await padButton(page, button, false);
                }
                await canvas.press('Pause');
                await page.locator('#settings-toggle').tap();
                await canvas.dispatchEvent('keydown', { code: 'Space', key: ' ' });
                await page.locator('#touch [data-action="fire"]').dispatchEvent('click');
                await frames(page);
                await expectPaused(page, true);
                assert.equal(await page.locator('#settings-panel').isVisible(), true);
                assert.deepEqual(errors, []);
                console.log(
                    `PASS: ${name} ${platform} legacy=${legacy} keyboard, screen/fire taps, gamepad resume and modal isolation.`,
                );
            } finally {
                await page.close();
            }
        }
    }
}
