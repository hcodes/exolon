import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

export async function checkPickerTitle(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 900 },
            deviceScaleFactor: 2,
            reducedMotion: 'no-preference',
        });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.clock.install({ time: new Date('2026-11-22T00:00:00Z') });
        await page.clock.pauseAt(new Date('2026-11-22T00:00:01Z'));
        const url = `http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`;
        const canvas = page.locator('.platform-picker__title-raster');
        async function pixels() {
            return canvas.evaluate((element) => {
                const canvas = element as HTMLCanvasElement;
                const pixels = canvas
                    .getContext('2d')!
                    .getImageData(0, 0, canvas.width, canvas.height).data;
                const rows: number[][] = [];
                for (let y = 0; y < canvas.height; y++) {
                    const row = Array.from(
                        pixels.slice(y * canvas.width * 4, (y + 1) * canvas.width * 4),
                    );
                    rows.push(row);
                }
                return rows;
            });
        }
        try {
            await page.goto(url, { waitUntil: 'networkidle' });
            await page.addStyleTag({
                content: '.platform-picker__stars, .platform-picker__flyby { visibility: hidden; }',
            });
            assert.equal(await canvas.count(), 1, 'The title starts with a falling-pixel reveal');
            const first = await pixels();
            assert.ok(
                first.every((row) => row.every((value) => value === 0)),
                'Grains start above the title',
            );
            await page.clock.runFor(400);
            const falling = await pixels();
            assert.ok(
                falling.some((row) => row.some((value) => value > 0)),
                'Individual grains enter from above',
            );
            assert.ok(
                falling
                    .slice(Math.ceil(falling.length / 2))
                    .every((row) => row.every((value) => value === 0)),
                'Early grains have not reached the bottom and leave no full-height streaks',
            );
            await page.clock.runFor(600);
            const next = await pixels();
            const bottom = next.findLastIndex((row) => row.some((value) => value > 0));
            assert.ok(
                bottom >= next.length / 2,
                'Grains accumulate at their destinations near the bottom',
            );
            await page.clock.runFor(180);
            assert.deepEqual(
                (await pixels())[bottom],
                next[bottom],
                'Landed bottom pixels stay in place',
            );
            await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            const hidden = await pixels();
            await page.clock.runFor(1000);
            assert.deepEqual(await pixels(), hidden, 'Pagehide suspends falling grains');
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.clock.runFor(180);
            assert.notDeepEqual(await pixels(), hidden, 'Pageshow resumes the unfinished reveal');
            await page.setViewportSize({ width: 390, height: 844 });
            await page.clock.runFor(100);
            assert.ok(
                (await pixels()).some((row) => row.some((value) => value > 0)),
                'Resizing keeps the title visible',
            );
            assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
            );
            await page.clock.runFor(800);
            const heading = page.locator('.platform-picker__heading');
            const assembled = await heading.screenshot();
            const assembledBounds = await heading.boundingBox();
            await page.clock.runFor(300);
            assert.equal(
                assembled.equals(await heading.screenshot()),
                true,
                'Finishing assembly must preserve the exact glyph pixels at high DPI',
            );
            assert.deepEqual(await heading.boundingBox(), assembledBounds);
            const completed = await pixels();
            await page.clock.runFor(2500);
            const shining = await pixels();
            assert.notDeepEqual(
                shining,
                completed,
                'The assembled raster retains its travelling shine',
            );
            assert.deepEqual(
                shining.map((row) => row.filter((_, index) => index % 4 === 3)),
                completed.map((row) => row.filter((_, index) => index % 4 === 3)),
                'The shine preserves the exact glyph mask',
            );
            assert.equal(
                await canvas.count(),
                1,
                'The same raster remains after all grains settle',
            );
            assert.equal(await page.locator('h1').textContent(), 'EXOLONOMANIA');
            assert.equal(await page.locator('.platform-picker__heading_revealing').count(), 0);

            await page.reload({ waitUntil: 'networkidle' });
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page
                .locator('.platform-picker__heading_revealing')
                .waitFor({ state: 'detached' });
            const reduced = await pixels();
            await page.clock.runFor(4000);
            assert.deepEqual(
                await pixels(),
                reduced,
                'Reduced motion completes and freezes the same raster',
            );
            await page.reload({ waitUntil: 'networkidle' });
            assert.equal(
                await canvas.count(),
                0,
                'Reduced motion also skips the reveal at startup',
            );
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            await page.reload({ waitUntil: 'networkidle' });
            await page.locator('[data-platform="retro"][aria-disabled="false"]').click();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
            await page.clock.runFor(4000);
            assert.equal(await canvas.count(), 0, 'Leaving during the reveal disposes its raster');
            assert.deepEqual(errors, []);
        } finally {
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} falling title grains, settled pixels, resize, motion preference and lifecycle in modern/legacy.`,
    );
}
