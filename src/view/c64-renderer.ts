import { drawControlMenu } from './control-menu.ts';
import type { GraphicTile, Point } from '../types/graphics.ts';
import type { GameScreen, GameState } from '../types/game.ts';
import type {
    NativeGraphics,
    SpectrumScreen,
    NativeSurface,
    Particle,
    Piece,
    TitleOptions,
    SceneRenderer,
} from '../types/graphics.ts';
// Original Exolon C64 assets, adapted to the shared native JS simulation.
// Nick Jones / Hewson, 1987. See assets/graphics/c64/c64-graphics-provenance.json.
import { createC64Surface, putC64Cell, blitC64Sprite, toC64Rgba } from './c64-bitmap.ts';
import { findTitleStarPositions, getTitleStars } from './title-stars.ts';

const COLORS = [0, 6, 2, 4, 5, 3, 7, 1];
const PARTICLES = [3, 4, 5, 3, 5, 4, 5, 5, 5, 6];
// Native $2786/$278e velocities, converted from two-pixel horizontal units.
const DEBRIS_DELTA = [-8, -6, -4, 0, 0, 4, 6, 8];
const hash = (value: number) => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
};

export function createC64Renderer(
    canvas: HTMLCanvasElement,
    graphics: NativeGraphics,
    titleScreen: SpectrumScreen,
): SceneRenderer {
    const context = canvas.getContext('2d')!,
        image = context.createImageData(256, 192);
    // Added browser splash: the original C64 retail release had no loading bitmap.
    // Keep the ZX planet composition and map its inks to the C64 palette.
    const titleBase = createC64Surface();
    for (let i = 0; i < titleBase.pixels.length; i++) {
        const attribute = titleScreen.attributes[(i >> 11) * 32 + ((i % 256) >> 3)];
        titleBase.pixels[i] = COLORS[titleScreen.bits[i] ? attribute & 7 : (attribute >> 3) & 7];
    }
    let cache: NativeSurface | null = null,
        cachedScreen: GameScreen | null = null,
        cachedKey = '',
        effects: Particle[] = [],
        pieces: Piece[] = [],
        previousTick = -1,
        previousScreen = -1;
    const menuStarPositions = new Map<string, Point[]>();
    const cells = (surface: NativeSurface, tiles: GraphicTile[], dx = 0, dy = 0) => {
        for (const tile of tiles)
            putC64Cell(surface, { ...tile, x: (tile.x + dx) & 255, y: (tile.y + dy) & 255 });
    };
    function text(
        surface: NativeSurface,
        value: string,
        x: number,
        y: number,
        { color = 0xc1, ramColor = 0, offsetY = 0, clipTop = 0, clipBottom = 192 } = {},
    ) {
        for (const [index, char] of [...String(value).toUpperCase()].entries()) {
            const glyph = char.charCodeAt(0) - 32,
                bitmap = graphics.font.slice(Math.max(0, glyph) * 8, Math.max(0, glyph) * 8 + 8);
            for (let row = 0; row < 8; row++)
                for (let column = 0; column < 8; column++) {
                    const px = (x + index) * 8 + column,
                        py = y * 8 + row + Math.trunc(offsetY);
                    if (px < 0 || px >= 256 || py < clipTop || py >= clipBottom) continue;
                    const bits = ((bitmap[row] || 0) >> (6 - (column >> 1) * 2)) & 3;
                    surface.pixels[py * 256 + px] = [
                        0,
                        (color >> 4) & 15,
                        color & 15,
                        ramColor & 15,
                    ][bits];
                }
        }
    }
    function small(surface: NativeSurface, id: number, x: number, y: number, color = 1) {
        blitC64Sprite(surface, graphics.small.slice(id * 32, id * 32 + 32), 16, 16, x, y, color, {
            multicolor: true,
        });
    }
    function shifted(surface: NativeSurface, id: number, x: number, y: number, color = 1) {
        const phase = (Math.floor(x / 2) & 3) * 16,
            start = id * 64 + phase;
        blitC64Sprite(
            surface,
            graphics.shifted.slice(start, start + 16),
            16,
            8,
            Math.floor(x / 8) * 8,
            y,
            color,
            { multicolor: true, foreground: false },
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
        const surface = createC64Surface(),
            occupied = new Uint8Array(768);
        for (const [instance, placement] of (state.screen.placements || []).entries()) {
            if (
                destroyed.has(instance) ||
                ([18, 19, 20].includes(placement.block) && inactive.has(instance))
            )
                continue;
            const tiles = graphics.blocks[placement.block]?.tiles || [];
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
        for (let y = 0; y < 176; y += 8)
            for (let attempt = 0; attempt < 3; attempt++) {
                random = hash(random + 1);
                const x = random & 255;
                if (!occupied[(y >> 3) * 32 + (x >> 3)])
                    surface.pixels[(y + ((random >> 8) & 7)) * 256 + x] =
                        COLORS[(random >> 12) & 7];
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
                        putC64Cell(surface, {
                            x: x + n,
                            y,
                            bitmap: graphics.mine.slice(
                                (state.tick & 1) * 16 + n * 8,
                                (state.tick & 1) * 16 + n * 8 + 8,
                            ),
                            color: 0xc7,
                            ramColor: 1,
                        });
                continue;
            }
            if (object.type === 2)
                for (let row = 0; row < 2; row++) {
                    const start = (state.tick % 3) * 16 + row * 8;
                    putC64Cell(surface, {
                        x,
                        y: y + 1 + row,
                        bitmap: graphics.torch.slice(start, start + 8),
                        color: 0x72,
                        ramColor: 1,
                    });
                }
            else if (object.type === 3) {
                const frame = [0, 1, 2, 3, 4, 5, 6, 7, 0][object.phase - 1] ?? 0;
                for (let n = 0; n < 2; n++)
                    putC64Cell(surface, {
                        x: x + n,
                        y,
                        bitmap: graphics.turret.slice(frame * 16 + n * 8, frame * 16 + n * 8 + 8),
                        color: 0x87,
                        ramColor: 1,
                    });
            } else if (object.type === 4) {
                surface.pixels[(y * 8 + 3) * 256 + x * 8 + 3] = COLORS[state.tick & 7];
            } else if (object.type === 10) {
                blitC64Sprite(
                    surface,
                    graphics.player.slice(24 * 96, 25 * 96),
                    24,
                    32,
                    x * 8,
                    (y + (object.yOffset || 0)) * 8,
                    5,
                );
            } else if (object.type === 15) {
                const frame = 28 + (seed & 3);
                small(surface, frame, x * 8, y * 8, COLORS[(seed >> 8) & 7]);
                small(surface, frame + 1, x * 8 + 16, y * 8, COLORS[(seed >> 8) & 7]);
            } else if (object.type === 17)
                for (let row = 1; row <= object.length; row++) {
                    putC64Cell(surface, {
                        x,
                        y: y + row,
                        bitmap: graphics.beam,
                        color: (COLORS[state.tick & 7] << 4) | 1,
                        ramColor: 2,
                    });
                }
        }
    }
    function actors(surface: NativeSurface, state: GameState) {
        const player = state.player,
            frame =
                (state.death || state.status === 'over' ? 11 : (player.sprite ?? 5)) +
                (state.exoskeleton ? 12 : 0);
        if (!state.invulnerable || !(state.tick & 2))
            blitC64Sprite(
                surface,
                graphics.player.slice(frame * 96, frame * 96 + 96),
                24,
                32,
                player.x * 2,
                player.y,
                1,
                { mirror: player.direction < 0 },
            );
        for (const bullet of state.bullets)
            blitC64Sprite(surface, [0xbd], 8, 1, bullet.x * 2, bullet.y, 1, { foreground: false });
        for (const bullet of state.enemyBullets)
            blitC64Sprite(surface, [0xc0, 0xc0], 8, 2, bullet.x * 2, bullet.y, 1, {
                foreground: false,
            });
        if (state.grenade)
            shifted(surface, state.grenade.dx < 0 ? 1 : 0, state.grenade.x * 2, state.grenade.y, 7);
        for (const rocket of state.rockets) {
            if (rocket.kind === 'homing')
                small(surface, rocket.x < 70 ? 11 : 10, rocket.x * 2, rocket.y, 7);
            else shifted(surface, 8, rocket.x * 2, rocket.y, 7);
        }
        for (const sphere of state.spheres) shifted(surface, 7, sphere.x * 2, sphere.y, 2);
        for (const enemy of state.enemies)
            small(
                surface,
                enemy.sprite + ((enemy.phase + 3) & 3),
                enemy.x * 2,
                enemy.y,
                COLORS[enemy.color! & 7],
            );
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
            if (age >= 0 && x >= 0 && x < 240 && y >= 0 && y < 169)
                shifted(surface, 2, x, y, piece.color);
        }
    }
    function present(surface: NativeSurface) {
        if (canvas.width !== 256 || canvas.height !== 192) {
            canvas.width = 256;
            canvas.height = 192;
        }
        context.imageSmoothingEnabled = false;
        toC64Rgba(surface, image.data);
        context.putImageData(image, 0, 0);
    }
    function scores(surface: NativeSurface, { rows = [], offset = 0 }: TitleOptions = {}) {
        cells(surface, graphics.screens.scores);
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
            blitC64Sprite(
                surface,
                graphics.small.slice(star.frame * 32, star.frame * 32 + 32),
                16,
                16,
                star.x,
                star.y,
                1,
                { multicolor: true, foreground: false, clipBottom: 192 },
            );
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
                return x >= 0 && x < 240 && y >= 0 && y < 169;
            });
            for (const event of events) {
                if (event.type === 'object-destroyed' && event.instance !== undefined) {
                    const placement = state.screen.placements?.[event.instance];
                    if (placement)
                        for (const [index, tile] of (
                            graphics.blocks[placement.block]?.tiles || []
                        ).entries()) {
                            const x = ((tile.x + placement.x) & 255) * 8,
                                y = ((tile.y + placement.y) & 255) * 8;
                            if (x >= 256 || y >= 176 || pieces.length >= 100) continue;
                            let random = hash(state.tick * 127 + x * 31 + y + index + 1),
                                dy = DEBRIS_DELTA[(random >> 3) & 7];
                            const dx = DEBRIS_DELTA[random & 7];
                            while (!dx && !dy) {
                                random = hash(random + 1);
                                dy = DEBRIS_DELTA[random & 7];
                            }
                            pieces.push({ x, y, dx, dy, tick: state.tick, color: 7 });
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
                    const seed = hash(state.tick * 127 + Math.trunc(event.x || 0) * 31 + 1);
                    for (let n = 0; n < 4; n++)
                        effects.push({
                            x: (event.x || 0) + (n & 1) * 5,
                            y: (event.y || 0) + (n >> 1) * 4,
                            tick: state.tick,
                            color: COLORS[(seed >> n) & 7] || 1,
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
            const surface = createC64Surface();
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
                text(surface, String(value).padStart(length, '0').slice(-length), x, 23, {
                    color: 0x87,
                });
            if (state.status === 'over') cells(surface, graphics.screens.gameOver);
            else if (paused) text(surface, 'PAUSED', 13, 10);
            present(surface);
        },
        renderTitle(time = 0, options = {}) {
            const surface = createC64Surface();
            if (options.scores) scores(surface, options);
            else if (options.menu) {
                cells(surface, graphics.screens.menu);
            } else surface.pixels.set(titleBase.pixels);
            menuStars(surface, time, options.scores ? 'scores' : options.menu ? 'menu' : 'title');
            if (options.menu && !options.scores)
                drawControlMenu('c64', options.controls, {
                    clear() {
                        surface.pixels.fill(0, 48 * 256, 168 * 256);
                    },
                    text: (value, x, row) => text(surface, value, x, row),
                    highlight(row, width) {
                        for (const tile of graphics.screens.menu.filter(
                            (tile) => tile.y === row && tile.x >= 11 && tile.x < 11 + width,
                        ))
                            putC64Cell(surface, { ...tile, color: 0x1f });
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
