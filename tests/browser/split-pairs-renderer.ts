import { serveReferenceModules } from './reference-mode.ts';
import { openGame } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { GameEvent, World, StageBonus } from '../../src/types/game.ts';
import type { Graphics, NativeGraphics, CpcGraphics } from '../../src/types/graphics.ts';

export async function checkSplitPairsRenderer(session: Browser, name: string) {
    const page = await session.newPage();
    await serveReferenceModules(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        const result = await page.evaluate(
            async (tolerance) => {
                const [{ createRenderer }, { createState }, world, base, c64, cpc] =
                    (await Promise.all([
                        import(new URL('./view/renderer.js', document.baseURI).href) as Promise<
                            typeof import('../../src/view/renderer.ts')
                        >,
                        import(new URL('./model/state.js', document.baseURI).href) as Promise<
                            typeof import('../../src/model/state.ts')
                        >,
                        ...[
                            './data/world.json',
                            './assets/graphics/zx-spectrum/graphics.json',
                            './assets/graphics/c64/c64-graphics.json',
                            './assets/graphics/amstrad-cpc/cpc-graphics.json',
                        ].map((file) => fetch(file).then((r) => r.json())),
                    ])) as [
                        typeof import('../../src/view/renderer.ts'),
                        typeof import('../../src/model/state.ts'),
                        World,
                        Graphics,
                        NativeGraphics,
                        CpcGraphics,
                    ];
                const graphics = {
                    ...base,
                    c64,
                    cpc,
                    shapes: [...base.shapes, Array(8).fill(255)],
                };
                const modes = ['retro', 'remastered', 'c64', 'cpc', 'gameboy', 'gameboy-color'];
                const canvases = Array.from({ length: 3 }, () => document.createElement('canvas')),
                    renderers = canvases.map((canvas) => createRenderer(canvas, graphics));
                const split = renderers[2];
                split.setGraphicsMode('split');
                split.setSplitModes('retro', 'remastered');
                const copy = split.splitModes;
                copy.left = 'gameboy';
                if (split.splitModes.left !== 'retro')
                    throw Error('Split pair getter leaked mutable state');
                const pixels = (canvas: HTMLCanvasElement) => {
                    const bytes = canvas
                        .getContext('2d')!
                        .getImageData(0, 0, canvas.width, canvas.height).data;
                    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
                };
                let checked = 0;
                function compare(
                    left: string,
                    right: string,
                    draw: (renderer: ReturnType<typeof createRenderer>) => void,
                    positions = [0.5],
                ) {
                    renderers[0].setGraphicsMode(left);
                    renderers[1].setGraphicsMode(right);
                    split.setSplitModes(left, right);
                    if (split.splitModes.left !== left || split.splitModes.right !== right)
                        throw Error(`Pair rejected ${left}/${right}`);
                    draw(renderers[0]);
                    draw(renderers[1]);
                    const sources = [pixels(canvases[0]), pixels(canvases[1])],
                        widths = canvases.slice(0, 2).map((canvas) => canvas.width);
                    for (const position of positions) {
                        split.setSplitPosition(position);
                        draw(split);
                        if (canvases[2].width !== 1024 || canvases[2].height !== 768)
                            throw Error('Split dimensions changed');
                        const actual = pixels(canvases[2]),
                            boundary = Math.round(position * 1024);
                        for (let y = 0; y < 768; y++)
                            for (let x = 0; x < 1024; x++) {
                                const side = x < boundary ? 0 : 1,
                                    index =
                                        widths[side] === 256
                                            ? (y >> 2) * 256 + (x >> 2)
                                            : y * 1024 + x;
                                const got = actual[y * 1024 + x],
                                    expected = sources[side][index];
                                if (got === expected) continue;
                                const allowed = tolerance && [left, right][side] === 'remastered';
                                if (
                                    !allowed ||
                                    [0, 8, 16].some(
                                        (shift) =>
                                            Math.abs(
                                                ((got >>> shift) & 255) -
                                                    ((expected >>> shift) & 255),
                                            ) > tolerance,
                                    ) ||
                                    got >>> 24 !== expected >>> 24
                                ) {
                                    throw Error(
                                        `Pair crop ${left}/${right} frame${checked} at${position} pixel${x},${y}`,
                                    );
                                }
                            }
                        checked++;
                    }
                }
                const state = createState(world);
                state.tick = 0;
                state.screen = {
                    ...state.screen,
                    tiles: state.screen.tiles.map((tile) => (tile ? { ...tile } : null)),
                };
                state.screen.tiles[16] = {
                    instance: 9999,
                    block: 6,
                    shape: base.shapes.length,
                    color: 0xc2,
                    collision: 1,
                    overlay: 255,
                };
                state.bullets = [{ x: 24, y: 124, dx: 1 }];
                const events: GameEvent[] = [
                    { type: 'explosion', x: 120, y: 90 },
                    { type: 'teleport', x: 60, y: 70 },
                ];
                renderers.forEach((renderer) => renderer.addEvents(events, state));
                const before = JSON.stringify(state);
                for (const left of modes)
                    for (const right of modes) {
                        compare(
                            left,
                            right,
                            (renderer) => renderer.render(state, 1000, 0.4),
                            [0, 0.5, 1],
                        );
                        compare(left, right, (renderer) =>
                            renderer.render(state, 9000, 0, { paused: true }),
                        );
                        compare(left, right, (renderer) => renderer.renderTitle(2300));
                        compare(left, right, (renderer) =>
                            renderer.renderTitle(2300, { menu: true }),
                        );
                        compare(left, right, (renderer) =>
                            renderer.renderTitle(2300, {
                                scores: true,
                                rows: [{ name: 'ORBIT', score: 12345 }],
                                offset: 1.3,
                            }),
                        );
                    }
                if (JSON.stringify(state) !== before)
                    throw Error('Selecting Split modes mutated gameplay');
                for (const [left, right] of [
                    ['c64', 'cpc'],
                    ['gameboy', 'gameboy-color'],
                ])
                    for (let screenIndex = 0; screenIndex < 125; screenIndex++) {
                        const sample = createState(world, { screenIndex }),
                            snapshot = JSON.stringify(sample);
                        renderers.forEach((renderer) => renderer.addEvents([], sample));
                        compare(left, right, (renderer) => renderer.render(sample, 0, 0));
                        if (JSON.stringify(sample) !== snapshot)
                            throw Error('Split advanced the model');
                    }
                for (const [left, right] of [
                    ['retro', 'remastered'],
                    ['c64', 'cpc'],
                    ['gameboy', 'gameboy-color'],
                ])
                    for (const status of ['bonus', 'over', 'won'] as const) {
                        const sample = createState(world);
                        sample.status = status;
                        sample.bonus = { cursor: 3, total: 12345 } as StageBonus;
                        renderers.forEach((renderer) => renderer.addEvents([], sample));
                        compare(left, right, (renderer) =>
                            renderer.render(sample, 0, 0, {
                                nameEntry: status === 'won',
                                playerName: 'ORBIT',
                            }),
                        );
                    }
                const bare = createRenderer(document.createElement('canvas'), base);
                bare.setSplitModes('c64', 'cpc');
                if (
                    JSON.stringify(bare.splitModes) !==
                    JSON.stringify({ left: 'retro', right: 'remastered' })
                )
                    throw Error('Unavailable pair did not fall back');
                bare.setSplitModes('split', 'unknown');
                if (bare.splitModes.left !== 'retro' || bare.splitModes.right !== 'remastered')
                    throw Error('Recursive/invalid Split mode accepted');
                bare.destroy();
                renderers.forEach((renderer) => renderer.destroy());
                return { checked, pairs: modes.length ** 2 };
            },
            name === 'WebKit' ? 1 : 0,
        );
        assert.equal(result.pairs, 36);
        assert.ok(result.checked >= 511);
        console.log(
            `PASS: ${name} ${result.pairs} ordered Split pairs / ${result.checked} exact crops, FLASH isolation, 125maps for C64/CPC and GB/Color, effects/menus/pause/finale and fallbacks.`,
        );
    } finally {
        await page.close();
    }
}
