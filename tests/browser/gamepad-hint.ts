import { openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import type { VirtualGamepad } from './types.ts';
import { installVrSupport } from './vr-support.ts';

declare global {
    interface Window {
        __gamepadHintPads: VirtualGamepad[];
    }
}

async function choose(page: Page, platform: string) {
    await page.locator(`[data-platform="${platform}"][aria-disabled="false"]`).focus();
    await page.keyboard.press('Enter');
    await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
}

async function start(page: Page) {
    await page.locator('#game').focus();
    await page.keyboard.press('Enter');
}

async function prepare(page: Page) {
    page.setDefaultTimeout(10000);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await page.route(/\.(?:wav|mp3|m4a)(?:\?|$)/, (route) => route.abort());
    await page.addInitScript(() => {
        window.__gamepadHintPads = [];
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: () => window.__gamepadHintPads,
        });
    });
}

export async function checkGamepadHint(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage();
        await prepare(page);
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'getGamepads', { value: undefined });
        });
        try {
            await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            await choose(page, 'retro');
            await start(page);
            await page.evaluate(async () => {
                for (let frame = 0; frame < 4; frame++)
                    await new Promise<number>(requestAnimationFrame);
            });
            assert.equal(
                await page.locator('#gamepad-hint').isVisible(),
                false,
                `${name} legacy${legacy}: no gamepad recommendation without Gamepad API`,
            );
            assert.equal(
                await page.locator('#notifications').isVisible(),
                false,
                'Missing Gamepad API does not produce a notification',
            );
        } finally {
            await page.close();
        }
    }
    for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
        for (const legacy of platform === 'vr' ? [false] : [false, true]) {
            const page = await browser.newPage({
                viewport: { width: 390, height: 844 },
                hasTouch: true,
            });
            await prepare(page);
            if (platform === 'vr') await installVrSupport(page);
            try {
                const query = platform === 'retro' ? '' : `game=${platform}&`;
                await page.goto(`http://127.0.0.1:8091/?${query}${legacy ? 'legacy=1' : ''}`);
                await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
                if (
                    platform === 'vr' &&
                    !(await page.evaluate(() =>
                        Boolean(document.createElement('canvas').getContext('webgl2')),
                    ))
                ) {
                    console.log(`SKIP: ${name} gamepad hint in VR: WebGL 2 unavailable.`);
                    continue;
                }
                assert.equal(await page.locator('#gamepad-hint').isVisible(), false);
                await choose(page, platform);
                assert.equal(
                    await page.locator('#gamepad-hint').isVisible(),
                    false,
                    'No recommendation before gameplay',
                );
                await start(page);
                const hint = page.locator('#gamepad-hint');
                assert.equal(
                    await hint.isVisible(),
                    true,
                    `${name} ${platform} legacy${legacy}: first start without a gamepad`,
                );
                assert.match((await hint.textContent())!, /play with a gamepad/i);
                assert.equal(await hint.locator('.gamepad-hint__icon').isVisible(), true);
                const entry = await hint.evaluate((element) => {
                    const animation = element.getAnimations()[0];
                    if (!animation) return null;
                    animation.pause();
                    animation.currentTime = 0;
                    const initialY = element.getBoundingClientRect().y;
                    const initialOpacity = Number(getComputedStyle(element).opacity);
                    animation.finish();
                    return {
                        initialY,
                        initialOpacity,
                        finalY: element.getBoundingClientRect().y,
                        finalOpacity: Number(getComputedStyle(element).opacity),
                    };
                });
                assert.ok(entry, 'The recommendation animates into view');
                assert.ok(entry.initialY > entry.finalY, 'The recommendation rises from below');
                assert.ok(entry.initialOpacity < entry.finalOpacity);
                assert.equal(
                    await page.evaluate(() => document.activeElement?.id),
                    'game',
                    'Recommendation does not steal focus',
                );
                const bounds = await hint.boundingBox();
                assert.ok(bounds);
                assert.ok(Math.abs(bounds.x + bounds.width / 2 - 195) <= 1);
                assert.ok(bounds.y > 422 && bounds.y + bounds.height <= 844);
                const dismiss = page.getByRole('button', {
                    name: 'Dismiss gamepad recommendation',
                });
                await dismiss.focus();
                await page.keyboard.press('Enter');
                await page.waitForFunction(() => {
                    const hint = document.getElementById('gamepad-hint')!;
                    const opacity = Number(getComputedStyle(hint).opacity);
                    return !hint.hidden && opacity > 0 && opacity < 1;
                });
                await hint.waitFor({ state: 'hidden' });
                assert.equal(await page.evaluate(() => document.activeElement?.id), 'game');
                await page.keyboard.press('Escape');
                await start(page);
                assert.equal(
                    await hint.isVisible(),
                    false,
                    'Restart does not repeat the recommendation',
                );

                if (platform === 'retro' && !legacy) {
                    await page.locator('#settings-toggle').focus();
                    await page.keyboard.press('Enter');
                    await openSettings(page);
                    await page.locator('#graphics-mode').selectOption('amiga');
                    await page
                        .locator('[data-game="amiga"] #new-game:not([disabled])')
                        .waitFor({ state: 'attached' });
                    await start(page);
                    assert.equal(
                        await hint.isVisible(),
                        false,
                        'Platform replacement shares the same launch',
                    );
                    await page.reload();
                    await choose(page, 'amiga');
                    await start(page);
                    assert.equal(await hint.isVisible(), true, 'Reload starts a new launch');
                    await hint.waitFor({ state: 'hidden', timeout: 5700 });
                    await page.keyboard.press('Escape');
                    await start(page);
                    assert.equal(
                        await hint.isVisible(),
                        false,
                        'Automatic dismissal also consumes the recommendation',
                    );
                }
            } finally {
                await page.close();
            }
        }
    }
    const page = await browser.newPage();
    await prepare(page);
    try {
        await page.goto('http://127.0.0.1:8091/');
        await choose(page, 'retro');
        await page.evaluate(() => {
            window.__gamepadHintPads = [
                {
                    id: 'Connected controller',
                    index: 0,
                    connected: true,
                    mapping: '',
                    axes: [],
                    buttons: [],
                },
            ];
        });
        await start(page);
        assert.equal(
            await page.locator('#gamepad-hint').isVisible(),
            false,
            'Any connected controller suppresses the recommendation',
        );
        await page.evaluate(() => {
            window.__gamepadHintPads = [];
        });
        await page.keyboard.press('Escape');
        await start(page);
        assert.equal(
            await page.locator('#gamepad-hint').isVisible(),
            false,
            'Disconnecting after the first start does not introduce a late recommendation',
        );
        await page.reload();
        await choose(page, 'retro');
        await start(page);
        assert.equal(await page.locator('#gamepad-hint').isVisible(), true);
        await page.evaluate(() => dispatchEvent(new Event('gamepadconnected')));
        await page.locator('#gamepad-hint').waitFor({ state: 'hidden' });
        assert.equal(
            await page.locator('#gamepad-hint').isVisible(),
            false,
            'Connecting a gamepad dismisses the recommendation',
        );
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.reload();
        await choose(page, 'retro');
        await start(page);
        assert.equal(
            await page
                .locator('#gamepad-hint')
                .evaluate((element) => getComputedStyle(element).animationName),
            'none',
            'Reduced motion disables the entrance animation',
        );
    } finally {
        await page.close();
    }
    console.log(
        `PASS: ${name} one gamepad recommendation per page launch, first-start detection, centered mobile layout, dismissal/focus, timeout, reload and platform replacement in classic/native/VR and legacy.`,
    );
}
