import { activateControl } from './control-navigation.ts';
import { openGame, reloadGame, openSettings, closeSettings, openHome } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { World, StageBonus } from '../../src/types/game.ts';
import type { Graphics, NativeGraphics } from '../../src/types/graphics.ts';

export async function checkC64(
    session: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
        overlayOpen,
    }: Pick<BrowserHelpers, 'prepare' | 'padFrames' | 'waitForPlaying' | 'overlayOpen'>,
) {
    const unavailable = await session.newPage();
    await prepare(unavailable);
    await unavailable.addInitScript(() => localStorage.setItem('exolon-graphics', 'c64'));
    await unavailable.route('**/assets/graphics/c64/c64-graphics.json*', (route) =>
        route.fulfill({ status: 404, body: '' }),
    );
    try {
        await openGame(unavailable, 'http://127.0.0.1:8091/');
        await unavailable.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await unavailable.locator('#graphics-mode').inputValue(), 'retro');
        assert.equal(
            await unavailable.locator('#graphics-mode option[value="c64"]').isDisabled(),
            true,
        );
        await openHome(unavailable);
        await unavailable.locator('#new-game').click();
        await waitForPlaying(unavailable);
    } finally {
        await unavailable.close();
    }
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 }, hasTouch: true });
    await prepare(page);
    const activate = (selector: string) =>
        activateControl(page.locator(selector), name === 'WebKit');
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.evaluate(async () => {
            const [{ createRenderer }, { createState, step }, world, graphics, c64] =
                await Promise.all([
                    import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                        typeof import('../../src/view/renderer.ts')
                    >,
                    import(new URL('./model/state.js', document.baseURI).href) as Promise<
                        typeof import('../../src/model/state.ts')
                    >,
                    fetch('./data/world.json').then((r) => r.json() as Promise<World>),
                    fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                        (r) => r.json() as Promise<Graphics>,
                    ),
                    fetch('./assets/graphics/c64/c64-graphics.json').then(
                        (r) => r.json() as Promise<NativeGraphics>,
                    ),
                ]);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, { ...graphics, c64 });
            const pixels = () =>
                canvas
                    .getContext('2d')!
                    .getImageData(0, 0, canvas.width, canvas.height)
                    .data.slice();
            const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
                a.length === b.length && a.every((value, i) => value === b[i]);
            renderer.setGraphicsMode('c64');
            if (renderer.graphicsMode !== 'c64') throw Error('C64 presentation is missing');
            const first = createState(world);
            renderer.addEvents([], first);
            const before = JSON.stringify(first);
            renderer.render(first, 1000, 0);
            if (canvas.width !== 256 || canvas.height !== 192 || JSON.stringify(first) !== before)
                throw Error('C64 must use shared coordinates and immutable state');
            const original = pixels(),
                colors = new Set();
            for (let i = 0; i < original.length; i += 4)
                colors.add(`${original[i]},${original[i + 1]},${original[i + 2]}`);
            if (colors.size < 8 || colors.size > 16)
                throw Error(`C64 must use its 16-color source display, got ${colors.size}`);
            renderer.render(first, 9000, 0);
            if (!same(original, pixels())) throw Error('Paused C64 animation advanced');
            renderer.setGraphicsMode('retro');
            renderer.render(first, 1000, 0);
            const zx = pixels();
            if (same(original, zx)) throw Error('C64 is still ZX graphics');
            renderer.setGraphicsMode('c64');
            renderer.render(first, 1000, 0);
            if (!same(original, pixels())) throw Error('C64 mode restoration failed');
            for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                const state = createState(world, { screenIndex }),
                    snapshot = JSON.stringify(state);
                renderer.addEvents([], state);
                renderer.render(state, 0, 0);
                if (JSON.stringify(state) !== snapshot)
                    throw Error(`C64 mutated screen ${screenIndex}`);
            }
            const target = createState(world);
            target.objects = [];
            target.grenade = { x: 74, y: 112, dx: 1, phase: 20, projectileId: 1 };
            const impact = step(step(target, {}).state, {});
            if (
                !impact.events.some((event) => event.type === 'object-destroyed') ||
                !impact.events.some((event) => event.type === 'explosion') ||
                !impact.state.destroyed.includes(8)
            )
                throw Error('C64 impact fixture must destroy an object with a rocket');
            renderer.destroy();
            renderer.render(impact.state, 0, 0);
            const withoutExplosion = pixels();
            renderer.addEvents(impact.events, impact.state);
            for (let age = 0; age < 9; age++) {
                renderer.render({ ...impact.state, tick: impact.state.tick + age }, 0, 0);
                if (same(withoutExplosion, pixels()))
                    throw Error(`C64 object explosion is invisible at age ${age}`);
            }
            renderer.render({ ...impact.state, tick: impact.state.tick + 10 }, 0, 0);
            if (same(withoutExplosion, pixels()))
                throw Error('C64 destruction debris disappeared with the impact flash');
            renderer.render({ ...impact.state, tick: impact.state.tick + 12 }, 0, 0);
            const debris = pixels();
            let scattered = 0;
            for (let y = 0; y < 176; y++)
                for (let x = 0; x < 256; x += 2) {
                    const index = (y * 256 + x) * 4;
                    // C64 stars and the hires player legitimately have single-pixel detail.
                    // Check wide pixels only where the fragments changed the image.
                    if (
                        debris
                            .slice(index, index + 8)
                            .every((value, channel) => value === withoutExplosion[index + channel])
                    )
                        continue;
                    if (x < 144 || x >= 192 || y < 104 || y >= 144) scattered++;
                    if (
                        !debris
                            .slice(index, index + 4)
                            .every((value, channel) => value === debris[index + 4 + channel])
                    )
                        throw Error('C64 destruction split a multicolor wide pixel');
                }
            if (!scattered) throw Error('C64 object destruction has no travelling fragments');
            renderer.render({ ...impact.state, tick: impact.state.tick + 12 }, 9000, 0);
            if (!same(debris, pixels())) throw Error('Paused C64 destruction advanced');
            renderer.render({ ...impact.state, tick: impact.state.tick + 176 }, 0, 0);
            if (!same(withoutExplosion, pixels()))
                throw Error('C64 destruction debris did not expire');
            renderer.destroy();
            const supplies = createState(world, { screenIndex: 2 }),
                box = supplies.objects.find((object) => object.type === 7)!;
            renderer.addEvents([], supplies);
            renderer.render(supplies, 0, 0);
            const stocked = pixels();
            box.active = false;
            renderer.render(supplies, 0, 0);
            if (same(stocked, pixels())) throw Error('Collected C64 supply remains visible');
            box.active = true;
            renderer.render(supplies, 0, 0);
            if (!same(stocked, pixels())) throw Error('C64 scenery cache did not restore supply');
            for (const status of ['bonus', 'won', 'over'] as const) {
                const state = createState(world);
                state.status = status;
                state.bonus = { cursor: 3, total: 12345 } as StageBonus;
                renderer.render(state, 1000, 0, {
                    nameEntry: status === 'won',
                    playerName: 'ORBIT',
                });
            }
            renderer.renderTitle(0);
            const planets = pixels();
            renderer.renderTitle(0, { menu: true });
            if (same(planets, pixels()))
                throw Error('C64 planet splash is missing before the separate launch menu');
            renderer.renderTitle(0);
            if (!same(planets, pixels())) throw Error('C64 planet splash did not restore');
            for (const options of [
                {},
                { menu: true },
                { scores: true, rows: [{ name: 'ORBIT', score: 12345 }] },
            ]) {
                renderer.renderTitle(100, options);
                const stars = pixels();
                renderer.renderTitle(200, options);
                if (same(stars, pixels())) throw Error('C64 title/records flares are missing');
            }
            renderer.destroy();
        });
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('c64');
        await padFrames(page);
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'c64');
        await closeSettings(page);
        await activate('#game');
        await page.waitForFunction(
            () =>
                window.__exolonAudioSnapshot().audible === 1 &&
                window.__exolonAudioSnapshot().status.includes('Commodore 64'),
        );
        const title = await page.evaluate(() => window.__exolonAudioSnapshot());
        assert.equal(title.track!.channels, 1);
        assert.ok(
            title.track!.duration >= 103 && title.track!.duration <= 105 && title.track!.peak > 0.1,
        );
        await page.screenshot({
            path: `/tmp/exolon-c64-title-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await openSettings(page);
        await activate('#new-game');
        await closeSettings(page);
        await waitForPlaying(page);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => window.__exolonAudioSnapshot().effects > 0);
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).active, 0);
        await page.keyboard.press('Pause');
        const hud = await page.locator('#hud').textContent();
        await page.screenshot({
            path: `/tmp/exolon-c64-game-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await openSettings(page);
        for (const mode of ['remastered', 'retro', 'split', 'c64']) {
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption(mode);
            await padFrames(page);
            assert.equal(await page.locator('#hud').textContent(), hud);
            assert.equal(await overlayOpen(page), true);
        }
        await closeSettings(page);
        await activate('#fullscreen');
        await page.waitForFunction(() =>
            document
                .querySelector<HTMLElement>('.game-app')!
                .classList.contains('game-app_fullscreen'),
        );
        await padFrames(page);
        assert.equal(await page.locator('#hud').textContent(), hud);
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'c64');
        await activate('#fullscreen');
        await page.waitForFunction(
            () =>
                !document
                    .querySelector<HTMLElement>('.game-app')!
                    .classList.contains('game-app_fullscreen'),
        );
        await closeSettings(page);
        await page.keyboard.press('Escape');
        await openSettings(page);
        await activate('#show-scores');
        await padFrames(page);
        await page.screenshot({
            path: `/tmp/exolon-c64-scores-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'c64');
        await page.setViewportSize({ width: 390, height: 844 });
        await padFrames(page);
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await page.screenshot({
            path: `/tmp/exolon-c64-mobile-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        console.log(
            `PASS: ${name} C64 original assets/16 colors, shared125maps, cache/pause/modes/menus, SID title/effects, saved mode and mobile.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-c64-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
}
