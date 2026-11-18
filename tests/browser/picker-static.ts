import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

export async function checkPickerStatic(browser: Browser, name: string) {
    const agents = [
        'Mozilla/5.0 (SMART-TV; LINUX; Tizen 8.0) AppleWebKit/537.36 TV Safari/537.36',
        'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Safari/537.36',
        'Mozilla/5.0 (PlayStation 4 11.00) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    ];
    for (const userAgent of agents)
        for (const legacy of [false, true]) {
            const page = await browser.newPage({
                userAgent,
                viewport: { width: 1280, height: 900 },
                reducedMotion: 'no-preference',
            });
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.route('https://mc.yandex.ru/**', (route) =>
                route.fulfill({ status: 204, body: '' }),
            );
            await page.clock.install({ time: new Date('2026-11-22T00:00:00Z') });
            await page.clock.pauseAt(new Date('2026-11-22T00:00:01Z'));
            async function pixels() {
                return page.locator('.platform-picker__stars').evaluate((element) => {
                    const canvas = element as HTMLCanvasElement;
                    const data = canvas
                        .getContext('2d')!
                        .getImageData(0, 0, canvas.width, canvas.height).data;
                    return {
                        visible: data.some((value) => value > 0),
                        image: canvas.toDataURL(),
                    };
                });
            }
            async function checkStill() {
                const stars = await pixels();
                assert.ok(stars.visible, 'Static stars remain visible');
                const title = await page.locator('.platform-picker__heading').screenshot();
                await page.clock.runFor(6000);
                assert.equal(
                    (await pixels()).image === stars.image,
                    true,
                    'TV/PS4 stars do not drift or sparkle',
                );
                assert.equal(
                    title.equals(await page.locator('.platform-picker__heading').screenshot()),
                    true,
                    'The complete TV/PS4 title stays still',
                );
                assert.equal(
                    await page.locator('.platform-picker__ship-flight_active').count(),
                    0,
                    'TV/PS4 never starts a spacecraft flight',
                );
            }
            try {
                await page.goto(`http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`, {
                    waitUntil: 'networkidle',
                });
                assert.equal(
                    await page.locator('.platform-picker__title-raster').count(),
                    0,
                    'TV/PS4 shows the complete text immediately, without falling pixels',
                );
                const heading = await page.locator('.platform-picker__heading').evaluate((node) => {
                    const style = getComputedStyle(node);
                    return {
                        text: node.textContent?.trim(),
                        color: style.color,
                        fill: style.getPropertyValue('-webkit-text-fill-color'),
                        animation: style.animationName,
                    };
                });
                assert.equal(heading.text, 'EXOLONOMANIA');
                assert.equal(heading.color, 'rgb(232, 214, 166)');
                assert.ok(!heading.fill || heading.fill === heading.color);
                assert.equal(heading.animation, 'none', 'TV/PS4 also disables title shine');
                await checkStill();
                await page.evaluate(() => {
                    window.dispatchEvent(new Event('pagehide'));
                    window.dispatchEvent(new Event('pageshow'));
                });
                await page.setViewportSize({ width: 960, height: 720 });
                await page.waitForFunction(() => {
                    const canvas =
                        document.querySelector<HTMLCanvasElement>('.platform-picker__stars')!;
                    const bounds = canvas.getBoundingClientRect();
                    return (
                        canvas.width === Math.ceil(bounds.width) &&
                        canvas.height === Math.ceil(bounds.height)
                    );
                });
                await checkStill();
                assert.deepEqual(errors, []);
            } finally {
                await page.close();
            }
        }
    console.log(
        `PASS: ${name} TV/PS4 static stars, spacecraft and immediate title in modern/legacy.`,
    );
}
