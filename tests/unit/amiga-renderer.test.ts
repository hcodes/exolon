import { createAmigaGameStar } from '../../src/games/amiga/view/game-stars.ts';
import { drawAmigaStars } from '../../src/games/amiga/view/renderer.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
    composeAmigaScene,
    createAmigaRenderer,
    blitAmigaShape,
    amigaRgba,
} from '../../src/games/amiga/view/renderer.ts';
import { createAmigaState, stepAmiga } from '../../src/games/amiga/model/index.ts';
import type { AmigaGraphics } from '../../src/assets/graphics/amiga/types.ts';
import type { AmigaWorld } from '../../src/games/amiga/data/types.ts';
import { decodePng } from '../../tools/graphics/png.mjs';
const graphics = JSON.parse(
    await readFile(
        new URL('../../src/assets/graphics/amiga/resources.json', import.meta.url),
        'utf8',
    ),
) as AmigaGraphics;
const world = JSON.parse(
    await readFile(new URL('../../src/games/amiga/data/world.json', import.meta.url), 'utf8'),
) as AmigaWorld;

test('Amiga native transparent blits preserve background and clip each edge', () => {
    const pixels = new Uint8Array(64000).fill(4);
    blitAmigaShape(pixels, [0, 2, 3, 0], 2, 2, -1, 0, true);
    assert.equal(pixels[0], 2);
    assert.equal(pixels[320], 4);
    assert.equal(pixels[1], 4);
    blitAmigaShape(pixels, [0, 2, 3, 0], 2, 2, 319, 199, false);
    assert.equal(pixels.at(-1), 0);
    assert.equal(pixels[0], 2);
});

test('Amiga full native background matches independently extracted frames across five stages', async () => {
    for (const index of [0, 24, 25, 49, 50, 74, 75, 99, 100, 124]) {
        const state = createAmigaState(world, { screenIndex: index });
        state.entities = [];
        state.tick = 1;
        state.player.invulnerableTicks = 1;
        const before = JSON.stringify(state);
        const pixels = composeAmigaScene(state, graphics, world, { stars: false });
        const rgb = amigaRgba(pixels, graphics.stagePalettes[Math.floor(index / 25)]);
        const reference = decodePng(
            await readFile(
                new URL(
                    `../../originals/images/amiga/screen-${String(index).padStart(3, '0')}.png`,
                    import.meta.url,
                ),
            ),
        );
        if (index % 25 === 24) {
            const frame = graphics.resources['exit-gate'].frames[1];
            const palette = graphics.stagePalettes[Math.floor(index / 25)];
            for (let y = 0; y < 64; y++)
                for (let x = 0; x < 16; x++)
                    reference.rgba.set(
                        [...palette[frame[y * 16 + x]], 255],
                        ((y + 104) * 320 + x + 200) * 4,
                    );
        }
        assert.deepEqual(
            Array.from(rgb.slice(0, 184 * 320 * 4)),
            Array.from(reference.rgba.slice(0, 184 * 320 * 4)),
            `native screen ${index}`,
        );
        assert.equal(JSON.stringify(state), before, 'Drawing cannot advance simulation');
    }
});

test('Amiga foreground redraws original 1..128 tiles over the player', () => {
    const state = createAmigaState(world);
    state.entities = [];
    state.player.x = 80;
    state.player.y = 80;
    state.tiles.fill(0);
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    const player = graphics.resources.player.frames[0];
    const first = player.findIndex((pixel) => pixel !== 0);
    const x = 80 + (first % 32),
        y = 40 + Math.floor(first / 32);
    const tile = Math.floor(y / 8) * 40 + Math.floor(x / 8);
    const target = y * 320 + x;
    assert.equal(composeAmigaScene(state, graphics, bare)[target], player[first]);
    const source = {
        ...graphics,
        tilesets: graphics.tilesets.map((set) =>
            set.map((pixels, i) => (i === 50 ? Array(64).fill(2) : pixels)),
        ),
    };
    state.tiles[tile] = 50;
    assert.equal(composeAmigaScene(state, source, bare)[target], 2);
});

