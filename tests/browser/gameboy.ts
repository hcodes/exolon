import { activateControl, prepareControl } from './control-navigation.ts';
import { closeSettings, openGame, openSettings, reloadGame } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { BrowserHelpers } from './types.ts';
import type { World, StageBonus } from '../../src/types/game.ts';
import type { Graphics } from '../../src/types/graphics.ts';

export async function checkGameBoy(
    session: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
        overlayOpen,
    }: Pick<BrowserHelpers, 'prepare' | 'padFrames' | 'waitForPlaying' | 'overlayOpen'>,
    { color = false } = {},
) {
    const mode = color ? 'gameboy-color' : 'gameboy';
    const page = await session.newPage({ viewport: { width: 1100, height: 1000 }, hasTouch: true });
    await prepare(page);
    const activate = async (selector: string) => {
        if (selector === '#game') {
            await prepareControl(page.locator(selector));
            const options = { position: { x: 12, y: 12 } };
            if (name === 'WebKit') await page.locator(selector).tap(options);
            else await page.locator(selector).click(options);
        } else await activateControl(page.locator(selector), name === 'WebKit');
    };
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await page.evaluate(async (color: boolean) => {
            const mode = color ? 'gameboy-color' : 'gameboy';
            const [
                { createRenderer },
                { createState },
                { GAMEBOY_PALETTE, toGameBoyRgba },
                { GAMEBOY_COLOR_PALETTES, toGameBoyColorRgba },
                world,
                graphics,
            ] = await Promise.all([
                import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/renderer.ts')
                >,
                import(new URL('./model/state.js', document.baseURI).href) as Promise<
                    typeof import('../../src/model/state.ts')
                >,
                import(new URL('./view/gameboy-renderer.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/gameboy-renderer.ts')
                >,
                import(
                    new URL('./view/gameboy-color-renderer.js', document.baseURI).href
                ) as Promise<typeof import('../../src/view/gameboy-color-renderer.ts')>,
                fetch('./data/world.json').then((r) => r.json() as Promise<World>),
                fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                    (r) => r.json() as Promise<Graphics>,
                ),
            ]);
            const canvas = document.createElement('canvas'),
                renderer = createRenderer(canvas, {
                    ...graphics,
                    shapes: [...graphics.shapes, Array(8).fill(255)],
                });
            const pixels = () =>
                canvas
                    .getContext('2d')!
                    .getImageData(0, 0, canvas.width, canvas.height)
                    .data.slice();
            const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
                a.length === b.length && a.every((value, i) => value === b[i]);
            renderer.setGraphicsMode(mode);
            if (renderer.graphicsMode !== mode) throw Error('Game Boy presentation is missing');
            const allowed = new Set(
                (color ? GAMEBOY_COLOR_PALETTES.flat() : GAMEBOY_PALETTE).map((rgb) =>
                    rgb.join(','),
                ),
            );
            for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                const state = createState(world, { screenIndex }),
                    snapshot = JSON.stringify(state);
                renderer.addEvents([], state);
                renderer.setGraphicsMode('retro');
                renderer.render(state, 0, 0);
                const original = pixels();
                renderer.setGraphicsMode(mode);
                renderer.render(state, 1000, 0);
                const styled = pixels();
                if (
                    canvas.width !== 256 ||
                    canvas.height !== 192 ||
                    (!color && !same(styled, toGameBoyRgba(original, 256)))
                )
                    throw Error(`Game Boy raster mismatch ${screenIndex}`);
                for (let i = 0; i < styled.length; i += 4)
                    if (
                        !allowed.has(`${styled[i]},${styled[i + 1]},${styled[i + 2]}`) ||
                        styled[i + 3] !== 255
                    )
                        throw Error('Game Boy has extra colors');
                if (color && screenIndex === 0) {
                    const used = new Set();
                    for (let i = 0; i < styled.length; i += 4)
                        used.add(`${styled[i]},${styled[i + 1]},${styled[i + 2]}`);
                    if (used.size <= 4) throw Error('Game Boy Color is still monochrome');
                }
                renderer.render(state, 9000, 0);
                if (!same(styled, pixels())) throw Error('Game Boy advanced while paused');
                renderer.setGraphicsMode('retro');
                renderer.render(state, 0, 0);
                if (!same(original, pixels()))
                    throw Error('Game Boy changed the original ZX raster');
                if (JSON.stringify(state) !== snapshot)
                    throw Error('Game Boy mutated the shared model');
            }
            if (color) {
                const fixture = createState(world),
                    tiles = Array(768).fill(null);
                for (let y = 8; y < 12; y++)
                    for (let x = 8; x < 12; x++)
                        tiles[y * 32 + x] = {
                            instance: 999,
                            block: 6,
                            shape: graphics.shapes.length,
                            color: [0x42, 0x44, 0x41, 0x43][x % 4],
                            collision: 0,
                            overlay: 255,
                        };
                fixture.screen = { ...fixture.screen, tiles, placements: [] };
                fixture.objects = [];
                Object.assign(fixture.player, { x: 32, y: 64, sprite: 5, direction: 1 });
                fixture.enemies = [];
                fixture.rockets = [];
                fixture.spheres = [];
                fixture.enemyBullets = [];
                fixture.bullets = [];
                fixture.grenade = null;
                fixture.killer = null;
                fixture.invulnerable = 0;
                renderer.addEvents([], fixture);
                renderer.setGraphicsMode(mode);
                renderer.render({ ...fixture, player: { ...fixture.player, x: -1000 } }, 0, 0);
                const background = pixels();
                const snapshot = JSON.stringify(fixture);
                renderer.render(fixture, 0, 0);
                const actual = pixels();
                const white = toGameBoyColorRgba(
                    new Uint8ClampedArray(256 * 192 * 4).fill(255),
                    256,
                );
                for (let y = 0; y < 32; y++)
                    for (let x = 0; x < 24; x++) {
                        const offset = ((64 + y) * 256 + 64 + x) * 4,
                            ink = (graphics.player[5 * 96 + y * 3 + (x >> 3)] >> (7 - (x & 7))) & 1;
                        if (
                            !same(
                                actual.slice(offset, offset + 4),
                                (ink ? white : background).slice(offset, offset + 4),
                            )
                        )
                            throw Error(`Game Boy Color attribute clash at ${x},${y}`);
                    }
                if (JSON.stringify(fixture) !== snapshot)
                    throw Error('Game Boy Color sprite layers mutated the model');
            }
            renderer.setGraphicsMode(mode);
            for (const status of ['bonus', 'won', 'over'] as const) {
                const state = createState(world);
                state.status = status;
                state.bonus = { cursor: 3, total: 12345 } as StageBonus;
                renderer.render(state, 1000, 0, {
                    nameEntry: status === 'won',
                    playerName: 'ORBIT',
                });
                if (status === 'over') {
                    const actual = pixels();
                    renderer.setGraphicsMode('retro');
                    renderer.render(state, 1000, 0);
                    const original = pixels();
                    const colored = toGameBoyColorRgba(original, 256);
                    for (const tile of graphics.screens.gameOver)
                        for (let y = 0; y < 8; y++)
                            for (let x = 0; x < 8; x++) {
                                const offset = ((tile.y * 8 + y) * 256 + tile.x * 8 + x) * 4;
                                const ink = (tile.bitmap[y] >> (7 - x)) & 1;
                                const expected = color
                                    ? colored.slice(offset, offset + 4)
                                    : new Uint8ClampedArray([...GAMEBOY_PALETTE[ink ? 3 : 0], 255]);
                                if (!same(actual.slice(offset, offset + 4), expected))
                                    throw Error(
                                        `Game Boy${color ? ' Color' : ''} Game Over must preserve readable source glyphs at ${tile.x * 8 + x},${tile.y * 8 + y}`,
                                    );
                            }
                    renderer.setGraphicsMode(mode);
                }
            }
            for (const options of [{}, { scores: true, rows: [{ name: 'ORBIT', score: 12345 }] }]) {
                renderer.renderTitle(100, options);
                const first = pixels();
                renderer.renderTitle(200, options);
                if (same(first, pixels())) throw Error('Game Boy menu stars are missing');
            }
            renderer.destroy();
        }, color);
        await openSettings(page);
        await page.locator('#graphics-mode').selectOption(mode);
        await padFrames(page);
        assert.equal(await page.locator('#game').getAttribute('data-graphics'), mode);
        await closeSettings(page);
        await activate('#game');
        await page.waitForFunction(
            () =>
                window.__exolonAudioSnapshot().audible === 1 &&
                window.__exolonAudioSnapshot().status.includes('Game Boy'),
        );
        const title = await page.evaluate(() => window.__exolonAudioSnapshot());
        assert.equal(title.track!.channels, 1);
        assert.ok(
            title.track!.duration > 70 &&
                title.track!.duration < 80 &&
                title.track!.peak > 0.1 &&
                title.track!.peak < 1,
        );
        await page.screenshot({
            path: `/tmp/exolon-${mode}-title-${name.toLowerCase()}.png`,
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
        await openSettings(page);
        await page.screenshot({
            path: `/tmp/exolon-${mode}-game-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        const modes = ['remastered', 'retro', 'split', 'c64', 'cpc', 'gameboy', 'gameboy-color'];
        for (const nextMode of [...modes.filter((value) => value !== mode), mode]) {
            await openSettings(page);
            await page.locator('#graphics-mode').selectOption(nextMode);
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
        await activate('#fullscreen');
        await page.waitForFunction(
            () =>
                !document
                    .querySelector<HTMLElement>('.game-app')!
                    .classList.contains('game-app_fullscreen'),
        );
        await page.keyboard.press('Escape');
        await openSettings(page);
        await activate('#show-scores');
        await closeSettings(page);
        await padFrames(page);
        await page.screenshot({
            path: `/tmp/exolon-${mode}-scores-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        await reloadGame(page);
        await page.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#graphics-mode').inputValue(), mode);
        await page.setViewportSize({ width: 390, height: 844 });
        await padFrames(page);
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await page.screenshot({
            path: `/tmp/exolon-${mode}-mobile-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        console.log(
            `PASS: ${name} ${color ? 'Game Boy Color hue palettes' : 'Game Boy four shades'}/125 rasters, source restoration, state/pause/stars/menus, chip title/effects, saved mode, mobile/Fullscreen.`,
        );
    } catch (error) {
        await page.screenshot({
            path: `/tmp/exolon-${mode}-failure-${name.toLowerCase()}.png`,
            fullPage: true,
        });
        throw error;
    } finally {
        await page.close();
    }
}
