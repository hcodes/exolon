import { drawControlMenu } from './control-menu.ts';
import type { GraphicTile, Point } from '../types/graphics.ts';
import type { GameScreen, GameState } from '../types/game.ts';
import type {
    CpcGraphics,
    SpectrumScreen,
    NativeSurface,
    Particle,
    Piece,
    TitleOptions,
    SceneRenderer,
} from '../types/graphics.ts';
// Original Exolon CPC assets, adapted to the shared native JS simulation.
// Raffaele Cecco / Nick Jones / Hewson, 1987. See assets/graphics/amstrad-cpc/cpc-graphics-provenance.json.
import {
    createCpcSurface,
    createCpcLoadingSurface,
    blitCpcBitmap,
    toCpcRgba,
} from './cpc-bitmap.ts';
import { findTitleStarPositions, getTitleStars } from './title-stars.ts';

const PARTICLES = [3, 4, 5, 3, 5, 4, 5, 5, 5, 6];
// Shared-model debris motion, drawn with the original CPC particle bitmap.
const DELTA = [-4, -3, -2, 0, 0, 2, 3, 4];
const hash = (value: number) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
};

export function createCpcRenderer(
    canvas: HTMLCanvasElement,
    graphics: CpcGraphics,
    titleMask: SpectrumScreen,
): SceneRenderer {
    const context = canvas.getContext('2d')!,
        image = context.createImageData(256, 192);
    const titleBase = createCpcLoadingSurface(graphics.loading, titleMask);
    let cache: NativeSurface | null = null,
        cachedScreen: GameScreen | null = null,
        cachedKey = '',
        effects: Particle[] = [],
        pieces: Piece[] = [],
        previousTick = -1,
        previousScreen = -1;
    const menuStarPositions = new Map<string, Point[]>();
    function cell(surface: NativeSurface, tile: GraphicTile) {
        if (tile.x < 0 || tile.x >= 32 || tile.y < 0 || tile.y >= 24) return;
        blitCpcBitmap(surface, tile.bitmap, 8, 8, tile.x * 8, tile.y * 8, {
            foreground: false,
            transparent: false,
            clipBottom: 192,
        });
    }
    const cells = (surface: NativeSurface, tiles: GraphicTile[], dx = 0, dy = 0) => {
        for (const tile of tiles)
            cell(surface, { ...tile, x: (tile.x + dx) & 255, y: (tile.y + dy) & 255 });
    };
    function text(
        surface: NativeSurface,
        value: string,
        x: number,
        y: number,
        { offsetY = 0, clipTop = 0, clipBottom = 192 } = {},
    ) {
        for (const [index, char] of [...String(value).toUpperCase()].entries()) {
            const glyph = char.charCodeAt(0) - 32,
                bitmap = graphics.font.slice(Math.max(0, glyph) * 16, Math.max(0, glyph) * 16 + 16);
            const top = y * 8 + Math.trunc(offsetY);
            for (let row = 0; row < 8; row++)
                if (top + row >= clipTop && top + row < clipBottom) {
                    blitCpcBitmap(
                        surface,
                        bitmap.slice(row * 2, row * 2 + 2),
                        8,
                        1,
                        (x + index) * 8,
                        top + row,
                        { foreground: false, transparent: false, clipBottom },
                    );
                }
        }
    }
    function small(surface: NativeSurface, id: number, x: number, y: number, _color?: number) {
        blitCpcBitmap(surface, graphics.small.slice(id * 64, id * 64 + 64), 16, 16, x, y, {
            xor: true,
        });
    }
    function shifted(surface: NativeSurface, id: number, x: number, y: number, _color?: number) {
        const phase = (Math.floor(x / 2) & 1) * 24,
            start = id * 48 + phase;
        blitCpcBitmap(
            surface,
            graphics.shifted.slice(start, start + 24),
            12,
            8,
            Math.floor(x / 4) * 4,
            y,
            { foreground: false, xor: true },
        );
    }
    function background(state: GameState) {
        const destroyed = new Set<number | undefined>(state.destroyed || []);
        const inactive = new Set(
            (state.objects || [])
                .filter((object) => !object.active)
                .map((object) => object.instance),
        );
        const key = `${[...destroyed]}:${[...inactive]}`;
        if (cache && cachedScreen === state.screen && cachedKey === key) return cache;
        const surface = createCpcSurface(),
            occupied = new Uint8Array(768);
        for (const [instance, placement] of (state.screen.placements || []).entries()) {
            if (
                destroyed.has(instance) ||
                ([18, 19, 20].includes(placement.block) && inactive.has(instance))
            )
                continue;
            const native = graphics.blocks[placement.block]?.tiles || [];
            const tiles = native.length
                ? native
                : graphics.compatibilityBlocks[placement.block]?.tiles || [];
            cells(surface, tiles, placement.x, placement.y);
            for (const tile of tiles) {
                const x = (tile.x + placement.x) & 255,
                    y = (tile.y + placement.y) & 255;
                if (x < 32 && y < 22) occupied[y * 32 + x] = 1;
            }
        }
        state.screen.tiles.forEach((tile, index) => {
            if (
                tile &&
                tile.overlay === 0 &&
                !destroyed.has(tile.instance) &&
                !([18, 19, 20].includes(tile.block) && inactive.has(tile.instance))
            )
                surface.allowed[index] = 0;
        });
        let random = hash((state.screenIndex || 0) + 1);
        for (let y = 0; y < 22; y++)
            for (let attempt = 0; attempt < 3; attempt++) {
                random = hash(random + 1);
                const x = random & 31;
                if (occupied[y * 32 + x]) continue;
                random = hash(random + 1);
                const bitmap = graphics.star.slice(),
                    recipe = graphics.proceduralPixels.star;
                bitmap[recipe.row * 2 + recipe.byte] = random & recipe.randomMask;
                cell(surface, { x, y, bitmap });
            }
        cells(surface, graphics.screens.hud);
        cache = surface;
        cachedScreen = state.screen;
        cachedKey = key;
        return surface;
    }
    function animate(surface: NativeSurface, state: GameState) {
        for (const object of state.objects || []) {
            if ((state.destroyed || []).includes(object.instance!)) continue;
            const x = object.x,
                y = object.y,
                seed = hash(state.tick * 7919 + object.id + 1);
            if (!object.active) {
                if (object.type === 5)
                    for (let n = 0; n < 2; n++)
                        cell(surface, {
                            x: x + n,
                            y,
                            bitmap: graphics.mine.slice(
                                (state.tick & 1) * 32 + n * 16,
                                (state.tick & 1) * 32 + n * 16 + 16,
                            ),
                        });
                continue;
            }
            if (object.type === 2)
                for (let row = 0; row < 2; row++) {
                    const start = (state.tick % 3) * 32 + row * 16;
                    cell(surface, {
                        x,
                        y: y + 1 + row,
                        bitmap: graphics.torch.slice(start, start + 16),
                    });
                }
            else if (object.type === 3) {
                const frame = [0, 1, 2, 3, 4, 5, 6, 7, 0][object.phase - 1] ?? 0;
                for (let n = 0; n < 2; n++)
                    cell(surface, {
                        x: x + n,
                        y,
                        bitmap: graphics.turret.slice(
                            frame * 32 + n * 16,
                            frame * 32 + n * 16 + 16,
                        ),
                    });
            } else if (object.type === 10) {
                blitCpcBitmap(
                    surface,
                    graphics.player.slice(24 * 192, 25 * 192),
                    24,
                    32,
                    x * 8,
                    (y + (object.yOffset || 0)) * 8,
                    { xor: true },
                );
            } else if (object.type === 15) {
                const frame = 28 + (seed & 3);
                small(surface, frame, x * 8, y * 8);
                small(surface, frame + 1, x * 8 + 16, y * 8);
            } else if (object.type === 17)
                for (let row = 1; row <= object.length; row++) {
                    cell(surface, { x, y: y + row, bitmap: graphics.beam });
                }
        }
    }
    function actors(surface: NativeSurface, state: GameState) {
        const player = state.player,
            frame =
                (state.death || state.status === 'over' ? 11 : (player.sprite ?? 5)) +
                (state.exoskeleton ? 12 : 0);
        if (!state.invulnerable || !(state.tick & 2))
            blitCpcBitmap(
                surface,
                graphics.player.slice(frame * 192, frame * 192 + 192),
                24,
                32,
                player.x * 2,
                player.y,
                { mirror: player.direction < 0, xor: true },
            );
        for (const bullet of state.bullets) {
            const recipe = graphics.proceduralPixels.bullet,
                bitmap = bullet.x & 1 ? recipe.odd : recipe.even;
            blitCpcBitmap(
                surface,
                bitmap,
                bitmap.length * 4,
                1,
                Math.floor(bullet.x / 2) * 4,
                bullet.y,
                { foreground: false, xor: true },
            );
        }
        for (const bullet of state.enemyBullets) {
            const recipe = graphics.proceduralPixels.enemyBullet,
                bitmap = bullet.x & 1 ? recipe.odd : recipe.even;
            blitCpcBitmap(surface, bitmap, 4, 2, Math.floor(bullet.x / 2) * 4, bullet.y, {
                foreground: false,
                xor: true,
            });
        }
        if (state.grenade)
            shifted(surface, state.grenade.dx < 0 ? 1 : 0, state.grenade.x * 2, state.grenade.y, 7);
        for (const rocket of state.rockets) {
            if (rocket.kind === 'homing')
                small(surface, rocket.x < 70 ? 11 : 10, rocket.x * 2, rocket.y, 7);
            else shifted(surface, 8, rocket.x * 2, rocket.y, 7);
        }
        for (const sphere of state.spheres) shifted(surface, 7, sphere.x * 2, sphere.y, 2);
        for (const enemy of state.enemies)
            small(surface, enemy.sprite + ((enemy.phase + 3) & 3), enemy.x * 2, enemy.y);
        if (state.killer) small(surface, 36, state.killer.x * 2, state.killer.y, 1);
        for (const effect of effects) {
            const age = state.tick - effect.tick;
            if (age >= 0 && age < PARTICLES.length)
                shifted(surface, PARTICLES[age], effect.x, effect.y, effect.color);
        }
        for (const piece of pieces) {
            const age = state.tick - piece.tick,
                x = piece.x + age * piece.dx,
                y = piece.y + age * piece.dy;
            if (age >= 0 && age < 176 && x >= 0 && x < 256 && y >= 0 && y < 176)
                shifted(surface, 2, x, y);
        }
    }
    function present(surface: NativeSurface) {
        if (canvas.width !== 256 || canvas.height !== 192) {
            canvas.width = 256;
            canvas.height = 192;
        }
        context.imageSmoothingEnabled = false;
        toCpcRgba(surface, graphics.palette, image.data);
        context.putImageData(image, 0, 0);
    }
    function scores(surface: NativeSurface, { rows = [], offset = 0 }: TitleOptions = {}) {
        cells(surface, graphics.screens.scores);
        for (let y = 32; y < 192; y++) surface.pixels.fill(0, y * 256 + 64, y * 256 + 192);
        rows.forEach((row, index) =>
            text(
                surface,
                `${String(row.name).padEnd(8, ' ')}  ${String(row.score).padStart(6, '0')}`,
                8,
                4 + index * 2,
                { offsetY: -Math.floor(offset * 16), clipTop: 32, clipBottom: 192 },
            ),
        );
    }
    function menuStars(surface: NativeSurface, time: number, page: string) {
        if (!menuStarPositions.has(page)) {
            const positions = findTitleStarPositions({
                bits: surface.pixels,
                attributes: new Uint8Array(768),
            }).filter(
                ({ x, y }) =>
                    page === 'title' ||
                    (page === 'scores'
                        ? x + 16 <= 64 || x >= 192 || y + 16 <= 32
                        : y + 16 <= 136 || y >= 144 || x + 16 <= 56 || x >= 208),
            );
            menuStarPositions.set(page, positions);
        }
        for (const star of getTitleStars(time, menuStarPositions.get(page))) {
            blitCpcBitmap(
                surface,
                graphics.small.slice(star.frame * 64, star.frame * 64 + 64),
                16,
                16,
                star.x,
                star.y,
                { foreground: false, clipBottom: 192, xor: true },
            );
            if (page === 'title')
                for (let y = star.y; y < star.y + 16; y++)
                    for (let x = star.x; x < star.x + 16; x++) {
                        const pixel = y * 256 + x;
                        if (surface.pixels[pixel]) surface.pixels[pixel] = 11;
                    }
        }
    }
    return {
        observe(state, events) {
            if (!state) return;
            if (
                state.tick < previousTick ||
                state.screenIndex !== previousScreen ||
                events.some((event) =>
                    ['respawn', 'screen', 'screen-change', 'stage'].includes(event.type),
                )
            ) {
                effects = [];
                pieces = [];
            }
            if (state.tick === previousTick && state.screenIndex === previousScreen) return;
            previousTick = state.tick;
            previousScreen = state.screenIndex;
            effects = effects.filter((effect) => state.tick - effect.tick < 10);
            pieces = pieces.filter((piece) => {
                const age = state.tick - piece.tick,
                    x = piece.x + age * piece.dx,
                    y = piece.y + age * piece.dy;
                return age < 176 && x >= 0 && x < 256 && y >= 0 && y < 176;
            });
            const origins = new Set<string>();
            for (const event of events) {
                if (event.type === 'object-destroyed' && event.instance !== undefined) {
                    const placement = state.screen.placements?.[event.instance];
                    if (placement) {
                        const native = graphics.blocks[placement.block]?.tiles || [],
                            tiles = native.length
                                ? native
                                : graphics.compatibilityBlocks[placement.block]?.tiles || [];
                        for (const [index, tile] of tiles.entries()) {
                            const x = ((tile.x + placement.x) & 255) * 8,
                                y = ((tile.y + placement.y) & 255) * 8;
                            if (x >= 256 || y >= 176 || !tile.bitmap.some((byte) => byte)) continue;
                            for (let part = 0; part < 2 && pieces.length < 100; part++) {
                                let random = hash(
                                        state.tick * 127 + x * 31 + y + index * 2 + part + 1,
                                    ),
                                    dy = DELTA[(random >> 3) & 7] * 2;
                                const dx = DELTA[random & 7] * 2;
                                while (!dx && !dy) {
                                    random = hash(random + 1);
                                    dy = DELTA[random & 7] * 2;
                                }
                                pieces.push({ x, y, dx, dy, tick: state.tick, color: 1 });
                            }
                        }
                    }
                }
                if (
                    [
                        'explosion',
                        'enemy-destroyed',
                        'object-destroyed',
                        'mine',
                        'teleport',
                        'teleport-arrive',
                    ].includes(event.type)
                ) {
                    // Object destruction also emits an explosion; duplicate XOR sprites cancel.
                    const origin = `${event.x || 0}:${event.y || 0}`;
                    if (origins.has(origin)) continue;
                    origins.add(origin);
                    for (let n = 0; n < 4; n++)
                        effects.push({
                            x: (event.x || 0) + (n & 1) * 5,
                            y: (event.y || 0) + (n >> 1) * 4,
                            tick: state.tick,
                            color: 1,
                        });
                }
            }
            if (state.grenade && state.grenade.phase >= 19)
                effects.push({
                    x: state.grenade.x * 2 - state.grenade.dx * 8,
                    y: state.grenade.y,
                    tick: state.tick,
                    color: 7,
                });
        },
        render(
            state,
            _time = 0,
            _fraction = 0,
            { paused = false, nameEntry = false, playerName = '' } = {},
        ) {
            const surface = createCpcSurface();
            if (state.status === 'won' || nameEntry) {
                cells(surface, graphics.screens.logo);
                text(surface, 'EXOLON HALL OF FAME', 6, 9);
                text(surface, 'ENTER YOUR NAME', 8, 12);
                text(
                    surface,
                    String(playerName || '')
                        .toUpperCase()
                        .slice(0, 8)
                        .padEnd(8, '-'),
                    12,
                    15,
                );
                text(surface, `SCORE ${String(state.score).padStart(6, '0')}`, 9, 18);
                present(surface);
                return;
            }
            if (state.status === 'bonus') {
                cells(surface, graphics.screens.logo);
                text(surface, 'ZONE COMPLETE', 9, 6);
                text(
                    surface,
                    `LIVES    ${String(state.bonus?.lifePoints || 0).padStart(6, '0')}`,
                    6,
                    9,
                );
                text(
                    surface,
                    `BRAVERY  ${String(state.bonus?.braveryPoints || 0).padStart(6, '0')}`,
                    6,
                    11,
                );
                text(
                    surface,
                    `TOTAL    ${String(state.bonus?.total || 0).padStart(6, '0')}`,
                    6,
                    13,
                );
                for (let i = 0; i < 8; i++)
                    text(
                        surface,
                        `${i === (state.bonus?.cursor || 0) ? '>' : ' '}${String([0, 1000, 0, 3000, 0, 5000, 0, 7000][i]).padStart(4, '0')}`,
                        4 + (i % 4) * 6,
                        16 + (i >> 2) * 2,
                    );
                text(surface, 'PRESS FIRE TO STOP', 7, 21);
                present(surface);
                return;
            }
            const base = background(state);
            surface.pixels.set(base.pixels);
            surface.allowed.set(base.allowed);
            animate(surface, state);
            actors(surface, state);
            for (const [value, length, x] of [
                [state.ammo, 2, 1],
                [state.grenades, 2, 8],
                [state.score, 6, 14],
                [state.lives, 1, 23],
                [state.screenIndex + 1, 3, 28],
            ])
                text(surface, String(value).padStart(length, '0').slice(-length), x, 23);
            if (state.status === 'over') cells(surface, graphics.screens.gameOver);
            else if (paused) text(surface, 'PAUSED', 13, 10);
            present(surface);
        },
        renderTitle(time = 0, options = {}) {
            const surface = createCpcSurface();
            if (options.scores) scores(surface, options);
            else if (options.menu) {
                cells(surface, graphics.screens.menu);
            } else surface.pixels.set(titleBase.pixels);
            menuStars(surface, time, options.scores ? 'scores' : options.menu ? 'menu' : 'title');
            if (options.menu && !options.scores)
                drawControlMenu('cpc', options.controls, {
                    clear() {
                        surface.pixels.fill(0, 48 * 256, 168 * 256);
                    },
                    text: (value, x, row) => text(surface, value, x, row),
                    highlight() {
                        // CPC has no device selection highlight.
                    },
                });
            present(surface);
        },
        reset() {
            cache = null;
            cachedScreen = null;
            cachedKey = '';
            effects = [];
            pieces = [];
            previousTick = -1;
            previousScreen = -1;
        },
    };
}
