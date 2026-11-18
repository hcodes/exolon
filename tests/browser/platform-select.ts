import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import { openGame, openSettings, reloadGame } from './navigation.ts';

export async function checkPlatformSelection(browser: Browser, name: string) {
    for (const legacy of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('https://mc.yandex.ru/**', (route) =>
            route.fulfill({ status: 204, body: '' }),
        );
        await page.route(/\.(wav|mp3|m4a)(\?|$)/, (route) =>
            route.fulfill({ status: 404, body: '' }),
        );
        try {
            await openGame(page, `http://127.0.0.1:8091/${legacy ? '?legacy=1' : ''}`);
            const select = page.locator('#graphics-mode');
            assert.equal(
                await select.locator('option[value=""]').count(),
                0,
                'Native pickers must not render decorative separators as text option rows',
            );
            const values = () =>
                select
                    .locator('option')
                    .evaluateAll((options) =>
                        options.map((option) => (option as HTMLOptionElement).value),
                    );
            assert.ok((await values()).includes('amiga'), 'Main selector offers Amiga');
            assert.ok((await values()).includes('atari-st'), 'Main selector offers Atari ST');
            await select.selectOption('split');
            for (const side of ['left', 'right']) {
                const splitValues = await page
                    .locator(`#split-${side} option`)
                    .evaluateAll((options) =>
                        options.map((option) => (option as HTMLOptionElement).value),
                    );
                assert.ok(!splitValues.includes('amiga') && !splitValues.includes('atari-st'));
            }
            for (const platform of ['amiga', 'atari-st']) {
                await select.selectOption(platform);
                await page
                    .locator(`[data-game="${platform}"] #new-game:not([disabled])`)
                    .waitFor({ state: 'attached' });
                await openSettings(page);
                assert.equal(await select.inputValue(), platform);
                assert.equal(new URL(page.url()).searchParams.get('game'), platform);
                assert.equal(
                    await page.evaluate(() => localStorage.getItem('exolon-graphics')),
                    'split',
                );
                assert.equal(await page.locator('#game').getAttribute('width'), '320');
                assert.equal(await page.locator('#split-left').count(), 0);
                assert.equal(await page.locator('#split-right').count(), 0);
                assert.equal(await page.locator('#monochrome').count(), 0);
            }
            await select.selectOption('c64');
            await page.locator('#game[data-graphics="c64"]').waitFor();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await openSettings(page);
            assert.equal(await select.inputValue(), 'c64');
            assert.equal(await page.evaluate(() => localStorage.getItem('exolon-graphics')), 'c64');
            assert.equal(await page.locator('#platform-picker').isVisible(), false);
            assert.equal(new URL(page.url()).searchParams.get('game'), null);
            assert.equal(new URL(page.url()).searchParams.get('graphics'), 'c64');
            assert.equal(await page.locator('#game').getAttribute('width'), '256');
            await select.selectOption('remastered');
            await page.locator('#game[data-graphics="remastered"]').waitFor();
            assert.equal(new URL(page.url()).searchParams.get('graphics'), 'remastered');
            await page.waitForFunction(() =>
                document.getElementById('music-status')?.textContent?.includes('Music unavailable'),
            );
            await reloadGame(page);
            assert.equal(await select.inputValue(), 'remastered');
            await select.selectOption('amiga');
            await page
                .locator('[data-game="amiga"] #new-game:not([disabled])')
                .waitFor({ state: 'attached' });
            await openSettings(page);
            await select.selectOption('split');
            await page.locator('#game[data-graphics="split"]').waitFor();
            await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
            await openSettings(page);
            assert.equal(await select.inputValue(), 'split');
            assert.equal(await page.locator('#split-options').isVisible(), true);
            assert.equal(await page.locator('#split-divider').isVisible(), true);
            assert.equal(await page.locator('#platform-picker').isVisible(), false);
            assert.deepEqual(errors, []);
        } finally {
            await context.close();
        }
    }
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    let release: (() => void) | undefined;
    let reached!: () => void;
    const held = new Promise<void>((resolve) => {
        reached = resolve;
    });
    let completed!: () => void;
    const resumed = new Promise<void>((resolve) => {
        completed = resolve;
    });
    let intercepted = false;
    let moduleUrl = '';
    await page.route(/\/runtime\/amiga-[^/]+\.js(?:\?|$)/, async (route) => {
        if (intercepted) {
            await route.continue();
            return;
        }
        intercepted = true;
        moduleUrl = route.request().url();
        await new Promise<void>((resolve) => {
            release = resolve;
            reached();
        });
        await route.continue();
        completed();
    });
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('amiga');
        await Promise.race([
            held,
            page.waitForTimeout(10000).then(() => {
                throw new Error(`${name}: Amiga module was not intercepted`);
            }),
        ]);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('retro');
        const finished = page.waitForEvent('requestfinished', (request) =>
            /\/runtime\/amiga-[^/]+\.js(?:\?|$)/.test(request.url()),
        );
        release!();
        await resumed;
        await finished;
        // Join the real bundled import, including dependencies, before checking cancellation.
        await page.evaluate(async (url) => {
            await import(url);
        }, moduleUrl);
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'retro');
        assert.equal(await page.locator('#game').getAttribute('width'), '256');
        assert.equal(new URL(page.url()).searchParams.get('game'), null);
        assert.equal(await page.locator('[data-game="amiga"]').count(), 0);
    } finally {
        release?.();
        await context.close();
    }
    const failedContext = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const failed = await failedContext.newPage();
    await failed.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await failed.route(/\.(wav|mp3|m4a)(\?|$)/, (route) => route.abort());
    await failed.route(/\/runtime\/atari-st-[^/]+\.js(?:\?|$)/, (route) => route.abort());
    try {
        await openGame(failed, 'http://127.0.0.1:8091/');
        await openSettings(failed);
        await failed.locator('#graphics-mode').selectOption('amiga');
        await failed
            .locator('[data-game="amiga"] #new-game:not([disabled])')
            .waitFor({ state: 'attached' });
        await openSettings(failed);
        await failed.locator('#graphics-mode').selectOption('atari-st');
        const status = failed.locator('#platform-launch-status');
        await status.waitFor();
        assert.ok((await status.textContent())!.includes('could not be loaded'));
        assert.equal(await failed.locator('#graphics-mode').inputValue(), 'amiga');
        assert.equal(new URL(failed.url()).searchParams.get('game'), 'amiga');
        await openSettings(failed);
        await failed.locator('#graphics-mode').selectOption('retro');
        await failed.locator('#game[data-graphics="retro"]').waitFor();
        await failed.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await openSettings(failed);
        assert.equal(await failed.locator('#platform-picker').isVisible(), false);
        assert.equal(await status.isVisible(), false);
        await openSettings(failed);
        await failed.locator('#graphics-mode').selectOption('atari-st');
        await status.waitFor();
        assert.equal(await failed.locator('#graphics-mode').inputValue(), 'retro');
        await openSettings(failed);
        await failed.locator('#graphics-mode').selectOption('remastered');
        assert.equal(await status.isVisible(), false);
    } finally {
        await failedContext.close();
    }
    console.log(
        `PASS: ${name} platform selector switches separate Amiga/ST engines and returns to classic/Split in modern/legacy; native games never enter Split.`,
    );
}