test('Amiga procedural stars stay within the source playfield and preserve occupied pixels', async () => {
    const { drawAmigaStars } = await import('../../src/games/amiga/view/renderer.ts');
    const first = new Uint8Array(64000),
        second = new Uint8Array(64000);
    drawAmigaStars(first, 41);
    drawAmigaStars(second, 41);
    assert.deepEqual(first, second);
    assert.ok(first.filter(Boolean).length >= 90);
    assert.equal(first.slice(176 * 320).some(Boolean), false);
    assert.ok(first.every((color) => color >= 0 && color < 16));
    second.fill(15);
    drawAmigaStars(second, 41);
    assert.ok(second.every((color) => color === 15));
});

test('Amiga idle teleport chambers have no repeating energy overlay', () => {
    const state = createAmigaState(world, { screenIndex: 5 });
    state.tick = 1;
    state.player.invulnerableTicks = 1;
    state.entities = state.entities.filter((entity) => entity.kind === 'teleport');
    assert.equal(state.entities.length, 2);
    const withoutEffect = composeAmigaScene({ ...state, entities: [] }, graphics, world);
    assert.deepEqual(composeAmigaScene(state, graphics, world), withoutEffect);
});

test('Amiga active teleport energy uses its source frame inside the chamber', () => {
    const state = createAmigaState(world, { screenIndex: 5 });
    state.tick = 1;
    state.player.invulnerableTicks = 1;
    state.tiles.fill(0);
    const pad = state.entities.find((entity) => entity.kind === 'teleport')!;
    pad.x = 72;
    pad.y = 120;
    state.entities = [pad];
    state.teleportPhase = 7;
    state.teleportFrame = 6;
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    const expected = composeAmigaScene({ ...state, entities: [] }, graphics, bare, {
        stars: false,
    });
    // $d40c shifts stored pad X by-16 and Y by+16; $be54 aligns X down to16.
    blitAmigaShape(expected, graphics.resources.teleport.frames[6], 32, 32, 48, 136);
    assert.deepEqual(composeAmigaScene(state, graphics, bare, { stars: false }), expected);
});

test('Amiga launcher upper frames share native word alignment with the surviving base', () => {
    for (const column of [10, 11]) {
        const tiles = Array(920).fill(0);
        tiles[12 * 40 + column] = 0xfb;
        const sourceX = (column + 1) * 8;
        const displayX = column === 10 ? 80 : 96;
        const map: AmigaWorld = {
            ...world,
            screens: [
                {
                    ...world.screens[0],
                    tiles,
                    static: [
                        {
                            address: 0x168d0,
                            x: displayX,
                            y: 96,
                            width: 32,
                            height: 48,
                            transparent: true,
                            resource: 'launcher',
                        },
                    ],
                },
            ],
        };
        const state = createAmigaState(map);
        state.tick = 1;
        state.player.invulnerableTicks = 1;
        state.entities = state.entities.filter((entity) => entity.kind === 'laser');
        const launcher = state.entities[0];
        assert.equal(launcher.x, sourceX, 'logical source coordinates remain unrounded');
        assert.equal(launcher.y, 64);
        for (let frame = 0; frame < 4; frame++) {
            launcher.frame = frame;
            const expected = composeAmigaScene({ ...state, entities: [] }, graphics, map, {
                stars: false,
            });
            blitAmigaShape(
                expected,
                graphics.resources['laser-animation'].frames[frame],
                32,
                32,
                displayX,
                64,
            );
            assert.deepEqual(
                composeAmigaScene(state, graphics, map, { stars: false }),
                expected,
                `column${column}, frame${frame}: $a854 aligns upper sprite like $d362 base`,
            );
        }
    }
});

