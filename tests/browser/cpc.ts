import { prepareControl } from './control-navigation.ts';
import {
    openGame,
    reloadGame,
    openSettings,
    closeSettings,
    openHome,
    closeHome,
} from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { World, StageBonus } from '../../src/types/game.ts';
import type { Graphics, CpcGraphics } from '../../src/types/graphics.ts';

export async function checkCPC(
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
    await unavailable.addInitScript(() => localStorage.setItem('exolon-graphics', 'cpc'));
    await unavailable.route('**/assets/graphics/amstrad-cpc/cpc-graphics.json*', (route) =>
        route.fulfill({ status: 404, body: '' }),
    );
    try {
        await openGame(unavailable, 'http://127.0.0.1:8091/');
        await unavailable.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await unavailable.locator('#graphics-mode').inputValue(), 'retro');
        assert.equal(
            await unavailable.locator('#graphics-mode option[value="cpc"]').isDisabled(),
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
    async function activate(selector: string) {
        if (selector === '#pause') {
            await closeHome(page);
            await closeSettings(page);
            await page.locator('#game').focus();
            await page.keyboard.press('Pause');
            return;
        }
        const control = page.locator(selector);
        await prepareControl(control);
        if (name === 'WebKit') await control.tap();
        else await control.click();
    }
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.evaluate(async () => {
            const [{ createRenderer }, { createState, step }, world, graphics, cpc] =
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
                    fetch('./assets/graphics/amstrad-cpc/cpc-graphics.json').then(
                        (r) => r.json() as Promise<CpcGraphics>,
                    ),
                ]);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, { ...graphics, cpc });
            const pixels = () =>
                canvas
                    .getContext('2d')!
                    .getImageData(0, 0, canvas.width, canvas.height)
                    .data.slice();
            const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
                a.length === b.length && a.every((value, i) => value === b[i]);
            renderer.setGraphicsMode('cpc');
            if (renderer.graphicsMode !== 'cpc') throw Error('CPC presentation is missing');
            const first = createState(world);
            renderer.addEvents([], first);
            const before = JSON.stringify(first);
            renderer.render(first, 1000, 0);
            if (canvas.width !== 256 || canvas.height !== 192 || JSON.stringify(first) !== before)
                throw Error('CPC must use shared coordinates and immutable state');
            const original = pixels(),
                colors = new Set();
            for (let i = 0; i < original.length; i += 4)
                colors.add(`${original[i]},${original[i + 1]},${original[i + 2]}`);
            if (colors.size < 8 || colors.size > 16)
                throw Error(`CPC must use its 16-color source display, got ${colors.size}`);
            for (let i = 0; i < original.length; i += 8)
                if (!original.slice(i, i + 4).every((value, j) => value === original[i + 4 + j]))
                    throw Error('CPC Mode0 wide pixel is split');
            renderer.render(first, 9000, 0);
            if (!same(original, pixels())) throw Error('Paused CPC animation advanced');
            renderer.setGraphicsMode('retro');
            renderer.render(first, 1000, 0);
            const zx = pixels();
            if (same(original, zx)) throw Error('CPC is still ZX graphics');
            renderer.setGraphicsMode('cpc');
            renderer.render(first, 1000, 0);
            if (!same(original, pixels())) throw Error('CPC mode restoration failed');
            for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                const state = createState(world, { screenIndex }),
                    snapshot = JSON.stringify(state);
                renderer.addEvents([], state);
                renderer.render(state, 0, 0);
                if (JSON.stringify(state) !== snapshot)
                    throw Error(`CPC mutated screen ${screenIndex}`);
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
                throw Error('CPC impact fixture must destroy an object with a rocket');
            renderer.destroy();
            renderer.render(impact.state, 0, 0);
            const withoutExplosion = pixels();
            renderer.addEvents(impact.events, impact.state);
            for (let age = 0; age < 9; age++) {
                renderer.render({ ...impact.state, tick: impact.state.tick + age }, 0, 0);
                if (same(withoutExplosion, pixels()))
                    throw Error(`CPC object explosion is invisible at age ${age}`);
            }
            renderer.render({ ...impact.state, tick: impact.state.tick + 10 }, 0, 0);
            if (same(withoutExplosion, pixels()))
                throw Error('CPC destruction debris disappeared with the impact flash');
            renderer.render({ ...impact.state, tick: impact.state.tick + 12 }, 0, 0);
            const debris = pixels();
            let scattered = 0;
            for (let y = 0; y < 176; y++)
                for (let x = 0; x < 256; x += 2) {
                    const index = (y * 256 + x) * 4;
                    if (
                        (x < 144 || x >= 192 || y < 104 || y >= 144) &&
                        !debris
                            .slice(index, index + 4)
                            .every((value, channel) => value === withoutExplosion[index + channel])
                    )
                        scattered++;
                    if (
                        !debris
                            .slice(index, index + 4)
                            .every((value, channel) => value === debris[index + 4 + channel])
                    )
                        throw Error('CPC destruction split a Mode0 wide pixel');
                }
            if (!scattered) throw Error('CPC object destruction has no travelling fragments');
            renderer.render({ ...impact.state, tick: impact.state.tick + 12 }, 9000, 0);
            if (!same(debris, pixels())) throw Error('Paused CPC destruction advanced');
            renderer.render({ ...impact.state, tick: impact.state.tick + 176 }, 0, 0);
            if (!same(withoutExplosion, pixels()))
                throw Error('CPC destruction debris did not expire');
            renderer.destroy();
            const bareCanvas = document.createElement('canvas'),
                bare = createRenderer(bareCanvas, {
                    ...graphics,
                    cpc: { ...cpc, compatibilityBlocks: {} as CpcGraphics['compatibilityBlocks'] },
                });
            bare.setGraphicsMode('cpc');
            for (const id of [41, 48, 49, 51]) {
                const screenIndex = world.screens.findIndex((screen) =>
                        screen.placements!.some((item) => item.block === id),
                    ),
                    state = createState(world, { screenIndex });
                renderer.addEvents([], state);
                renderer.render(state, 0, 0);
                bare.addEvents([], state);
                bare.render(state, 0, 0);
                const omitted = bareCanvas.getContext('2d')!.getImageData(0, 0, 256, 192).data;
                if (same(pixels(), omitted))
                    throw Error(`CPC compatibility geometry ${id} is invisible`);
            }
            bare.destroy();
            const supplies = createState(world, { screenIndex: 2 }),
                box = supplies.objects.find((object) => object.type === 7)!;
            renderer.addEvents([], supplies);
            renderer.render(supplies, 0, 0);
            const stocked = pixels();
            box.active = false;
            renderer.render(supplies, 0, 0);
            if (same(stocked, pixels())) throw Error('Collected CPC supply remains visible');
            box.active = true;
            renderer.render(supplies, 0, 0);
            if (!same(stocked, pixels())) throw Error('CPC scenery cache did not restore supply');
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
                throw Error('CPC planet splash is missing before the separate launch menu');
            renderer.renderTitle(0);
            if (!same(planets, pixels())) throw Error('CPC planet splash did not restore');
            for (const options of [
                {},
                { menu: true },
                { scores: true, rows: [{ name: 'ORBIT', score: 12345 }] },
            ]) {
                renderer.renderTitle(100, options);
                const stars = pixels();
                renderer.renderTitle(200, options);
                if (same(stars, pixels())) throw Error('CPC title/records flares are missing');
            }
            renderer.renderTitle(0, { scores: true, rows: [] });
            const records = pixels();
            for (let y = 40; y < 56; y++)
                for (let x = 64; x < 192; x++)
                    if (
                        records[(y * 256 + x) * 4] ||
                        records[(y * 256 + x) * 4 + 1] ||
                        records[(y * 256 + x) * 4 + 2]
                    )
                        throw Error('Baked CPC records remain in the dynamic score strip');
            renderer.destroy();
        });
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption('cpc');
        await padFrames(page);
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'cpc');
        await activate('#game');
        await page.waitForFunction(
            () =>
                window.__exolonAudioSnapshot().audible === 1 &&
                window.__exolonAudioSnapshot().status.includes('Amstrad CPC'),
        );
        const title = await page.evaluate(() => window.__exolonAudioSnapshot());
        assert.equal(title.track!.channels, 1);
        assert.ok(
            title.track!.duration >= 100 && title.track!.duration <= 110 && title.track!.peak > 0.1,
        );
        await page.screenshot({
            path: `/tmp/exolon-cpc-title-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await activate('#new-game');
        await waitForPlaying(page);
        await page.keyboard.press('Space');
        await page.waitForFunction(() => window.__exolonAudioSnapshot().effects > 0);
        assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).active, 0);
        await activate('#pause');
        const hud = await page.locator('#hud').textContent();
        await page.screenshot({
            path: `/tmp/exolon-cpc-game-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await openSettings(page);
        for (const mode of ['remastered', 'retro', 'split', 'c64', 'cpc']) {
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption(mode);
            await padFrames(page);
            assert.equal(await page.locator('#hud').textContent(), hud);
            assert.equal(await overlayOpen(page), true);
        }
        await activate('#fullscreen');
        await page.waitForFunction(() =>
            document
                .querySelector<HTMLElement>('.game-app')!
                .classList.contains('game-app_fullscreen'),
        );
        await padFrames(page);
        assert.equal(await page.locator('#hud').textContent(), hud);
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), 'cpc');
        await activate('#fullscreen');
        await page.waitForFunction(
            () =>
                !document
                    .querySelector<HTMLElement>('.game-app')!
                    .classList.contains('game-app_fullscreen'),
        );
        await page.keyboard.press('Escape');
        await activate('#show-scores');
        await padFrames(page);
        await page.screenshot({
            path: `/tmp/exolon-cpc-scores-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#graphics-mode').inputValue(), 'cpc');
        await page.setViewportSize({ width: 390, height: 844 });
        await padFrames(page);
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await page.screenshot({
            path: `/tmp/exolon-cpc-mobile-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        console.log(
            `PASS: ${name} CPC original assets/16 colors, shared125maps, cache/pause/modes/menus, AY title/effects, saved mode and mobile.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-cpc-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
}
