import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import { installVrSupport } from './vr-support.ts';
import { MOBILE_USER_AGENT } from './devices.ts';

async function layout(page: Page) {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
            ),
    );
    return page.evaluate(() => {
        const canvas = document.getElementById('game')!;
        const bounds = canvas.getBoundingClientRect();
        const controls = document.getElementById('touch')?.getBoundingClientRect();
        const viewport = canvas
            .closest('.game-viewport, .vr-game__viewport')!
            .getBoundingClientRect();
        return {
            height: innerHeight,
            width: innerWidth,
            pageHeight: document.documentElement.scrollHeight,
            pageWidth: document.documentElement.scrollWidth,
            top: bounds.top,
            bottom: bounds.bottom,
            canvasWidth: bounds.width,
            canvasHeight: bounds.height,
            viewportTop: viewport.top,
            viewportBottom: viewport.bottom,
            controlsTop: controls?.top ?? 0,
            controlsBottom: controls?.bottom ?? 0,
        };
    });
}

// Catch width-driven canvases overflowing short desktop windows, including after resize.
export async function checkGameLayout(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
            if (legacy && platform === 'vr') continue;
            const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
            if (platform === 'vr') await installVrSupport(page);
            try {
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                await page
                    .locator(`[data-platform="${platform}"][aria-disabled="false"]`)
                    .press('Enter');
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                if (platform === 'vr') await page.locator('#game[data-ready="true"]').waitFor();
                for (const [width, height] of [
                    [1440, 800],
                    [1920, 720],
                    [1100, 600],
                    [900, 1200],
                ]) {
                    await page.setViewportSize({ width, height });
                    const bounds = await layout(page);
                    const context = `${name} ${platform} legacy=${legacy} ${width}×${height}: ${JSON.stringify(bounds)}`;
                    assert.ok(bounds.pageHeight <= height + 1, `Vertical overflow: ${context}`);
                    assert.ok(bounds.pageWidth <= width + 1, `Horizontal overflow: ${context}`);
                    assert.ok(
                        bounds.top >= 0 && bounds.bottom <= height + 1,
                        `Clipped game: ${context}`,
                    );
                    assert.ok(bounds.canvasHeight >= 200, `Collapsed game: ${context}`);
                }
            } finally {
                await page.close();
            }
        }
        for (const platform of ['retro', 'amiga', 'atari-st', 'vr']) {
            if (legacy && platform === 'vr') continue;
            const mobile = await browser.newPage({
                viewport: { width: 390, height: 600 },
                hasTouch: true,
                userAgent: MOBILE_USER_AGENT,
            });
            if (platform === 'vr') await installVrSupport(mobile);
            try {
                await mobile.addInitScript(() => {
                    Object.defineProperty(Element.prototype, 'requestFullscreen', {
                        configurable: true,
                        value: undefined,
                    });
                });
                await mobile.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
                await mobile
                    .locator(`[data-platform="${platform}"][aria-disabled="false"]`)
                    .press('Enter');
                await mobile.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                if (platform === 'vr') await mobile.locator('#game[data-ready="true"]').waitFor();
                const portrait = await layout(mobile);
                if (platform === 'vr') {
                    assert.ok(
                        Math.abs(portrait.canvasHeight - 330) < 1,
                        `${name}: touch portrait keeps its existing VR preview height`,
                    );
                } else {
                    const ratio = platform === 'retro' ? 0.75 : 0.625;
                    assert.ok(
                        Math.abs(portrait.canvasHeight / portrait.canvasWidth - ratio) < 0.01,
                        `${name} ${platform}: touch portrait keeps its width-based game size`,
                    );
                }
                if (platform !== 'vr') {
                    for (const [width, height] of [
                        [320, 568],
                        [390, 844],
                        [768, 1024],
                        [820, 1180],
                    ]) {
                        await mobile.setViewportSize({ width, height });
                        await mobile.evaluate(() => scrollTo(0, 0));
                        for (const fullscreen of [false, true]) {
                            if (fullscreen) await mobile.locator('#fullscreen').click();
                            if (legacy) await mobile.waitForTimeout(300);
                            const bounds = await layout(mobile);
                            const context = `${name} ${platform} legacy=${legacy} fullscreen=${fullscreen} ${width}×${height}: ${JSON.stringify(bounds)}`;
                            assert.ok(
                                bounds.controlsTop - bounds.viewportBottom >= 16,
                                `Portrait controls need space below the game: ${context}`,
                            );
                            assert.ok(
                                Math.abs(bounds.viewportTop + bounds.controlsBottom - height) <= 2,
                                `Portrait game and controls must be centered together: ${context}`,
                            );
                            assert.ok(
                                bounds.pageHeight <= height + 1 && bounds.pageWidth <= width + 1,
                                `Portrait layout must fit the window: ${context}`,
                            );
                            const ratio = platform === 'retro' ? 0.75 : 0.625;
                            assert.ok(
                                Math.abs(bounds.canvasHeight / bounds.canvasWidth - ratio) < 0.01,
                                `Portrait game keeps its aspect ratio: ${context}`,
                            );
                            if (fullscreen) await mobile.locator('#fullscreen').click();
                        }
                    }
                }
                await mobile.setViewportSize({ width: 844, height: 390 });
                const landscape = await layout(mobile);
                await mobile.locator('#touch').evaluate((element: HTMLElement) => {
                    element.style.display = 'none';
                });
                if (legacy) await mobile.waitForTimeout(300);
                const withoutControls = await layout(mobile);
                await mobile.locator('#touch').evaluate((element: HTMLElement) => {
                    element.style.display = '';
                });
                if (legacy) await mobile.waitForTimeout(300);
                assert.ok(
                    Math.abs(landscape.canvasHeight - withoutControls.canvasHeight) <= 1,
                    `${name} ${platform} legacy=${legacy}: landscape controls must not reduce game height: ${landscape.canvasHeight} with / ${withoutControls.canvasHeight} without`,
                );
                assert.ok(
                    await mobile.locator('#touch').evaluate((element) => {
                        const bounds = element.getBoundingClientRect();
                        const hit = document.elementFromPoint(
                            innerWidth / 2,
                            bounds.top + bounds.height / 2,
                        );
                        return Boolean(hit && !element.contains(hit));
                    }),
                    `${name} ${platform} legacy=${legacy}: the space between touch controls must reach the page below`,
                );
                if (platform === 'vr')
                    assert.ok(
                        await mobile.locator('#vr-enter').evaluate((element) => {
                            const bounds = element.getBoundingClientRect();
                            return element.contains(
                                document.elementFromPoint(
                                    bounds.left + bounds.width / 2,
                                    bounds.top + bounds.height / 2,
                                ),
                            );
                        }),
                        `${name}: floating controls must not cover Enter VR`,
                    );
                assert.ok(
                    landscape.pageHeight <= 391,
                    `${name} ${platform} legacy=${legacy}: touch landscape fits the window: ${JSON.stringify(landscape)}`,
                );
            } finally {
                await mobile.close();
            }
        }
    }
    console.log(
        `PASS: ${name} desktop game height, resize, native ratios and touch orientation layouts.`,
    );
}