test('Amiga menus match original full frames with title stars and Hall of Fame pipes', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-score-scroll.json', import.meta.url), 'utf8'),
    ) as {
        logoRgbaSha256: string;
        rgbaFrames: Record<string, string>;
        fullRgbaFrames: Record<string, string>;
        menuRgbaFrames: Record<string, string>;
    };
    let displayed = new Uint8ClampedArray(320 * 200 * 4);
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            imageSmoothingEnabled: false,
            createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
            }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
                displayed = new Uint8ClampedArray(image.data);
            },
        }),
    } as unknown as HTMLCanvasElement;
    const renderer = createAmigaRenderer(canvas, graphics, world);
    const state = createAmigaState(world);
    const cropHash = (x: number, y: number, width: number, height: number) => {
        const bytes = new Uint8Array(width * height * 4);
        for (let row = 0; row < height; row++)
            bytes.set(
                displayed.subarray(((y + row) * 320 + x) * 4, ((y + row) * 320 + x + width) * 4),
                row * width * 4,
            );
        return createHash('sha256').update(bytes).digest('hex');
    };
    renderer.render(state, 0, { page: 'scores' });
    assert.equal(cropHash(80, 8, 176, 40), reference.logoRgbaSha256, 'source $8b68 logo at80,8');
    for (const [frame, hash] of Object.entries(reference.rgbaFrames)) {
        renderer.render(state, Number(frame) * 80, { page: 'scores' });
        assert.equal(cropHash(80, 54, 160, 138), hash, `original $8c62 scroll frame${frame}`);
        assert.equal(
            cropHash(0, 0, 320, 200),
            reference.fullRgbaFrames[frame],
            `full original Hall of Fame frame${frame}, including side pipes`,
        );
    }
    renderer.render(state, 20000, { page: 'title' });
    for (const [frame, hash] of Object.entries(reference.menuRgbaFrames)) {
        renderer.render(state, 20000 + Number(frame) * 80, { page: 'title' });
        assert.equal(cropHash(0, 0, 320, 200), hash, `original $96f0 title stars frame${frame}`);
    }
    renderer.render(state, 30000, { page: 'scores' });
    assert.equal(
        cropHash(80, 54, 160, 138),
        reference.rgbaFrames['0'],
        're-entry starts with an empty scroll window',
    );
    renderer.render(state, 40000, { page: 'title' });
    assert.equal(
        cropHash(0, 0, 320, 200),
        reference.menuRgbaFrames['0'],
        'title re-entry clears previous star animation',
    );
    renderer.render(state, 40240, { page: 'title' });
    assert.equal(
        cropHash(0, 0, 320, 200),
        reference.menuRgbaFrames['3'],
        'skipped RAFs preserve star timing',
    );
    renderer.render(state, 40240, { page: 'title' });
    assert.equal(
        cropHash(0, 0, 320, 200),
        reference.menuRgbaFrames['3'],
        'repainting does not advance stars',
    );
});

test('Amiga gameplay stars match the original random eight-phase overlay', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-game-stars.json', import.meta.url), 'utf8'),
    ) as { frames: Record<string, string> };
    const state = createAmigaState(world);
    state.tiles.fill(0);
    state.entities = [];
    state.player.y = -100;
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    const before = JSON.stringify(state);
    for (const [tick, hash] of Object.entries(reference.frames)) {
        const pixels = composeAmigaScene({ ...state, tick: Number(tick) }, graphics, bare);
        assert.equal(
            createHash('sha256')
                .update(pixels.subarray(0, 184 * 320))
                .digest('hex'),
            hash,
            `original $c18e gameplay-star tick${tick}`,
        );
    }
    assert.equal(
        JSON.stringify(state),
        before,
        'star presentation does not consume gameplay RNG or ticks',
    );
});

test('Amiga cached gameplay sparkle preserves occupied pixels and freezes at the same tick', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-game-stars.json', import.meta.url), 'utf8'),
    ) as { maskedFrames: Record<string, string> };
    const base = new Uint8Array(64000);
    drawAmigaStars(base, 0);
    for (let index = 0; index < 184 * 320; index++)
        if (index % 29 === 0) base[index] = 1 + (index % 15);
    base.fill(15, 184 * 320);
    const star = createAmigaGameStar();
    const check = (tick: number) => {
        const pixels = base.slice();
        star.draw(pixels, graphics, 0, tick);
        assert.equal(
            createHash('sha256')
                .update(pixels.subarray(0, 184 * 320))
                .digest('hex'),
            reference.maskedFrames[tick],
            `native occupied-pixel mask at tick${tick}`,
        );
        assert.ok(
            pixels.subarray(184 * 320).every((ink) => ink === 15),
            'sparkles never modify the HUD',
        );
    };
    for (const tick of [0, 7, 7, 8, 9, 10, 11, 16, 24, 64]) check(tick);
    check(0);
    check(7);
    star.draw(base.slice(), graphics, 1, 7);
    check(7);
});

