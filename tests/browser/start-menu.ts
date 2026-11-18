import { menuPresented } from './control-navigation.ts';
import { openGame, openHome, openSettings } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { Graphics } from '../../src/types/graphics.ts';

export async function checkStartMenu(
    session: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
    }: Pick<BrowserHelpers, 'prepare' | 'padFrames' | 'waitForPlaying'>,
) {
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 } });
    await prepare(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.evaluate(async () => {
            const [{ createRenderer }, spectrum, graphics] = await Promise.all([
                import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/renderer.ts')
                >,
                import(new URL('./view/spectrum.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/spectrum.ts')
                >,
                fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                    (r) => r.json() as Promise<Graphics>,
                ),
            ]);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, graphics),
                pixels = () =>
                    canvas
                        .getContext('2d')!
                        .getImageData(0, 0, canvas.width, canvas.height)
                        .data.slice();
            renderer.renderTitle(0);
            const loading = pixels();
            renderer.renderTitle(0, { menu: true });
            const menu = pixels();
            if (loading.every((value, index) => value === menu[index]))
                throw Error('ZX selection still shows the loading picture');
            const expected = spectrum.createScreen();
            for (const tile of graphics.screens.menu) spectrum.putTile(expected, tile);
            expected.attributes.fill(0x47, 15 * 32 + 11, 15 * 32 + 25);
            const reference = spectrum.toRgba(expected);
            if (!menu.every((value, index) => value === reference[index]))
                throw Error('ZX Start Game menu is not the source bitmap');
            const drawn: string[] = [],
                original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (value, ...args) {
                drawn.push(String(value));
                return original.call(this, value, ...args);
            };
            try {
                renderer.setGraphicsMode('remastered');
                renderer.renderTitle(0, { menu: true });
            } finally {
                CanvasRenderingContext2D.prototype.fillText = original;
            }
            if (!drawn.includes('PRESS FIRE TO BEGIN') || !drawn.includes('REMASTERED'))
                throw Error('Remastered must retain its direct-start title');
            if (drawn.some((value) => /RAFFAELE|HEWSON|FIVE WORLDS/.test(value)))
                throw Error('Removed credits returned');
            if (
                drawn.some((value) =>
                    /START GAME|DEFINE KEYS|KEYBOARD|KEMPSTON|INTERFACE 2/.test(value),
                )
            )
                throw Error('Remastered must not render control selection');
            renderer.setGraphicsMode('gameboy');
            renderer.renderTitle(0, { menu: true });
            const colors = new Set();
            for (let i = 0, data = pixels(); i < data.length; i += 4)
                colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
            if (colors.size > 4) throw Error('Game Boy selection lost its four shades');
            renderer.destroy();
        });
        await page.locator('#game').click();
        await page.waitForFunction(() => window.__exolonAudioSnapshot().audible === 1);
        const loops = (await page.evaluate(() => window.__exolonAudioSnapshot())).loops;
        await page.waitForFunction(
            () => (document.getElementById('game') as HTMLCanvasElement).dataset.menu === 'menu',
            {},
            { timeout: 9000 },
        );
        assert.equal(await menuPresented(page, 'title-screen'), true);
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).loops, loops);
        await page.screenshot({
            path: `/tmp/exolon-start-menu-zx-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        for (const mode of ['remastered', 'split', 'gameboy', 'retro']) {
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption(mode);
            await padFrames(page);
            if (mode !== 'remastered') {
                await openHome(page);
                await page.locator('#show-controls').focus();
                await page.keyboard.press('Enter');
                await padFrames(page);
            }
            assert.equal(
                await page.locator('#game').getAttribute('data-menu'),
                mode === 'remastered' ? 'title' : 'menu',
            );
            await page.waitForFunction(() => window.__exolonAudioSnapshot().active === 1);
            if (mode === 'remastered')
                await page.screenshot({
                    path: `/tmp/exolon-start-menu-remastered-${name.toLowerCase()}.png`,
                    fullPage: true,
                });
        }
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
        await page.waitForFunction(
            () => (document.getElementById('game') as HTMLCanvasElement).dataset.menu === 'menu',
            {},
            { timeout: 9000 },
        );
        if (name === 'Chromium') {
            await page.locator('#game').focus();
            await page.keyboard.press('1');
        } else {
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption('remastered');
            await padFrames(page);
            const box = (await page.locator('#game').boundingBox())!;
            await page.mouse.click(box.x + box.width / 2, box.y + (box.height * 92) / 192);
        }
        await waitForPlaying(page);
        assert.equal(await page.locator('#game').getAttribute('data-menu'), null);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#game').getAttribute('data-menu'), 'title');
        await openHome(page);
        await page.locator('#show-scores').click();
        assert.equal(await page.locator('#game').getAttribute('data-menu'), 'scores');
        await page.keyboard.press('Escape');
        await page.locator('#game').focus();
        await page.keyboard.press('Space');
        await waitForPlaying(page);
        console.log(
            `PASS: ${name} original ZX control menu, direct Remastered title, continuous music, Split/Game Boy, Digit1/Space and menu/records navigation.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-start-menu-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
}
