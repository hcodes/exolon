import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { World, StageBonus } from '../../src/types/game.ts';
import type { Graphics, SharpGraphics } from '../../src/types/graphics.ts';
import type { BrowserHelpers } from './types.ts';
import { openGame, reloadGame, openHome, openSettings } from './navigation.ts';

export async function checkSharp(
    browser: Browser,
    name: string,
    {
        prepare,
        padFrames,
        waitForPlaying,
    }: Pick<BrowserHelpers, 'prepare' | 'padFrames' | 'waitForPlaying'>,
) {
    for (const legacy of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
        await prepare(page);
        try {
            await openGame(
                page,
                `http://127.0.0.1:8091/?graphics=sharp-mz800&level=41${legacy ? '&legacy=1' : ''}`,
            );
            assert.equal(await page.locator('#graphics-mode').inputValue(), 'sharp-mz800');
            await page.waitForFunction(() => {
                const audio = window.__exolonAudioSnapshot();
                return audio.audible === 1 && audio.status.includes('Sharp MZ-800');
            });
            const audio = await page.evaluate(() => window.__exolonAudioSnapshot());
            assert.equal(audio.track!.channels, 1);
            assert.ok(audio.track!.duration > 72 && audio.track!.duration < 73);
            assert.ok(audio.track!.peak > 0.1);
            const dimensions = () =>
                page
                    .locator('#game')
                    .evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
            if (!legacy) {
                await page.evaluate(async () => {
                    const [
                        { createRenderer },
                        { createState },
                        { SHARP_PALETTE, SHARP_INK_MAP },
                        world,
                        zx,
                        sharp,
                    ] = await Promise.all([
                        import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                            typeof import('../../src/view/renderer.ts')
                        >,
                        import(new URL('./model/state.js', document.baseURI).href) as Promise<
                            typeof import('../../src/model/state.ts')
                        >,
                        import(
                            new URL('./view/sharp-renderer.js', document.baseURI).href
                        ) as Promise<typeof import('../../src/view/sharp-renderer.ts')>,
                        fetch('./data/world.json').then((r) => r.json() as Promise<World>),
                        fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                            (r) => r.json() as Promise<Graphics>,
                        ),
                        fetch('./assets/graphics/sharp-mz800/graphics.json').then(
                            (r) => r.json() as Promise<SharpGraphics>,
                        ),
                    ]);
                    const canvas = document.createElement('canvas'),
                        renderer = createRenderer(canvas, { ...zx, sharp });
                    const pixels = () =>
                        canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
                            .data;
                    const equal = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
                        a.length === b.length && a.every((value, i) => value === b[i]);
                    const palette = new Set(SHARP_PALETTE.map((rgb) => rgb.join(',')));
                    renderer.setGraphicsMode('sharp-mz800');
                    const first = createState(world);
                    renderer.addEvents([], first);
                    renderer.render(first, 1000, 0);
                    const original = pixels();
                    const used = new Set<string>();
                    for (let i = 0; i < original.length; i += 4) {
                        const color = Array.from(original.slice(i, i + 3)).join(',');
                        if (!palette.has(color)) throw Error(`Non-native Sharp color ${color}`);
                        used.add(color);
                    }
                    if (used.size <= 4) throw Error('Original Sharp colors were quantized');
                    renderer.render(first, 9000, 0);
                    if (!equal(original, pixels())) throw Error('Paused Sharp animation advanced');
                    renderer.setGraphicsMode('retro');
                    renderer.render(first, 1000, 0);
                    renderer.setGraphicsMode('sharp-mz800');
                    renderer.render(first, 1000, 0);
                    if (!equal(original, pixels())) throw Error('Sharp cache restoration failed');
                    // Independent GDG oracle: actual hero rows over green source cells.
                    // Every covered native pixel must be baseInk XOR 15; neighbouring
                    // pixels retain their colour as the hero crosses 8x8 boundaries.
                    const crossing = createState(world);
                    crossing.objects = [];
                    crossing.screen = { ...crossing.screen, tiles: Array(768).fill(null) };
                    for (let y = 9; y < 15; y++)
                        for (let x = 9; x < 15; x++)
                            crossing.screen.tiles[y * 32 + x] = {
                                instance: 9999,
                                block: 6,
                                shape: 451,
                                color: 0x44,
                                collision: 0,
                                overlay: 255,
                            };
                    crossing.player = { ...crossing.player, y: 80, sprite: 5, direction: 1 };
                    for (const x of [40, 41, 42, 43, 44]) {
                        crossing.player.x = x;
                        renderer.addEvents([], crossing);
                        const snapshot = JSON.stringify(crossing);
                        renderer.render(crossing, 1000, 0);
                        const actual = pixels();
                        for (let y = 80; y < 112; y++)
                            for (let px = 72; px < 120; px++) {
                                const base = (sharp.shapes[451][y & 7] >> (7 - (px & 7))) & 1;
                                const dx = px - x * 2,
                                    dy = y - 80;
                                const hero =
                                    dx >= 0 && dx < 24
                                        ? (sharp.player[5 * 96 + dy * 3 + (dx >> 3)] >>
                                              (7 - (dx & 7))) &
                                          1
                                        : 0;
                                const ink = (base ? 12 : 0) ^ (hero ? 15 : 0);
                                const rgb = SHARP_PALETTE[SHARP_INK_MAP[ink]];
                                const at = ((y + 4) * 320 + px + 32) * 4;
                                if (rgb.some((value, c) => actual[at + c] !== value))
                                    throw Error(
                                        `Sharp pixel planes/cell bleed at ${px},${y}, hero x=${x}`,
                                    );
                            }
                        if (JSON.stringify(crossing) !== snapshot)
                            throw Error('Sharp pixel compositing mutated the model');
                    }
                    renderer.addEvents([], first);
                    for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                        const state = createState(world, { screenIndex }),
                            before = JSON.stringify(state);
                        renderer.addEvents([], state);
                        renderer.render(state, 1000, 0);
                        if (JSON.stringify(state) !== before)
                            throw Error(`Sharp mutated shared map ${screenIndex}`);
                    }
                    for (const status of ['bonus', 'over', 'won'] as const) {
                        const state = createState(world);
                        state.status = status;
                        state.bonus = { cursor: 3, total: 12345 } as StageBonus;
                        renderer.render(state, 1000, 0, { nameEntry: true, playerName: 'SHARP' });
                    }
                    for (const options of [{}, { menu: true }, { scores: true, rows: [] }]) {
                        renderer.renderTitle(100, options);
                        const a = pixels();
                        renderer.renderTitle(200, options);
                        if (equal(a, pixels())) throw Error('Sharp title/records flares missing');
                    }
                    // Compare every Split pixel against independently rendered platform frames.
                    const references = ['sharp-mz800', 'retro', 'remastered'].map((mode) => {
                        renderer.setGraphicsMode(mode);
                        renderer.render(first, 1000, 0);
                        const scaled = document.createElement('canvas');
                        scaled.width = 1024;
                        scaled.height = 768;
                        const context = scaled.getContext('2d')!;
                        context.imageSmoothingEnabled = false;
                        context.drawImage(canvas, 0, 0, 1024, 768);
                        return context.getImageData(0, 0, 1024, 768).data;
                    });
                    renderer.setGraphicsMode('split');
                    for (const [left, right] of [
                        ['sharp-mz800', 'retro'],
                        ['retro', 'sharp-mz800'],
                        ['sharp-mz800', 'remastered'],
                        ['remastered', 'sharp-mz800'],
                    ]) {
                        renderer.setSplitModes(left, right);
                        for (const position of [0, 0.5, 1]) {
                            renderer.setSplitPosition(position);
                            renderer.render(first, 1000, 0);
                            const actual = pixels(),
                                boundary = Math.round(1024 * position);
                            for (let y = 0; y < 768; y++)
                                for (let x = 0; x < 1024; x++) {
                                    const mode = x < boundary ? left : right,
                                        expected =
                                            references[
                                                ['sharp-mz800', 'retro', 'remastered'].indexOf(mode)
                                            ],
                                        at = (y * 1024 + x) * 4;
                                    for (let c = 0; c < 4; c++)
                                        if (actual[at + c] !== expected[at + c])
                                            throw Error(
                                                `Sharp Split ${left}/${right} at ${x},${y}`,
                                            );
                                }
                        }
                    }
                    renderer.destroy();
                });
            }
            await page.screenshot({ path: `/tmp/reex-sharp-title-${name}-${legacy}.png` });
            await openHome(page);
            await page.locator('#new-game').press('Enter');
            await waitForPlaying(page);
            await padFrames(page);
            assert.deepEqual(await dimensions(), [320, 200]);
            assert.equal(await page.locator('#sector').textContent(), '041 / 125');
            await page.locator('#game').focus();
            await page.keyboard.down('Space');
            try {
                await page.waitForFunction(
                    () => document.getElementById('ammo')!.textContent === '98',
                );
            } finally {
                await page.keyboard.up('Space');
            }
            await page.waitForFunction(() => window.__exolonAudioSnapshot().effects > 0);
            assert.equal((await page.evaluate(() => window.__exolonAudioSnapshot())).active, 0);
            await openHome(page);
            await page.locator('#pause').press('Enter');
            const hud = await page.locator('#hud').textContent();
            for (const mode of ['retro', 'remastered', 'sharp-mz800', 'split']) {
                await openSettings(page);
                await page.selectOption('#graphics-mode', mode);
                await padFrames(page);
                assert.equal(await page.locator('#hud').textContent(), hud);
            }
            await openSettings(page);
            await page.selectOption('#split-left', 'sharp-mz800');
            await openSettings(page);
            await page.selectOption('#split-right', 'remastered');
            await openSettings(page);
            await page.selectOption('#graphics-mode', 'sharp-mz800');
            await page.screenshot({ path: `/tmp/reex-sharp-game-${name}-${legacy}.png` });
            await reloadGame(page);
            assert.equal(await page.locator('#graphics-mode').inputValue(), 'sharp-mz800');
            await page.setViewportSize({ width: 390, height: 844 });
            await padFrames(page);
            assert.ok(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            );
        } finally {
            await page.close();
        }
    }
    const missing = await browser.newPage();
    await prepare(missing);
    try {
        await missing.route('**/assets/graphics/sharp-mz800/graphics.json*', (route) =>
            route.abort(),
        );
        await missing.goto('http://127.0.0.1:8091/?graphics=sharp-mz800&level=41');
        await missing.locator('#new-game:not([disabled])').waitFor({ state: 'attached' });
        await missing.locator('[data-platform="retro"]').press('Enter');
        assert.equal(await missing.locator('#graphics-mode').inputValue(), 'retro');
        assert.equal(
            await missing.locator('#graphics-mode option[value="sharp-mz800"]').isDisabled(),
            true,
        );
        await openHome(missing);
        await missing.locator('#new-game').press('Enter');
        await waitForPlaying(missing);
        assert.equal(await missing.locator('#sector').textContent(), '041 / 125');
    } finally {
        await missing.close();
    }
    console.log(
        `PASS: ${name} Sharp native16 colors, 125maps, Split crops, menus, SN audio, legacy, saved selection and missing-art fallback.`,
    );
}