test('Amiga heavy shot and flying fragments use the original source blitters', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-projectiles.json', import.meta.url), 'utf8'),
    ) as { rocketArt: Record<string, string>; debrisArt: string[] };
    const state = createAmigaState(world);
    state.tiles.fill(0);
    state.player.y = -100;
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    const hash = (pixels: Uint8Array, width: number, height: number) => {
        const crop = new Uint8Array(width * height);
        for (let row = 0; row < height; row++)
            crop.set(
                pixels.subarray((80 + row) * 320 + 96, (80 + row) * 320 + 96 + width),
                row * width,
            );
        return createHash('sha256').update(crop).digest('hex');
    };
    for (const [direction, dx] of [
        ['right', 1],
        ['left', -1],
    ] as const) {
        state.entities = [
            {
                id: 900,
                kind: 'grenade',
                x: 96,
                y: 80,
                width: 14,
                height: 6,
                frame: 0,
                phase: 0,
                type: 0,
                alive: true,
                dx,
                dy: 0,
            },
        ];
        assert.equal(
            hash(composeAmigaScene(state, graphics, bare, { stars: false }), 16, 6),
            reference.rocketArt[direction],
            `original $c170/$c17a rocket ${direction}`,
        );
    }
    for (let type = 0; type < 4; type++) {
        state.entities = [
            {
                id: 900,
                kind: 'debris',
                x: 96,
                y: 80,
                width: 32,
                height: 9,
                frame: 0,
                phase: 0,
                type,
                alive: true,
                dx: 0,
                dy: 0,
            },
        ];
        assert.equal(
            hash(composeAmigaScene(state, graphics, bare, { stars: false }), 32, 9),
            reference.debrisArt[type],
            `original $d5d4 fragment color variant${type}`,
        );
    }
});

test('Amiga Game Over has the original opaque blue window over the stage scene', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-score-scroll.json', import.meta.url), 'utf8'),
    ) as { gameOver: { rgbaByStage: string[] } };
    let displayed = new Uint8ClampedArray(64000 * 4);
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            imageSmoothingEnabled: false,
            createImageData: () => ({ data: new Uint8ClampedArray(64000 * 4) }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
                displayed = image.data.slice();
            },
        }),
    } as unknown as HTMLCanvasElement;
    const renderer = createAmigaRenderer(canvas, graphics, world);
    for (let stage = 0; stage < 5; stage++) {
        const state = createAmigaState(world, { screenIndex: stage * 25 });
        state.status = 'over';
        state.lives = 0;
        const backdrop = amigaRgba(
            composeAmigaScene(state, graphics, world),
            graphics.stagePalettes[stage],
        );
        renderer.render(state);
        const window = new Uint8Array(128 * 48 * 4);
        for (let y = 0; y < 200; y++)
            for (let x = 0; x < 320; x++) {
                const offset = (y * 320 + x) * 4;
                if (x >= 96 && x < 224 && y >= 72 && y < 120)
                    window.set(
                        displayed.subarray(offset, offset + 4),
                        ((y - 72) * 128 + x - 96) * 4,
                    );
                else
                    assert.deepEqual(
                        displayed.subarray(offset, offset + 4),
                        backdrop.subarray(offset, offset + 4),
                        'Game Over retains the surrounding game scene and stage palette',
                    );
            }
        assert.equal(
            createHash('sha256').update(window).digest('hex'),
            reference.gameOver.rgbaByStage[stage],
            `original $88fe/$8ed8 Game Over stage${stage}`,
        );
    }
});

test('Amiga pistons reveal the original late-loaded sprite and erase their opaque black pixels', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-pistons.json', import.meta.url), 'utf8'),
    ) as { framesByHeight: Record<string, string> };
    const state = createAmigaState(world);
    state.player.y = -100;
    state.tiles.fill(0);
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    const filled = {
        ...graphics,
        tilesets: graphics.tilesets.map((tiles) => tiles.map(() => Array(64).fill(15) as number[])),
    };
    for (const [height, hash] of Object.entries(reference.framesByHeight)) {
        state.entities = [
            {
                id: 900,
                kind: 'spike',
                x: 96,
                y: 175 - Number(height),
                width: 32,
                height: Number(height),
                frame: Number(height),
                phase: 1,
                type: 0,
                dx: 0,
                dy: 0,
                alive: true,
            },
        ];
        const pixels = composeAmigaScene(state, filled, bare, { stars: false });
        const crop = new Uint8Array(32 * 49);
        for (let row = 0; row < 49; row++)
            crop.set(pixels.subarray((127 + row) * 320 + 96, (127 + row) * 320 + 128), row * 32);
        assert.equal(
            createHash('sha256').update(crop).digest('hex'),
            hash,
            `original $a3a6 piston height${height}`,
        );
        assert.ok(
            pixels.subarray(176 * 320, 184 * 320).every((ink) => ink === 15),
            'the lower piston remains below the floor',
        );
    }
});

