import { menuPresented } from './control-navigation.ts';
import { openGame, openHome } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser, Page } from 'playwright';
import type { BrowserHelpers } from './types.ts';

async function setup(page: Page, prepare: BrowserHelpers['prepare']) {
    await prepare(page);
    await page.addInitScript(() => {
        const frame = window.requestAnimationFrame.bind(window);
        let time = 0;
        window.requestAnimationFrame = (callback) => frame(() => callback(time));
        window.__exolonIntroAdvance = (next) => {
            time += next;
            return new Promise<number>((resolve) => frame(() => frame(resolve)));
        };
    });
}

export async function checkIntro(
    session: Browser,
    name: string,
    { prepare, waitForPlaying }: Pick<BrowserHelpers, 'prepare' | 'waitForPlaying'>,
) {
    // Covers now belong to the platform picker. No second timed cover should
    // delay the original title/menu, including after a graphics change or ESC.
    const modes = [
        ['retro', '256'],
        ['c64', '256'],
        ['cpc', '256'],
        ['sharp-mz800', '320'],
        ['gameboy', '256'],
        ['gameboy-color', '256'],
        ['remastered', '1024'],
        ['split', '1024'],
    ] as const;
    for (const legacy of [false, true])
        for (const [mode, width] of modes) {
            const page = await session.newPage({
                viewport: { width: 1100, height: 1000 },
                hasTouch: name === 'WebKit',
            });
            await setup(page, prepare);
            try {
                await openGame(
                    page,
                    `http://127.0.0.1:8091/?graphics=${mode}&level=41${legacy ? '&legacy=1' : ''}`,
                );
                assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
                assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
                assert.equal(await page.locator('#game').getAttribute('width'), width);
                assert.equal(await menuPresented(page, 'title-screen'), true);
                assert.equal(await page.locator('#platform-picker').isVisible(), false);
                await page.waitForFunction(() => window.__exolonAudioSnapshot().audible === 1);
                await page.evaluate(() => window.__exolonIntroAdvance(6000));
                assert.equal(await page.locator('#game').getAttribute('data-menu'), 'menu');
                assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
                await openHome(page);
                await page.locator('#show-scores').press('Enter');
                assert.equal(await menuPresented(page, 'high-scores'), true);
                await page.keyboard.press('Escape');
                await page.locator('#game').focus();
                await page.keyboard.press('Space');
                await waitForPlaying(page);
                assert.equal(await menuPresented(page, 'title-screen'), false);
                assert.equal(await page.locator('#sector').textContent(), '041 / 125');
                assert.equal(await page.locator('#ammo').textContent(), '99');
                await page.keyboard.press('Escape');
                assert.equal(await menuPresented(page, 'title-screen'), true);
                assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
                await page.selectOption(
                    '#graphics-mode',
                    mode === 'retro' ? 'remastered' : 'retro',
                );
                await page.evaluate(() => window.__exolonIntroAdvance(0));
                assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
            } finally {
                await page.close();
            }
        }

    for (const delayed of [false, true]) {
        const page = await session.newPage({ hasTouch: true });
        await setup(page, prepare);
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route('**/assets/images/remastered/previews/banner.jpg*', async (route) => {
            if (delayed) {
                await held;
                await route.continue().catch(() => {});
            } else await route.fulfill({ status: 404, body: '' });
        });
        try {
            await openGame(page, 'http://127.0.0.1:8091/?graphics=remastered');
            assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
            assert.equal(await page.locator('#game').getAttribute('width'), '1024');
            await page.locator('#game').focus();
            await page.keyboard.press('Space');
            await waitForPlaying(page);
            release();
            await page.evaluate(() => window.__exolonIntroAdvance(7000));
            assert.equal(await menuPresented(page, 'title-screen'), false);
            assert.equal(await page.locator('#game').getAttribute('data-intro'), null);
        } finally {
            release();
            await page.close();
        }
    }
    console.log(
        `PASS: ${name} direct title without repeated cover, all8modes/native/legacy, first fire, music, menus/records/ESC and delayed/missing banner art.`,
    );
}
