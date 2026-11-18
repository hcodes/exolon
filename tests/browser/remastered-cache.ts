import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { GameState, World } from '../../src/types/game.ts';
import type { Graphics } from '../../src/types/graphics.ts';
import { serveReferenceModules } from './reference-mode.ts';

export async function checkRemasteredCache(browser: Browser, name: string) {
    const page = await browser.newPage();
    await serveReferenceModules(page);
    await page.route('https://mc.yandex.ru/**', (route) =>
        route.fulfill({ status: 204, body: '' }),
    );
    try {
        await page.goto('http://127.0.0.1:8091/');
        const result = await page.evaluate(async () => {
            const [{ createRemasteredRenderer }, { createState }, world, graphics] =
                await Promise.all([
                    import(
                        new URL('./view/remastered-renderer.js', document.baseURI).href
                    ) as Promise<typeof import('../../src/view/remastered-renderer.ts')>,
                    import(new URL('./model/state.js', document.baseURI).href) as Promise<
                        typeof import('../../src/model/state.ts')
                    >,
                    fetch('./data/world.json').then(
                        (response) => response.json() as Promise<World>,
                    ),
                    fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                        (response) => response.json() as Promise<Graphics>,
                    ),
                ]);
            const canvas = document.createElement('canvas');
            const renderer = createRemasteredRenderer(canvas, graphics, 2);
            const state = createState(world);
            let gradients = 0;
            const prototype = CanvasRenderingContext2D.prototype;
            const linear = prototype.createLinearGradient;
            const radial = prototype.createRadialGradient;
            prototype.createLinearGradient = function (...args) {
                gradients++;
                return linear.apply(this, args);
            };
            prototype.createRadialGradient = function (...args) {
                gradients++;
                return radial.apply(this, args);
            };
            try {
                renderer.render(state);
                const cold = gradients;
                gradients = 0;
                renderer.render({ ...state, tick: 1 });
                const warm = gradients;
                renderer.reset();
                gradients = 0;
                renderer.render(state);
                return { cold, warm, reset: gradients };
            } finally {
                prototype.createLinearGradient = linear;
                prototype.createRadialGradient = radial;
                renderer.reset();
            }
        });
        assert.ok(result.cold > 100, 'Use the actual detailed first-screen artwork');
        assert.ok(
            result.warm < result.cold / 4,
            `${name}: stationary scenery must not recreate gradients each frame: ${JSON.stringify(result)}`,
        );
        assert.equal(result.reset, result.cold, 'Renderer reset releases the cached scenery');
        console.log(
            `PASS: ${name} Remastered gradient work: ${result.cold} cold / ${result.warm} warm.`,
        );
        const coverage = await page.evaluate(async (webkit) => {
            const [
                scene,
                { createRemasteredLayerCache },
                { createRemasteredSprites },
                { createState },
                world,
                graphics,
            ] = await Promise.all([
                import(new URL('./view/remastered-scene.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/remastered-scene.ts')
                >,
                import(new URL('./view/remastered-cache.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/remastered-cache.ts')
                >,
                import(new URL('./view/remastered-sprites.js', document.baseURI).href) as Promise<
                    typeof import('../../src/view/remastered-sprites.ts')
                >,
                import(new URL('./model/state.js', document.baseURI).href) as Promise<
                    typeof import('../../src/model/state.ts')
                >,
                fetch('./data/world.json').then((response) => response.json() as Promise<World>),
                fetch('./assets/graphics/zx-spectrum/graphics.json').then(
                    (response) => response.json() as Promise<Graphics>,
                ),
            ]);
            let frames = 0,
                pickups = 0,
                destructions = 0,
                maxDifference = 0;
            for (const scale of [2, 4] as const) {
                const cache = createRemasteredLayerCache(document, scale);
                const surfaces = new Set<HTMLCanvasElement>();
                function target(cached: boolean) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 256 * scale;
                    canvas.height = 176 * scale;
                    const context = canvas.getContext('2d', { alpha: false })!;
                    const sprites = createRemasteredSprites(graphics);
                    if (cached) {
                        const drawImage = context.drawImage;
                        Object.defineProperty(context, 'drawImage', {
                            value(...args: Parameters<typeof drawImage>) {
                                if (args[0] instanceof HTMLCanvasElement) surfaces.add(args[0]);
                                return drawImage.apply(context, args);
                            },
                        });
                    }
                    return (state: GameState, fraction: number) => {
                        const time = ((state.tick + fraction) * 1000) / 30;
                        context.setTransform(scale, 0, 0, scale, 0, 0);
                        context.clearRect(0, 0, 256, 176);
                        scene.drawRemasteredScene(
                            context,
                            state,
                            graphics,
                            time,
                            cached ? cache : undefined,
                        );
                        sprites.draw(context, state, time, fraction);
                        scene.drawRemasteredForeground(
                            context,
                            state,
                            time,
                            cached ? cache : undefined,
                        );
                        return context.getImageData(0, 0, canvas.width, canvas.height).data;
                    };
                }
                const reference = target(false),
                    cached = target(true);
                function compare(state: GameState, fraction = 0) {
                    const expected = reference(state, fraction),
                        actual = cached(state, fraction);
                    let edgeChannels = 0;
                    for (let index = 0; index < actual.length; index++) {
                        const difference = Math.abs(actual[index] - expected[index]);
                        maxDifference = Math.max(maxDifference, difference);
                        // Grouped translucent fills accumulate 8-bit rounding.
                        // WebKit also varies coverage at a few antialiased edges.
                        if (difference > 6 && webkit && difference <= 16) edgeChannels++;
                        else if (difference > 6)
                            throw Error(
                                `Cached scene ${state.screenIndex + 1}, scale ${scale}, tick ${state.tick}: channel ${index} differs by ${difference}`,
                            );
                    }
                    if (edgeChannels > 16)
                        throw Error(`WebKit changed ${edgeChannels} edge channels in one frame`);
                    frames++;
                    return actual;
                }
                for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                    const state = createState(world, { screenIndex });
                    const previous = [...surfaces];
                    surfaces.clear();
                    compare(state);
                    if (previous.some((surface) => surface.width || surface.height))
                        throw Error('A screen transition retained an old raster layer');
                    const coldLayers = surfaces.size;
                    compare({ ...state, tick: 29 }, 0.35);
                    if (surfaces.size !== coldLayers)
                        throw Error('A warm frame allocated more stationary layers');
                    const supply = state.objects.find((object) => [7, 8].includes(object.type));
                    if (supply) {
                        compare({
                            ...state,
                            objects: state.objects.map((object) =>
                                object === supply ? { ...object, active: false } : object,
                            ),
                        });
                        pickups++;
                    }
                    const obstacle = state.screen.tiles.find(
                        (tile) =>
                            tile?.instance !== undefined &&
                            [21, 22, 24, 25, 27, 34].includes(tile.block),
                    );
                    if (obstacle) {
                        compare({ ...state, destroyed: [obstacle.instance!] });
                        destructions++;
                    }
                }
                const state = createState(world);
                compare(state);
                const before = JSON.stringify(state);
                const geometryState: GameState = {
                    ...state,
                    // Block 39 uses the recovered contour path instead of redrawn machinery.
                    screen: {
                        tiles: Array.from({ length: 704 }, (_, index) =>
                            index === 10 * 32 + 10
                                ? {
                                      block: 39,
                                      instance: 0,
                                      ink: true,
                                      shape: 0,
                                      color: 71,
                                      collision: 0,
                                  }
                                : null,
                        ),
                    },
                    objects: [],
                    world: {
                        ...world,
                        contours: [
                            [
                                [
                                    [0, 0],
                                    [8, 0],
                                    [8, 8],
                                    [0, 8],
                                ],
                            ],
                        ],
                    },
                };
                const square = compare(geometryState);
                const oldLayers = [...surfaces];
                const triangle = compare({
                    ...geometryState,
                    world: {
                        ...world,
                        contours: [
                            [
                                [
                                    [0, 0],
                                    [8, 0],
                                    [0, 8],
                                ],
                            ],
                        ],
                    },
                });
                if (!triangle.some((channel, index) => Math.abs(channel - square[index]) > 8))
                    throw Error('Replacing contour geometry did not change the scenery');
                if (oldLayers.some((surface) => surface.width || surface.height))
                    throw Error('Replacing contours retained old raster layers');
                compare(state);
                if (JSON.stringify(state) !== before) throw Error('Rendering mutated the model');
                cache.reset();
                if ([...surfaces].some((surface) => surface.width || surface.height))
                    throw Error('Reset retained a raster backing store');
                compare(state);
                cache.reset();
            }
            return { frames, pickups, destructions, maxDifference };
        }, name === 'WebKit');
        assert.ok(
            coverage.frames >= 500,
            'Check all 125 screens, cold/warm frames and both scales',
        );
        assert.ok(coverage.pickups >= 20);
        assert.ok(coverage.destructions >= 20);
        console.log(
            `PASS: ${name} Remastered cached pixels, live animation, pickups, destruction, transitions and reset: ${JSON.stringify(coverage)}.`,
        );
    } finally {
        await page.close();
    }
}
