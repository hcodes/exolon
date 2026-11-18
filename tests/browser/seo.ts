import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

const canonical = 'https://hcodes.github.io/exolon/';
const origin = 'http://127.0.0.1:8091/';

export async function checkSeo(browser: Browser, name: string) {
    const staticContext = await browser.newContext({ javaScriptEnabled: false });
    try {
        const page = await staticContext.newPage();
        await page.goto(origin);
        assert.equal(await page.locator('h1').textContent(), 'EXOLONOMANIA');
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.locator('#platform-picker [data-platform]').count(), 8);
        assert.equal(await page.locator('#platform-picker a[href]').count(), 7);
        const vr = page.locator('[data-platform="vr"]');
        assert.equal(await vr.getAttribute('href'), null);
        assert.equal(await vr.getAttribute('aria-disabled'), 'true');
        const address = page.url();
        await vr.click({ force: true });
        await vr.click({ button: 'middle', force: true });
        assert.equal(page.url(), address, 'Disabled prerendered VR never navigates');
        assert.equal(
            staticContext.pages().length,
            1,
            'Disabled prerendered VR cannot open another tab',
        );
        assert.equal(await page.locator('noscript').isVisible(), true);
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), canonical);
        const images = page.locator('#platform-picker img');
        for (let i = 0; i < (await images.count()); i++)
            assert.equal(
                await images
                    .nth(i)
                    .evaluate((image) => (image as HTMLImageElement).naturalWidth > 0),
                true,
            );
    } finally {
        await staticContext.close();
    }
    for (const legacy of [false, true]) {
        const context = await browser.newContext();
        await context.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        try {
            const page = await context.newPage();
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(origin + '?graphics=zx-spectrum&level=8' + (legacy ? '&legacy=1' : ''));
            await page.locator('[data-platform="retro"][aria-disabled="false"]').waitFor();
            assert.equal(await page.locator('#app[data-prerendered]').count(), 0);
            assert.equal(await page.locator('#platform-picker').count(), 1);
            assert.equal(await page.locator('#platform-picker h1').count(), 1);
            assert.equal(await page.locator('#game, #new-game, #settings-panel').count(), 0);
            assert.equal(
                await page.locator('link[rel="canonical"]').getAttribute('href'),
                canonical,
            );
            await page.locator('[data-platform="retro"]').focus();
            await page.keyboard.press('Enter');
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            assert.equal(await page.locator('#game').count(), 1);
            assert.equal(await page.locator('#settings-panel').count(), 1);
            await page.locator('#title-screen').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#platform-picker').isVisible(), false);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }
    console.log(
        `PASS: ${name} static HTML without JavaScript, social metadata and single modern/legacy mount.`,
    );
}
