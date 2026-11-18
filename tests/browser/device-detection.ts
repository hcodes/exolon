import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { MOBILE_USER_AGENT, LEGACY_MOBILE_USER_AGENT } from './devices.ts';
import { installVrSupport } from './vr-support.ts';

export async function checkDeviceDetection(browser: Browser, name: string) {
    const devices = [
        { label: 'Android phone', userAgent: MOBILE_USER_AGENT, mobile: true, fullscreen: true },
        {
            label: 'Android tablet',
            userAgent:
                'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
            mobile: true,
            fullscreen: true,
        },
        {
            label: 'iPhone',
            userAgent:
                'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
            mobile: true,
            fullscreen: false,
        },
        {
            label: 'iPad Safari',
            userAgent:
                'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
            mobile: true,
            fullscreen: false,
        },
        {
            label: 'iPod Safari 9',
            userAgent: LEGACY_MOBILE_USER_AGENT,
            mobile: true,
            fullscreen: false,
        },
        {
            label: 'iPad desktop UA',
            userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
            mobile: true,
            fullscreen: false,
        },
        {
            label: 'Mac desktop',
            userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
            maxTouchPoints: 0,
            mobile: false,
            fullscreen: true,
        },
        {
            label: 'Quest with Mobile UA',
            userAgent:
                'Mozilla/5.0 (Linux; Android 10; Quest 3S) AppleWebKit/537.36 OculusBrowser/34.0 Chrome/130.0 Mobile Safari/537.36',
            mobile: false,
            fullscreen: true,
        },
        {
            label: 'touch desktop',
            userAgent:
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36',
            mobile: false,
            fullscreen: true,
        },
        {
            label: 'Android TV',
            userAgent:
                'Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
            mobile: false,
            fullscreen: true,
        },
    ];
    for (const device of devices) {
        for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
            const legacy = device.label === 'iPod Safari 9';
            if (legacy && platform === 'vr') continue;
            const page = await browser.newPage({
                viewport: { width: 390, height: 844 },
                userAgent: device.userAgent,
                hasTouch: true,
            });
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            try {
                if (platform === 'vr') await installVrSupport(page);
                await page.route('https://mc.yandex.ru/**', (route) =>
                    route.fulfill({ status: 204, body: '' }),
                );
                await page.addInitScript(
                    (maxTouchPoints) =>
                        Object.defineProperty(navigator, 'maxTouchPoints', {
                            configurable: true,
                            value: maxTouchPoints,
                        }),
                    device.maxTouchPoints ?? 5,
                );
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                await page.locator('#platform-picker').waitFor();
                assert.equal(
                    await page.locator('#fullscreen').isVisible(),
                    device.fullscreen,
                    `${name} ${device.label}: picker Fullscreen visibility`,
                );
                await page
                    .locator(`[data-platform="${platform}"][aria-disabled="false"]`)
                    .press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                if (platform === 'vr') await page.locator('#game[data-ready="true"]').waitFor();
                for (const [width, height] of [
                    [390, 844],
                    [844, 390],
                ]) {
                    await page.setViewportSize({ width, height });
                    const context = `${name} ${device.label} ${platform} ${width}×${height}`;
                    assert.equal(
                        await page.locator('#fullscreen').isVisible(),
                        device.fullscreen,
                        `${context}: Fullscreen visibility`,
                    );
                    assert.equal(
                        await page
                            .locator('.game-app')
                            .evaluate((element) => element.classList.contains('game-app_touch')),
                        device.mobile,
                        context,
                    );
                    assert.equal(await page.locator('#touch').isVisible(), device.mobile, context);
                    if (device.mobile) {
                        const fire = page.locator('#touch [data-action="fire"]');
                        const point = await fire.boundingBox();
                        assert.ok(point, context);
                        assert.ok(
                            await fire.evaluate((element) => {
                                const b = element.getBoundingClientRect();
                                return element.contains(
                                    document.elementFromPoint(
                                        b.left + b.width / 2,
                                        b.top + b.height / 2,
                                    ),
                                );
                            }),
                            `${context}: fire target remains reachable`,
                        );
                    }
                }
                assert.deepEqual(errors, [], `${name} ${device.label} ${platform}`);
            } finally {
                await page.close();
            }
        }
    }
    console.log(
        `PASS: ${name} UA-based phone/tablet/iPad/legacy detection; Quest, TVs and touch desktops have no mobile controls in classic/native/VR at either orientation.`,
    );
}
