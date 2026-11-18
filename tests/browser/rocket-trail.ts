import { serveReferenceModules } from './reference-mode.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { Graphics } from '../../src/types/graphics.ts';
import type { GameState } from '../../src/types/game.ts';

export async function checkRocketTrail(browser: Browser, name: string) {
    const page = await browser.newPage();
    await serveReferenceModules(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    await page.route(/\.(wav|mp3|m4a)(\?|$)/, (route) => route.abort());
    try {
        await page.goto('http://127.0.0.1:8091/');
        const result = await page.evaluate(async () => {
            const [{ createRenderer }, { createState }, graphics] = await Promise.all([
                import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/renderer.ts')
                >,
                import(new URL('./model/state.js', document.baseURI).href) as Promise<
                    typeof import('../../src/model/state.ts')
                >,
                fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                    (response) => response.json() as Promise<Graphics>,
                ),
            ]);
            const base = createState({
                id: 0,
                tiles: Array(768).fill(null),
                placements: [],
                objects: [],
                actions: [],
            });
            const changed = (
                a: Uint8ClampedArray,
                b: Uint8ClampedArray,
                width: number,
                scale: number,
                left: number,
                right: number,
            ) => {
                let count = 0;
                for (let y = 65 * scale; y < 83 * scale; y++)
                    for (let x = left * scale; x < right * scale; x++) {
                        const at = (y * width + x) * 4;
                        if (
                            [0, 1, 2].some(
                                (channel) => Math.abs(a[at + channel] - b[at + channel]) > 8,
                            )
                        )
                            count++;
                    }
                return count;
            };
            const results: {
                mode: string;
                direction: number;
                flying: number;
                impact: number;
                faded: number;
                late: number;
            }[] = [];
            for (const mode of ['retro', 'remastered'])
                for (const direction of [1, -1]) {
                    const canvas = document.createElement('canvas'),
                        baselineCanvas = document.createElement('canvas');
                    const renderer = createRenderer(canvas, graphics),
                        reference = createRenderer(baselineCanvas, graphics);
                    renderer.setGraphicsMode(mode);
                    reference.setGraphicsMode(mode);
                    const pixels = (element: HTMLCanvasElement) =>
                        element.getContext('2d')!.getImageData(0, 0, element.width, element.height)
                            .data;
                    let state: GameState = base;
                    const compare = () => {
                        renderer.render(state, (state.tick * 1000) / 30, 1);
                        const empty = { ...state, grenade: null };
                        reference.destroy();
                        reference.addEvents([], empty);
                        reference.render(empty, (state.tick * 1000) / 30, 1);
                        return changed(
                            pixels(canvas),
                            pixels(baselineCanvas),
                            canvas.width,
                            canvas.width / 256,
                            direction > 0 ? 115 : 180,
                            direction > 0 ? 129 : 194,
                        );
                    };
                    try {
                        for (let tick = 1; tick <= 4; tick++) {
                            state = {
                                ...base,
                                tick,
                                grenade: {
                                    x: (direction > 0 ? 60 : 90) + direction * (tick - 1) * 3,
                                    y: 70,
                                    dx: direction,
                                    phase: 28 - tick,
                                    projectileId: 1,
                                },
                            };
                            renderer.addEvents([], state);
                            renderer.render(state, (tick * 1000) / 30, 1);
                        }
                        const snapshot = JSON.stringify(state),
                            flying = compare();
                        if (JSON.stringify(state) !== snapshot)
                            throw Error('Trail changed projectile/model state');
                        state = { ...state, tick: 5, grenade: null };
                        renderer.addEvents([], state);
                        const impact = compare();
                        for (let tick = 6; tick <= 14; tick++) {
                            state = { ...state, tick };
                            renderer.addEvents([], state);
                        }
                        const faded = compare();
                        renderer.destroy();
                        for (let tick = 20; tick <= 23; tick++) {
                            state = {
                                ...base,
                                tick,
                                grenade: {
                                    x: (direction > 0 ? 60 : 90) + direction * (tick - 20) * 3,
                                    y: 70,
                                    dx: direction,
                                    phase: 18,
                                    projectileId: 2,
                                },
                            };
                            renderer.addEvents([], state);
                        }
                        const late = compare();
                        results.push({ mode, direction, flying, impact, faded, late });
                    } finally {
                        renderer.destroy();
                        reference.destroy();
                    }
                }
            return results;
        });
        for (const item of result) {
            if (item.mode === 'remastered') {
                assert.ok(
                    item.flying > 10,
                    `${name}: visible exhaust behind moving rocket ${item.direction}`,
                );
                assert.ok(item.impact > 0, 'exhaust persists briefly after impact');
            } else {
                assert.ok(item.flying > 0, 'ZX retains its existing initial particle trail');
                assert.ok(item.impact > 0);
            }
            assert.equal(item.faded, 0, 'spent smoke disappears');
            assert.equal(item.late, 0, 'late flight keeps the original no-new-smoke rule');
        }
        assert.deepEqual(errors, []);
        console.log(
            `PASS: ${name} Remastered rocket trail in both directions, lingering/fading smoke, original boost-phase rule and unchanged projectile state.`,
        );
    } finally {
        await page.close();
    }
}
