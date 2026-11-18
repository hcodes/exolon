import { serveReferenceModules } from './reference-mode.ts';
import { openGame } from './navigation.ts';
import assert from 'node:assert/strict';
import type { Browser } from 'playwright';
import type { GameState, ScreenObject, World } from '../../src/types/game.ts';
import type { Graphics, NativeGraphics, CpcGraphics } from '../../src/types/graphics.ts';

// Removing the foreground clip must fail this check: a buried pump may not
// change even one floor pixel, while its exposed part must remain visible.
export async function checkRemasteredMachinery(session: Browser, name: string) {
    const page = await session.newPage();
    await serveReferenceModules(page);
    try {
        await openGame(page, 'http://127.0.0.1:8091/');
        const result = await page.evaluate(
            async (tolerance) => {
                const [
                    { drawRemasteredScene },
                    { createStaticScene, createRenderer },
                    { createState, step },
                    world,
                    graphics,
                    { drawRemasteredMachinery },
                    c64,
                    cpc,
                ] = await Promise.all([
                    import(new URL('./view/remastered-scene.js', document.baseURI).href) as Promise<
                        typeof import('../../src/view/remastered-scene.ts')
                    >,
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
                    import(
                        new URL('./view/remastered-machinery.js', document.baseURI).href
                    ) as Promise<typeof import('../../src/view/remastered-machinery.ts')>,
                    fetch('./assets/graphics/c64/c64-graphics.json').then(
                        (r) => r.json() as Promise<NativeGraphics>,
                    ),
                    fetch('./assets/graphics/amstrad-cpc/cpc-graphics.json').then(
                        (r) => r.json() as Promise<CpcGraphics>,
                    ),
                ]);
                const canvas = document.createElement('canvas');
                canvas.width = 1024;
                canvas.height = 704;
                const c = canvas.getContext('2d')!;
                c.scale(4, 4);
                const render = (state: GameState) => {
                    drawRemasteredScene(c, state, graphics, 0);
                    return c.getImageData(0, 0, 1024, 704).data.slice();
                };
                let pumps = 0,
                    frames = 0;
                for (let screenIndex = 0; screenIndex < world.screens.length; screenIndex++) {
                    const state = createState(world, { screenIndex });
                    for (const pump of state.objects.filter((object) => object.type === 10)) {
                        pumps++;
                        state.objects = [];
                        const baseline = render(state),
                            allowed = createStaticScene(state, graphics).allowed;
                        for (const yOffset of [0, -1, -2, -3, -4]) {
                            state.objects = [{ ...pump, active: true, yOffset }];
                            const before = JSON.stringify(state),
                                pixels = render(state);
                            if (JSON.stringify(state) !== before)
                                throw Error('Rendering mutated the simulation');
                            let changed = 0;
                            for (let offset = 0; offset < pixels.length; offset += 4) {
                                // WebKit can round an unchanged gradient by one
                                // channel level after switching rasterization paths.
                                if (
                                    [0, 1, 2].every(
                                        (channel) =>
                                            Math.abs(
                                                pixels[offset + channel] -
                                                    baseline[offset + channel],
                                            ) <= tolerance,
                                    )
                                )
                                    continue;
                                const x = Math.floor(((offset / 4) % 1024) / 4),
                                    y = Math.floor(offset / 4 / 1024 / 4);
                                if (!allowed[(y >> 3) * 32 + (x >> 3)]) {
                                    throw Error(
                                        `Screen ${screenIndex + 1}, pump ${pump.id}, offset ${yOffset}: pump draws over foreground at ${x},${y}`,
                                    );
                                }
                                changed++;
                            }
                            if (yOffset === 0 && changed)
                                throw Error('A fully lowered pump remains visible');
                            if (yOffset === -4 && !changed)
                                throw Error('A raised pump disappeared');
                            frames++;
                        }
                    }
                }
                const actorCanvas = document.createElement('canvas'),
                    renderer = createRenderer(actorCanvas, graphics);
                renderer.setGraphicsMode('remastered');
                const rgba = () =>
                    actorCanvas.getContext('2d')!.getImageData(0, 0, 1024, 768).data.slice();
                let chambers = 0,
                    occlusionFrames = 0;
                for (let screenIndex = 0; screenIndex < world.screens.length; screenIndex++) {
                    const state = createState(world, { screenIndex });
                    for (const gate of state.objects.filter((object) => object.type === 12)) {
                        chambers++;
                        const x = (gate.x - 1) * 8,
                            y = gate.y * 8;
                        state.enemies = [];
                        state.spheres = [];
                        state.rockets = [];
                        state.bullets = [];
                        state.enemyBullets = [];
                        for (const armored of [false, true])
                            for (const direction of [-1, 1]) {
                                const inside = {
                                    ...state,
                                    exoskeleton: armored,
                                    player: {
                                        ...state.player,
                                        x: (x + 8) / 2,
                                        y: y + 8,
                                        direction,
                                        jump: -1,
                                        falling: false,
                                    },
                                };
                                const snapshot = JSON.stringify(inside);
                                renderer.destroy();
                                renderer.render(
                                    { ...inside, player: { ...inside.player, x: -1000 } },
                                    0,
                                    0,
                                );
                                const background = rgba();
                                renderer.destroy();
                                renderer.render(inside, 0, 0);
                                const pixels = rgba();
                                let visible = 0;
                                for (let py = y + 14; py < y + 34; py++)
                                    for (let px = x + 9; px < x + 31; px++) {
                                        const offset = (py * 4 * 1024 + px * 4) * 4;
                                        const different = [0, 1, 2].some(
                                            (channel) =>
                                                Math.abs(
                                                    pixels[offset + channel] -
                                                        background[offset + channel],
                                                ) > tolerance,
                                        );
                                        if (px >= x + 18 && px < x + 22 && different)
                                            throw Error(
                                                `Screen ${screenIndex + 1}: astronaut draws over the purple chamber post at ${px},${py}`,
                                            );
                                        if ((px < x + 16 || px >= x + 24) && different) visible++;
                                    }
                                if (!visible)
                                    throw Error('Open chamber sides hide the whole astronaut');
                                if (JSON.stringify(inside) !== snapshot)
                                    throw Error('Chamber rendering changed the model');
                                occlusionFrames++;
                            }
                    }
                }
                renderer.destroy();
                // The foreground support used to paint over its animated lamps.
                // Check final renderer pixels, including a hero behind the support.
                let lamps = 0;
                const lampCanvas = document.createElement('canvas'),
                    lampRenderer = createRenderer(lampCanvas, graphics);
                lampRenderer.setGraphicsMode('remastered');
                for (let screenIndex = 0; screenIndex < world.screens.length; screenIndex++) {
                    const source = createState(world, { screenIndex });
                    const fixtures = source.objects.filter(
                        (object) => object.type === 4 && object.active,
                    );
                    if (!fixtures.length) continue;
                    const sample = (state: GameState, lamp: ScreenObject) => {
                        lampRenderer.destroy();
                        lampRenderer.render(state, 0, 0);
                        return [
                            ...lampCanvas
                                .getContext('2d')!
                                .getImageData((lamp.x * 8 + 4) * 4, (lamp.y * 8 + 3.3) * 4, 1, 1)
                                .data,
                        ];
                    };
                    const scene = {
                        ...source,
                        enemies: [],
                        spheres: [],
                        rockets: [],
                        bullets: [],
                        enemyBullets: [],
                        player: { ...source.player, x: -1000 },
                    };
                    for (const lamp of fixtures) {
                        const off = sample(
                            { ...scene, objects: scene.objects.filter((o) => o.id !== lamp.id) },
                            lamp,
                        );
                        const on = sample({ ...scene, tick: 0 }, lamp),
                            later = sample({ ...scene, tick: 27 }, lamp),
                            next = sample({ ...scene, tick: 1 }, lamp);
                        const difference = (a: number[], b: number[]) =>
                            Math.max(
                                ...a.slice(0, 3).map((channel, i) => Math.abs(channel - b[i])),
                            );
                        if (difference(off, on) < 30)
                            throw Error(
                                `Screen ${screenIndex + 1}: foreground hides lamp ${JSON.stringify(lamp)} (${off} / ${on})`,
                            );
                        if (difference(on, later) < 30)
                            throw Error(
                                `Screen ${screenIndex + 1}: lamp ${lamp.id} no longer changes colour`,
                            );
                        if (difference(on, next) > 10)
                            throw Error(
                                `Screen ${screenIndex + 1}: lamp ${lamp.id} colour changes abruptly`,
                            );
                        lamps++;
                    }
                }
                lampRenderer.destroy();
                const launcherCanvas = document.createElement('canvas'),
                    launcherRenderer = createRenderer(launcherCanvas, { ...graphics, c64, cpc });
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = 1024;
                maskCanvas.height = 704;
                const maskContext = maskCanvas.getContext('2d')!;
                maskContext.scale(4, 4);
                let launchers = 0,
                    launcherFrames = 0,
                    columns = 0,
                    columnFrames = 0;
                for (let screenIndex = 0; screenIndex < world.screens.length; screenIndex++) {
                    const source = createState(world, { screenIndex });
                    for (const [instance, placement] of source.screen.placements!.entries()) {
                        if (![26, 32].includes(placement.block)) continue;
                        const launcher = placement.block === 26,
                            occurrence = launcher ? ++launchers : ++columns;
                        const tiles = source.screen.tiles.flatMap((tile, index) =>
                            tile?.instance === instance && tile.ink
                                ? [{ x: (index % 32) * 8, y: (index >> 5) * 8 }]
                                : [],
                        );
                        const x = Math.min(...tiles.map((t) => t.x)),
                            y = Math.min(...tiles.map((t) => t.y));
                        const w = Math.max(...tiles.map((t) => t.x + 8)) - x,
                            h = Math.max(...tiles.map((t) => t.y + 8)) - y;
                        const allowed = createStaticScene(source, graphics).allowed;
                        maskContext.clearRect(0, 0, 256, 176);
                        drawRemasteredMachinery(maskContext, {
                            block: placement.block,
                            x,
                            y,
                            w,
                            h,
                        });
                        const mask = maskContext.getImageData(0, 0, 1024, 704).data;
                        // Native modes use the source foreground cells. Remastered
                        // follows the opaque tube geometry, keeping its gaps open.
                        const modes =
                            occurrence === 1
                                ? ['retro', 'c64', 'cpc', 'gameboy', 'gameboy-color', 'remastered']
                                : ['remastered'];
                        for (const mode of modes)
                            for (const armored of [false, true])
                                for (const direction of [-1, 1]) {
                                    launcherRenderer.setGraphicsMode(mode);
                                    const inside = {
                                        ...source,
                                        enemies: [],
                                        spheres: [],
                                        rockets: [],
                                        bullets: [],
                                        enemyBullets: [],
                                        exoskeleton: armored,
                                        player: {
                                            ...source.player,
                                            x: (x + 4) / 2,
                                            y: launcher ? y - 12 : y + h - 32,
                                            direction,
                                            jump: -1,
                                            falling: false,
                                        },
                                    };
                                    const before = JSON.stringify(inside);
                                    const draw = (s: GameState) => {
                                        launcherRenderer.destroy();
                                        launcherRenderer.render(s, 0, 0);
                                        return launcherCanvas
                                            .getContext('2d')!
                                            .getImageData(
                                                0,
                                                0,
                                                launcherCanvas.width,
                                                launcherCanvas.height,
                                            )
                                            .data.slice();
                                    };
                                    const baseline = draw({
                                            ...inside,
                                            player: { ...inside.player, x: -1000 },
                                        }),
                                        pixels = draw(inside),
                                        scale = mode === 'remastered' ? 4 : 1;
                                    let covered = 0,
                                        visible = 0;
                                    for (let py = y - 12; py < y + h; py++)
                                        for (let px = x; px < x + w; px++) {
                                            const offset =
                                                (py * scale * launcherCanvas.width + px * scale) *
                                                4;
                                            const differs = [0, 1, 2].some(
                                                (n) =>
                                                    Math.abs(
                                                        pixels[offset + n] - baseline[offset + n],
                                                    ) > tolerance,
                                            );
                                            const opaque =
                                                py >= y &&
                                                (mode === 'remastered'
                                                    ? mask[(py * 4 * 1024 + px * 4) * 4 + 3] >= 254
                                                    : !allowed[(py >> 3) * 32 + (px >> 3)]);
                                            if (opaque && differs)
                                                throw Error(
                                                    `Screen ${screenIndex + 1}, ${mode}: astronaut draws over ${launcher ? 'double launcher' : 'beacon column'} at ${px},${py}`,
                                                );
                                            if (opaque) covered++;
                                            if (py < y && differs) visible++;
                                        }
                                    // The column's upper beacon can also hide the head.
                                    if (!covered || (launcher && !visible))
                                        throw Error(
                                            'Foreground object must cover the body while keeping the exposed head visible',
                                        );
                                    const removed = {
                                        ...inside,
                                        destroyed: [...inside.destroyed, instance],
                                        objects: inside.objects.filter(
                                            (o) => o.instance !== instance,
                                        ),
                                    };
                                    const bare = draw({
                                            ...removed,
                                            player: { ...removed.player, x: -1000 },
                                        }),
                                        revealed = draw(removed);
                                    let revealedPixels = 0;
                                    for (let py = y; py < y + 20; py++)
                                        for (let px = x; px < x + 32; px++) {
                                            const offset =
                                                (py * scale * launcherCanvas.width + px * scale) *
                                                4;
                                            if (
                                                [0, 1, 2].some(
                                                    (n) =>
                                                        Math.abs(
                                                            revealed[offset + n] - bare[offset + n],
                                                        ) > tolerance,
                                                )
                                            )
                                                revealedPixels++;
                                        }
                                    if (!revealedPixels)
                                        throw Error(
                                            `Removed foreground object still hides the astronaut in ${mode}`,
                                        );
                                    if (JSON.stringify(inside) !== before)
                                        throw Error('Launcher rendering changed the model');
                                    if (launcher) launcherFrames++;
                                    else columnFrames++;
                                }
                    }
                }
                let portals = 0,
                    portalFrames = 0;
                for (let screenIndex = 0; screenIndex < world.screens.length; screenIndex++) {
                    const source = createState(world, { screenIndex });
                    for (const [instance, placement] of source.screen.placements!.entries()) {
                        if (placement.block !== 17) continue;
                        portals++;
                        const tiles = source.screen.tiles.flatMap((tile, index) =>
                            tile?.instance === instance && tile.ink
                                ? [{ x: (index % 32) * 8, y: (index >> 5) * 8 }]
                                : [],
                        );
                        const x = Math.min(...tiles.map((t) => t.x)),
                            y = Math.min(...tiles.map((t) => t.y));
                        const w = Math.max(...tiles.map((t) => t.x + 8)) - x,
                            h = Math.max(...tiles.map((t) => t.y + 8)) - y;
                        const modes =
                            portals === 1
                                ? ['retro', 'c64', 'cpc', 'gameboy', 'gameboy-color', 'remastered']
                                : ['remastered'];
                        for (const mode of modes)
                            for (const armored of [false, true])
                                for (const direction of [-1, 1]) {
                                    launcherRenderer.setGraphicsMode(mode);
                                    const inside = {
                                        ...source,
                                        enemies: [],
                                        spheres: [],
                                        rockets: [],
                                        bullets: [],
                                        enemyBullets: [],
                                        exoskeleton: armored,
                                        player: {
                                            ...source.player,
                                            x: (x + (direction < 0 ? -4 : w - 20)) / 2,
                                            y: y + h - 36,
                                            direction,
                                            jump: -1,
                                            falling: false,
                                        },
                                    };
                                    const before = JSON.stringify(inside);
                                    const draw = (s: GameState) => {
                                        launcherRenderer.destroy();
                                        launcherRenderer.render(s, 0, 0);
                                        return launcherCanvas
                                            .getContext('2d')!
                                            .getImageData(
                                                0,
                                                0,
                                                launcherCanvas.width,
                                                launcherCanvas.height,
                                            )
                                            .data.slice();
                                    };
                                    const background = draw({
                                            ...inside,
                                            player: { ...inside.player, x: -1000 },
                                        }),
                                        pixels = draw(inside),
                                        scale = mode === 'remastered' ? 4 : 1;
                                    let visible = 0;
                                    for (let py = y + 8; py < y + h - 6; py++)
                                        for (let px = x + 2; px < x + w - 2; px++) {
                                            const offset =
                                                (py * scale * launcherCanvas.width + px * scale) *
                                                4;
                                            const differs = [0, 1, 2].some(
                                                (n) =>
                                                    Math.abs(
                                                        pixels[offset + n] - background[offset + n],
                                                    ) > tolerance,
                                            );
                                            if ((px < x + 5 || px >= x + w - 5) && differs)
                                                throw Error(
                                                    `Screen ${screenIndex + 1}, ${mode}: astronaut draws over teleport portal post at ${px},${py}`,
                                                );
                                            if (px >= x + 8 && px < x + w - 8 && differs) visible++;
                                        }
                                    if (!visible)
                                        throw Error(
                                            `Teleport portal opening hides the entire astronaut in ${mode}`,
                                        );
                                    if (JSON.stringify(inside) !== before)
                                        throw Error('Portal rendering changed the model');
                                    portalFrames++;
                                }
                    }
                }
                launcherRenderer.destroy();
                let state = createState(world, { screenIndex: 9 });
                state.objects = state.objects.filter((object) => object.type === 12);
                Object.assign(state.player, { x: 76, y: 112, jump: -1, falling: false });
                for (let i = 0; i < 20; i++) state = step(state, { right: true }).state;
                if (state.player.x !== 76 || state.player.y !== 112)
                    throw Error('Ground-level hero walks through the raised chamber base');
                state = step(state, { right: true, jump: true }).state;
                for (let i = 0; i < 45; i++)
                    state = step(state, { right: state.player.x < 92 }).state;
                if (state.player.x !== 92 || state.player.y !== 96)
                    throw Error('Hero cannot hop onto the 16px raised chamber platform');
                state = step(state, { jump: true }).state;
                if (!state.exoskeleton) throw Error('Chamber does not change suit/weapons');
                for (let i = 0; i < 3; i++) state = step(state, { jump: true }).state;
                if (!state.exoskeleton) throw Error('Held jump repeats the chamber toggle');
                state = step(state, {}).state;
                state = step(state, { jump: true }).state;
                if (state.exoskeleton) throw Error('Chamber cannot restore the normal suit');
                return {
                    pumps,
                    frames,
                    chambers,
                    occlusionFrames,
                    lamps,
                    launchers,
                    launcherFrames,
                    columns,
                    columnFrames,
                    portals,
                    portalFrames,
                };
            },
            name === 'WebKit' ? 1 : 0,
        );
        assert.ok(result.pumps >= 10, 'Check the actual campaign pump placements');
        assert.equal(result.frames, result.pumps * 5);
        assert.equal(result.chambers, 5);
        assert.equal(result.occlusionFrames, 20);
        assert.equal(result.launchers, 19);
        assert.equal(result.launcherFrames, 96);
        assert.equal(result.columns, 13);
        assert.equal(result.columnFrames, 72);
        assert.equal(result.portals, 70);
        assert.equal(result.portalFrames, 300);
        assert.ok(result.lamps >= 6);
        console.log(
            `PASS: ${name} ${result.lamps} lamps visible after foreground drawing, with smooth colour changes.`,
        );
        console.log(
            `PASS: ${name} ${result.pumps} retracting blocks, ${result.frames} raised/lowered frames, source foreground masks and unchanged simulation.`,
        );
        console.log(
            `PASS: ${name} ${result.chambers} suit chambers / ${result.occlusionFrames} foreground poses, raised platform hop and suit/weapon toggles.`,
        );
        console.log(
            `PASS: ${name} ${result.launchers} double launchers / ${result.launcherFrames} foreground poses across all six graphics modes, armor/directions and destruction.`,
        );
        console.log(
            `PASS: ${name} ${result.columns} beacon columns / ${result.columnFrames} foreground poses across all six graphics modes, armor and directions.`,
        );
        console.log(
            `PASS: ${name} ${result.portals} teleport portals / ${result.portalFrames} foreground poses across all six graphics modes, opaque posts and visible openings.`,
        );
    } finally {
        await page.close();
    }
}
