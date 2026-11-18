import { openGame, openHome, openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';

export async function checkLaunchOptions(browser: Browser, name: string) {
    const cases = [
        { query: 'level=41&graphics=c64', screen: 41, mode: 'c64', retry: true },
        { query: 'level=125&graphics=cpc', screen: 125, mode: 'cpc' },
        { query: 'level=26&graphics=zx-spectrum', screen: 26, mode: 'retro' },
        { query: 'level=2&graphics=split', screen: 2, mode: 'split' },
        { query: 'level=126&graphics=unknown', screen: 1, mode: 'gameboy-color' },
        { query: '', screen: 1, mode: 'gameboy-color' },
    ];
    for (const legacy of [false, true])
        for (const item of cases) {
            const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
            const errors: string[] = [];
            page.setDefaultTimeout(10000);
            page.on('pageerror', (error) => errors.push(error.message));
            await page.addInitScript((retry) => {
                localStorage.setItem('exolon-graphics', 'gameboy-color');
                if (retry)
                    localStorage.setItem('exolon-cheats', JSON.stringify({ retryLevel: true }));
            }, Boolean(item.retry));
            try {
                const params = [item.query, legacy ? 'legacy=1' : ''].filter(Boolean).join('&');
                await openGame(page, 'http://127.0.0.1:8091/' + (params ? '?' + params : ''));
                await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
                assert.equal(await page.locator('#graphics-mode').inputValue(), item.mode, params);
                assert.equal(
                    await page.locator('#game').getAttribute('data-graphics'),
                    item.mode,
                    params,
                );
                assert.equal(
                    await page.evaluate(() => localStorage.getItem('exolon-graphics')),
                    item.mode,
                    'The explicit banner choice saves the selected platform',
                );
                await openHome(page);
                await page.locator('#new-game').press('Enter');
                await page.waitForFunction(() => document.getElementById('title-screen')!.hidden);
                assert.equal(
                    await page.locator('#sector').textContent(),
                    `${String(item.screen).padStart(3, '0')} / 125`,
                    params,
                );
                await openHome(page);
                await page.locator('#restart').press('Enter');
                assert.equal(
                    await page.locator('#sector').textContent(),
                    `${String(item.screen).padStart(3, '0')} / 125`,
                );
                await openHome(page);
                await page.locator('#pause').press('Enter');
                await openSettings(page);
                await page.selectOption('#graphics-mode', 'remastered');
                assert.equal(
                    await page.locator('#game').getAttribute('data-graphics'),
                    'remastered',
                );
                assert.equal(
                    await page.locator('#sector').textContent(),
                    `${String(item.screen).padStart(3, '0')} / 125`,
                );
                assert.equal(
                    await page.evaluate(() => localStorage.getItem('exolon-graphics')),
                    'remastered',
                );
                if (item.retry) {
                    await openHome(page);
                    await page.locator('#menu').press('Enter');
                    await openHome(page);
                    await page.locator('#new-game').press('Enter');
                    assert.equal(
                        await page.locator('#sector').textContent(),
                        '001 / 125',
                        'Retry cheat keeps the existing menu-reset rule',
                    );
                }
                assert.deepEqual(errors, []);
            } finally {
                await page.close();
            }
        }
    const missing = await browser.newPage();
    try {
        await missing.route('**/assets/graphics/c64/c64-graphics.json*', (route) =>
            route.abort('failed'),
        );
        await openGame(missing, 'http://127.0.0.1:8091/?level=41&graphics=c64');
        await missing.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await missing.locator('#graphics-mode').inputValue(), 'retro');
        await openHome(missing);
        await missing.locator('#new-game').press('Enter');
        assert.equal(await missing.locator('#sector').textContent(), '041 / 125');
    } finally {
        await missing.close();
    }
    console.log(
        `PASS: ${name} level/graphics URLs, saved-preference priority, native/legacy, optional art/fallback, restart, manual graphics and retry-menu rules.`,
    );
}