test('Amiga menu epoch restarts the same page while preserving native canvas size', async () => {
    let displayed = new Uint8ClampedArray(320 * 200 * 4);
    const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({
            imageSmoothingEnabled: false,
            createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
            }),
            putImageData: (image: { data: Uint8ClampedArray }) => {
                displayed = new Uint8ClampedArray(image.data);
            },
        }),
    } as unknown as HTMLCanvasElement;
    const renderer = createAmigaRenderer(canvas, graphics, world);
    const state = createAmigaState(world);
    renderer.render(state, 0, { page: 'title', startedAt: 0 });
    const initial = createHash('sha256').update(displayed).digest('hex');
    renderer.render(state, 1280, { page: 'title', startedAt: 0 });
    assert.notEqual(createHash('sha256').update(displayed).digest('hex'), initial);
    canvas.width = 1280;
    canvas.height = 800;
    renderer.render(state, 5000, { page: 'title', startedAt: 5000 });
    assert.equal(createHash('sha256').update(displayed).digest('hex'), initial);
    assert.deepEqual([canvas.width, canvas.height], [320, 200]);
});

test('Amiga small impacts match all eight original frames and sixteen-pixel alignment', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-impacts.json', import.meta.url), 'utf8'),
    ) as {
        x: number;
        y: number;
        frames: { tick: number; sha256: string; active: boolean }[];
    };
    const state = createAmigaState(world);
    state.tiles.fill(0);
    state.tick = 1;
    state.player.invulnerableTicks = 1;
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    for (const frame of reference.frames) {
        state.entities = frame.active
            ? [
                  {
                      id: 999,
                      kind: 'explosion',
                      x: reference.x,
                      y: reference.y,
                      width: 32,
                      height: 8,
                      type: 1,
                      frame: frame.tick,
                      alive: true,
                      dx: 0,
                      dy: 0,
                      phase: 0,
                  },
              ]
            : [];
        const pixels = composeAmigaScene(state, graphics, bare, { stars: false });
        assert.equal(
            createHash('sha256')
                .update(pixels.subarray(0, 320 * 184))
                .digest('hex'),
            frame.sha256,
            `original small impact frame ${frame.tick}`,
        );
    }
});

test('Amiga rocket smoke matches original full-frame traces for both directions', async () => {
    const reference = JSON.parse(
        await readFile(new URL('../../research/amiga-rocket-trail.json', import.meta.url), 'utf8'),
    ) as {
        directions: Record<string, { tick: number; sha256: string }[]>;
    };
    const bare = { ...world, screens: world.screens.map((screen) => ({ ...screen, static: [] })) };
    for (const direction of [1, -1]) {
        let state = createAmigaState(world, { invulnerable: true });
        state.tiles.fill(0);
        state.entities = [
            {
                id: 999,
                kind: 'grenade',
                x: 96,
                y: 120,
                width: 14,
                height: 6,
                frame: 0,
                type: 0,
                alive: true,
                phase: 0,
                dx: direction,
                dy: 0,
            },
        ];
        for (const frame of reference.directions[String(direction)]) {
            state = stepAmiga(state, {}).state;
            const scene = {
                ...state,
                tick: 1,
                tiles: Array(920).fill(0),
                player: { ...state.player, deathTick: 15, invulnerableTicks: 1 },
                entities: state.entities.filter((entity) => entity.kind === 'rocket-trail'),
            };
            const pixels = composeAmigaScene(scene, graphics, bare, { stars: false });
            assert.equal(
                createHash('sha256')
                    .update(pixels.subarray(0, 320 * 184))
                    .digest('hex'),
                frame.sha256,
                `direction ${direction}, smoke tick ${frame.tick}`,
            );
        }
    }
});
