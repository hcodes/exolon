import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

declare global {
    interface Window {
        __pickerStarDraws: number;
        __pickerStarOpacities: number[];
    }
}

export async function checkPickerStars(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
            reducedMotion: 'no-preference',
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.addInitScript(() => {
            window.__pickerStarDraws = 0;
            window.__pickerStarOpacities = [];
            let sampleOpacity = false;
            const clearRect = CanvasRenderingContext2D.prototype.clearRect;
            CanvasRenderingContext2D.prototype.clearRect = function (...args) {
                if (this.canvas.classList.contains('platform-picker__stars')) {
                    window.__pickerStarDraws++;
                    sampleOpacity = true;
                }
                return clearRect.apply(this, args);
            };
            const drawImage = CanvasRenderingContext2D.prototype.drawImage;
            CanvasRenderingContext2D.prototype.drawImage = function (
                image: CanvasImageSource,
                ...coordinates: number[]
            ) {
                if (sampleOpacity && this.canvas.classList.contains('platform-picker__stars')) {
                    window.__pickerStarOpacities.push(this.globalAlpha);
                    sampleOpacity = false;
                }
                return Reflect.apply(drawImage, this, [image, ...coordinates]);
            };
        });
        await page.clock.install({ time: new Date('2026-11-22T00:00:00Z') });
        try {
            await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`, {
                waitUntil: 'networkidle',
            });
            const stars = page.locator('canvas.platform-picker__stars');
            await stars.waitFor({ timeout: 5000 });
            await page.clock.pauseAt(new Date('2026-11-22T00:00:05Z'));
            assert.equal(await stars.count(), 1, 'All star depths share one canvas');
            async function pixels() {
                return stars.evaluate((element) => {
                    const canvas = element as HTMLCanvasElement;
                    return Array.from(
                        canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
                            .data,
                    );
                });
            }
            const first = await pixels();
            assert.ok(
                first.some((value) => value > 0),
                'The star canvas contains visible pixels',
            );
            await page.evaluate(() => (window.__pickerStarOpacities = []));
            await page.clock.runFor(6000);
            assert.notDeepEqual(await pixels(), first, 'Stars drift and twinkle');
            const opacities = await page.evaluate(() => window.__pickerStarOpacities);
            const baseline = Math.min(...opacities);
            assert.ok(
                opacities.filter((opacity) => opacity <= baseline + 0.01).length >
                    opacities.length * 0.8,
                'Stars hold their normal brightness between brief sparkles',
            );
            assert.ok(
                Math.max(...opacities) - baseline > 0.4,
                'A sparkle briefly brightens the star distinctly above its normal brightness',
            );

            async function setMotion(reducedMotion: 'reduce' | 'no-preference') {
                const changed = page.evaluate(
                    () =>
                        new Promise<void>((resolve) => {
                            matchMedia('(prefers-reduced-motion: reduce)').addEventListener(
                                'change',
                                () => resolve(),
                                { once: true },
                            );
                        }),
                );
                await page.emulateMedia({ reducedMotion });
                await changed;
            }
            const beforeReduce = await page.evaluate(() => window.__pickerStarDraws);
            await setMotion('reduce');
            await page.waitForFunction((count) => window.__pickerStarDraws > count, beforeReduce);
            const reduced = await pixels();
            const reducedDraws = await page.evaluate(() => window.__pickerStarDraws);
            await page.clock.runFor(1000);
            assert.deepEqual(await pixels(), reduced, 'Reduced motion keeps a static star field');
            assert.equal(
                await page.evaluate(() => window.__pickerStarDraws),
                reducedDraws,
                'Reduced motion does not redraw an unchanged canvas',
            );
            await setMotion('no-preference');
            await page.clock.runFor(1000);
            assert.ok((await page.evaluate(() => window.__pickerStarDraws)) > reducedDraws);

            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            const hiddenDraws = await page.evaluate(() => window.__pickerStarDraws);
            await page.clock.runFor(1000);
            assert.equal(await page.evaluate(() => window.__pickerStarDraws), hiddenDraws);
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.clock.runFor(1000);
            assert.ok((await page.evaluate(() => window.__pickerStarDraws)) > hiddenDraws);

            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForFunction(() => {
                const canvas = document.querySelector<HTMLCanvasElement>(
                    'canvas.platform-picker__stars',
                )!;
                return canvas.width === Math.ceil(canvas.getBoundingClientRect().width);
            });
            assert.ok(
                (await pixels()).some((value) => value > 0),
                'Resizing redraws the stars',
            );
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                'The canvas does not overflow a narrow viewport',
            );
            await page.locator('[data-platform="retro"][aria-disabled="false"]').click();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            const disposedDraws = await page.evaluate(() => window.__pickerStarDraws);
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.clock.runFor(1000);
            assert.equal(
                await page.evaluate(() => window.__pickerStarDraws),
                disposedDraws,
                'Leaving the picker cancels star frames and removes its pageshow handler',
            );
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} canvas stars animate, resize and stop for reduced motion, pagehide and disposal in modern/legacy.`,
    );
}
