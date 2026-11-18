import type { GameState, GameScreen, Tile, ScreenObject } from '../types/game.ts';
import type {
    Graphics,
    MenuOptions,
    CanvasPaint,
    VectorPath,
    Palette,
    Contours,
    Point,
    Rectangle,
} from '../types/graphics.ts';
// New Canvas artwork. The recovered map supplies positions, hue families and
// silhouettes; its bitmap graphics are never used by this presentation layer.
import { spectrumPalette, dominantAttribute } from './palette.ts';
import { drawSpacecraft, drawSpacecraftEngines } from './spacecraft.ts';
import { drawRemasteredMachinery } from './remastered-machinery.ts';
import type { RemasteredLayerCache } from './remastered-cache.ts';

const TAU = Math.PI * 2;
const PLANETS = new Set([3, 4, 30, 35, 36, 37]);
const GROUND = new Set([6, 7, 8, 9, 10, 14, 23, 33, 38, 41, 52, 54, 55, 56, 57, 58, 59, 60, 61]);
const COLUMNS = new Set([24, 25, 27, 34, 47, 50, 53]);
const SUPPORTS = new Set([
    0, 1, 5, 11, 13, 15, 16, 26, 28, 31, 32, 40, 42, 43, 44, 45, 46, 48, 49, 51,
]);
const LAMP_COLORS = [
    [255, 203, 80],
    [255, 98, 117],
    [141, 255, 181],
    [141, 235, 255],
];
type PositionedTile = Tile & Point;
interface TileGroup {
    block: number;
    instance?: number;
    tiles: PositionedTile[];
}
interface RemasteredInstance extends TileGroup, Rectangle {
    palette: Palette;
    materials: { palette: Palette; tiles: PositionedTile[] }[];
}
const instanceCache = new WeakMap<GameScreen, { key: string; items: RemasteredInstance[] }>();
const hash = (value: number) => {
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
};

function path(c: CanvasRenderingContext2D, points: VectorPath, close = true) {
    c.beginPath();
    points.forEach(([x, y], index) => (index ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (close) c.closePath();
}

function line(c: CanvasRenderingContext2D, points: VectorPath, color: CanvasPaint, width = 0.5) {
    path(c, points, false);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
}

function oval(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: CanvasPaint,
) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, TAU);
    c.fillStyle = color;
    c.fill();
}

function gradient(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    colors: string[],
) {
    const paint = c.createLinearGradient(x, y, x + width, y + height);
    colors.forEach((color, index) => paint.addColorStop(index / (colors.length - 1), color));
    return paint;
}

function box(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    color: CanvasPaint,
    radius = 0,
) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + width - r, y);
    c.quadraticCurveTo(x + width, y, x + width, y + r);
    c.lineTo(x + width, y + height - r);
    c.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    c.lineTo(x + r, y + height);
    c.quadraticCurveTo(x, y + height, x, y + height - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
    c.fillStyle = color;
    c.fill();
}

function glow(c: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
    const light = c.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, color);
    light.addColorStop(1, 'transparent');
    oval(c, x, y, radius, radius, light);
}

function text(
    c: CanvasRenderingContext2D,
    value: string | number,
    x: number,
    y: number,
    size = 7,
    color = '#dceefa',
    align: CanvasTextAlign = 'center',
) {
    c.font = `600 ${size}px "Trebuchet MS", Arial, sans-serif`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(String(value), x, y);
}

// Deterministic births, growth and disappearance; no model or wall clock access.
function stars(
    c: CanvasRenderingContext2D,
    time: number,
    seed = 1,
    height = 176,
    reserved: number[] | null = null,
) {
    for (let id = 0; id < 102; id++) {
        const random = hash(seed * 811 + id * 197 + 1);
        const age = time / (2200 + (random % 2300)) + (random >>> 19) / 8192;
        const position = hash(random + Math.floor(age) * 1597);
        const x = (position % 255) + 0.5,
            y = ((position >>> 9) % height) + 0.5;
        if (
            reserved &&
            x > reserved[0] - 5 &&
            x < reserved[2] + 5 &&
            y > reserved[1] - 5 &&
            y < reserved[3] + 5
        )
            continue;
        const phase = ((age % 1) + 1) % 1;
        const brightness = Math.sin(phase * Math.PI) ** 3;
        if (brightness < 0.1) continue;
        const tint = ['#b4daff', '#f5e8ff', '#bfffee', '#ffdfb7'][random & 3];
        c.globalAlpha = 0.2 + brightness * 0.75;
        oval(c, x, y, 0.2 + brightness * 0.3, 0.2 + brightness * 0.3, tint);
        if (id % 13 === 0 && brightness > 0.55) {
            const size = (brightness - 0.5) * 4;
            glow(c, x, y, size * 2.5, '#9edfff33');
            line(
                c,
                [
                    [x - size, y],
                    [x + size, y],
                ],
                tint,
                0.25,
            );
            line(
                c,
                [
                    [x, y - size],
                    [x, y + size],
                ],
                tint,
                0.25,
            );
        }
    }
    c.globalAlpha = 1;
}

function spaceBackground(c: CanvasRenderingContext2D, height = 176) {
    c.fillStyle = gradient(c, 0, 0, 90, height, ['#02040c', '#081126', '#081120']);
    c.fillRect(0, 0, 256, height);
    glow(c, 204, 30, 110, '#17265320');
    glow(c, 36, 126, 96, '#40124b17');
}

function space(
    c: CanvasRenderingContext2D,
    time: number,
    seed: number,
    height = 176,
    reserved: number[] | null = null,
) {
    spaceBackground(c, height);
    stars(c, time, seed, height, reserved);
}

function planet(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    attribute: number,
    seed = 1,
    rings = false,
) {
    const p = spectrumPalette(attribute);
    c.save();
    glow(c, x, y, radius * 1.16, `${p.base}16`);
    if (rings) {
        c.save();
        c.translate(x, y);
        c.rotate(-0.28);
        c.strokeStyle = p.shade;
        c.lineWidth = radius * 0.13;
        c.beginPath();
        c.ellipse(0, 0, radius * 1.6, radius * 0.38, 0, Math.PI, TAU);
        c.stroke();
        c.restore();
    }
    c.beginPath();
    c.arc(x, y, radius, 0, TAU);
    c.clip();
    const surface = c.createRadialGradient(
        x - radius * 0.37,
        y - radius * 0.4,
        radius * 0.02,
        x - radius * 0.28,
        y - radius * 0.28,
        radius * 1.36,
    );
    surface.addColorStop(0, p.highlight);
    surface.addColorStop(0.27, p.light);
    surface.addColorStop(0.52, p.base);
    surface.addColorStop(0.74, p.shade);
    surface.addColorStop(0.9, p.deep);
    surface.addColorStop(1, '#01040b');
    c.fillStyle = surface;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    // Curved cloud belts and rocky basins follow the visible spherical surface.
    c.globalAlpha = 0.2;
    for (let band = 0; band < 7; band++) {
        const random = hash(seed * 37 + band * 83);
        const dy = ((random & 255) / 255 - 0.5) * radius * 1.7;
        c.beginPath();
        c.ellipse(
            x - radius * 0.2,
            y + dy,
            radius * 1.2,
            radius * (0.06 + (random & 3) * 0.018),
            -0.17,
            0,
            TAU,
        );
        c.strokeStyle = band & 1 ? p.light : p.deep;
        c.lineWidth = radius * 0.045;
        c.stroke();
    }
    c.globalAlpha = 0.18;
    for (let basin = 0; basin < 6; basin++) {
        const random = hash(seed * 911 + basin * 129);
        const bx = x + ((random & 255) / 255 - 0.5) * radius * 1.5;
        const by = y + (((random >>> 8) & 255) / 255 - 0.5) * radius * 1.5;
        oval(c, bx, by, radius * (0.08 + (random & 3) * 0.025), radius * 0.07, p.deep);
    }
    c.globalAlpha = 1;
    // The night hemisphere occludes clouds, leaving a narrow lit atmosphere.
    const shade = c.createLinearGradient(
        x - radius * 0.4,
        y - radius * 0.4,
        x + radius * 0.7,
        y + radius * 0.7,
    );
    shade.addColorStop(0, '#00000000');
    shade.addColorStop(0.44, '#01040a00');
    shade.addColorStop(0.72, '#01040a80');
    shade.addColorStop(1, '#01030bf8');
    c.fillStyle = shade;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    c.strokeStyle = `${p.highlight}88`;
    c.lineWidth = 0.45;
    c.beginPath();
    c.arc(x, y, radius - 0.2, Math.PI * 1.02, Math.PI * 1.72);
    c.stroke();
    c.restore();
    if (rings) {
        c.save();
        c.translate(x, y);
        c.rotate(-0.28);
        c.strokeStyle = p.light;
        c.lineWidth = radius * 0.1;
        c.beginPath();
        c.ellipse(0, 0, radius * 1.6, radius * 0.38, 0, 0, Math.PI);
        c.stroke();
        c.strokeStyle = p.deep;
        c.lineWidth = radius * 0.025;
        c.stroke();
        c.restore();
    }
}

function contourPath(c: CanvasRenderingContext2D, tiles: PositionedTile[], contours: Contours) {
    c.beginPath();
    for (const tile of tiles)
        for (const loop of contours[tile.shape!] || []) {
            loop.forEach(([x, y], index) =>
                index
                    ? c.lineTo(tile.x * 8 + x, tile.y * 8 + y)
                    : c.moveTo(tile.x * 8 + x, tile.y * 8 + y),
            );
            c.closePath();
        }
}

function instances(state: GameState) {
    const groups = new Map<number | undefined, TileGroup>(),
        destroyed = new Set(state.destroyed || []);
    const inactive = new Set(
        (state.objects || [])
            .filter((object) => !object.active && [7, 8].includes(object.type))
            .map((object) => object.instance),
    );
    const key = `${[...destroyed].join(',')}:${[...inactive].join(',')}`;
    const cached = instanceCache.get(state.screen);
    if (cached?.key === key) return cached.items;
    for (const [index, source] of (state.screen.tiles || []).entries()) {
        if (
            !source ||
            index >= 704 ||
            destroyed.has(source.instance!) ||
            inactive.has(source.instance) ||
            !source.ink
        )
            continue;
        let item = groups.get(source.instance);
        if (!item) {
            item = { block: source.block, instance: source.instance, tiles: [] };
            groups.set(source.instance, item);
        }
        item.tiles.push({ ...source, x: index % 32, y: index >> 5 });
    }
    const items = [...groups.values()].map((item) => {
        const x = Math.min(...item.tiles.map((tile) => tile.x * 8)),
            y = Math.min(...item.tiles.map((tile) => tile.y * 8));
        const materials = new Map<number, PositionedTile[]>();
        for (const tile of item.tiles) {
            const attribute = tile.color! & 71;
            if (!materials.has(attribute)) materials.set(attribute, []);
            materials.get(attribute)!.push(tile);
        }
        return {
            ...item,
            x,
            y,
            w: Math.max(...item.tiles.map((tile) => tile.x * 8 + 8)) - x,
            h: Math.max(...item.tiles.map((tile) => tile.y * 8 + 8)) - y,
            palette: spectrumPalette(dominantAttribute(item.tiles)),
            materials: [...materials].map(([attribute, tiles]) => ({
                palette: spectrumPalette(attribute),
                tiles,
            })),
        };
    });
    instanceCache.set(state.screen, { key, items });
    return items;
}

function surface(c: CanvasRenderingContext2D, item: RemasteredInstance, contours: Contours) {
    const { x, y, w, h } = item,
        ground = GROUND.has(item.block);
    for (const { palette: p, tiles } of item.materials) {
        c.save();
        contourPath(c, tiles, contours);
        c.clip();
        c.fillStyle = gradient(c, x, y, w * 0.2, h, [p.light, p.base, p.shade, p.deep]);
        c.fillRect(x, y, w, h);
        if (ground) {
            // Mineral shelves, bevels and striations; all remain inside source geometry.
            for (let band = y + 2; band < y + h; band += 6) {
                line(
                    c,
                    [
                        [x, band],
                        [x + w, band],
                    ],
                    band === y + 2 ? p.highlight : p.deep,
                    band === y + 2 ? 0.7 : 0.45,
                );
                line(
                    c,
                    [
                        [x, band + 0.65],
                        [x + w, band + 0.65],
                    ],
                    `${p.light}77`,
                    0.35,
                );
            }
            for (let seam = x + 7; seam < x + w; seam += 19) {
                line(
                    c,
                    [
                        [seam, y + h],
                        [seam + 3, y + h * 0.5],
                        [seam - 1, y + 2],
                    ],
                    p.deep,
                    0.65,
                );
                line(
                    c,
                    [
                        [seam + 0.7, y + h],
                        [seam + 3.7, y + h * 0.5],
                    ],
                    p.light,
                    0.35,
                );
            }
        } else {
            // Separate illuminated metal faces and recessed mechanical panels.
            for (let panel = x + 3; panel < x + w; panel += 12) {
                box(c, panel, y + 3, 7, Math.max(2, h - 6), `${p.deep}99`, 1);
                line(
                    c,
                    [
                        [panel + 0.6, y + h - 4],
                        [panel + 0.6, y + 3.5],
                        [panel + 6, y + 3.5],
                    ],
                    `${p.highlight}bb`,
                    0.4,
                );
                for (let vent = y + 7; vent < y + h - 4; vent += 5) {
                    line(
                        c,
                        [
                            [panel + 2, vent],
                            [panel + 5, vent],
                        ],
                        p.shade,
                        0.8,
                    );
                    line(
                        c,
                        [
                            [panel + 2, vent + 0.65],
                            [panel + 5, vent + 0.65],
                        ],
                        p.light,
                        0.3,
                    );
                }
                for (const yy of [y + 4.5, y + h - 4.5])
                    oval(c, panel + 1.5, yy, 0.38, 0.38, p.highlight);
            }
        }
        c.restore();
    }
    // Fine highlights are clipped to the silhouette instead of outlining cells.
    c.save();
    contourPath(c, item.tiles, contours);
    c.clip();
    const p = item.palette;
    line(
        c,
        [
            [x, y + 0.65],
            [x + w, y + 0.65],
        ],
        p.highlight,
        1.1,
    );
    line(
        c,
        [
            [x + 0.65, y],
            [x + 0.65, y + h],
        ],
        `${p.light}bb`,
        0.7,
    );
    c.restore();
}

function metal(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    p: Palette,
    radius = 1.8,
) {
    box(c, x, y, w, h, gradient(c, x, y, w * 0.8, h, [p.light, p.base, p.shade, p.deep]), radius);
    line(
        c,
        [
            [x + radius, y + 0.7],
            [x + w - radius, y + 0.7],
        ],
        p.highlight,
        0.6,
    );
    line(
        c,
        [
            [x + 0.7, y + radius],
            [x + 0.7, y + h - radius],
        ],
        p.light,
        0.5,
    );
    if (w > 10 && h > 10) {
        box(c, x + 3, y + 4, w - 6, h - 7, `${p.deep}88`, Math.min(radius, 1));
        line(
            c,
            [
                [x + 3.5, y + h - 4],
                [x + 3.5, y + 4.5],
                [x + w - 4, y + 4.5],
            ],
            p.shade,
            0.5,
        );
        for (const xx of [x + 2, x + w - 2])
            for (const yy of [y + 2.3, y + h - 2.3]) {
                oval(c, xx, yy, 0.45, 0.45, p.deep);
                oval(c, xx - 0.1, yy - 0.1, 0.2, 0.2, p.highlight);
            }
    }
}

function cylinder(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    p: Palette,
) {
    const rim = Math.min(2.6, w * 0.14, h * 0.12);
    box(
        c,
        x,
        y + rim,
        w,
        h - rim * 2,
        gradient(c, x, y, w, 0, [p.shade, p.light, p.base, p.shade, p.deep]),
        rim,
    );
    oval(c, x + w / 2, y + rim, w / 2, rim, p.light);
    oval(c, x + w / 2, y + rim * 0.85, w / 2 - 0.6, rim * 0.55, p.shade);
    oval(c, x + w / 2, y + h - rim, w / 2, rim, p.deep);
    line(
        c,
        [
            [x + w * 0.22, y + rim * 2],
            [x + w * 0.22, y + h - rim * 2],
        ],
        `${p.highlight}aa`,
        0.55,
    );
    for (let yy = y + Math.max(5, h * 0.2); yy < y + h - 3; yy += Math.max(7, h * 0.28)) {
        box(
            c,
            x - 0.4,
            yy,
            w + 0.8,
            1.6,
            gradient(c, x, yy, w, 0, [p.light, p.shade, p.deep]),
            0.4,
        );
    }
}

function deck(c: CanvasRenderingContext2D, item: RemasteredInstance) {
    const { x, y, w, h, palette: p } = item;
    const plated = [23, 33, 52, 55].includes(item.block);
    if (plated) {
        metal(c, x, y, w, h, p, 0.7);
        for (let xx = x + 1; xx < x + w; xx += 16) {
            const width = Math.min(14, x + w - xx - 0.5);
            if (width < 1) continue;
            box(c, xx, y + 1.5, width, Math.max(1, h - 3), p.deep, 0.4);
            line(
                c,
                [
                    [xx + 0.7, y + h - 2],
                    [xx + 0.7, y + 2],
                    [xx + width - 1, y + 2],
                ],
                p.light,
                0.4,
            );
            for (let slot = xx + 3; slot < xx + width - 2; slot += 2.5)
                line(
                    c,
                    [
                        [slot, y + h - 2.5],
                        [slot + 1.6, y + 3],
                    ],
                    p.shade,
                    0.65,
                );
        }
        return;
    }
    // Continuous rock beds replace the source's alternating pixel dither.
    // The top remains at the exact collision surface, including raised ledges.
    c.save();
    if (item.block === 41)
        path(c, [
            [x, y + h],
            [x + w * 0.2, y + h * 0.52],
            [x + w * 0.38, y + 1],
            [x + w * 0.63, y],
            [x + w * 0.83, y + h * 0.45],
            [x + w, y + h],
        ]);
    else {
        c.beginPath();
        c.rect(x, y, w, h);
    }
    c.clip();
    c.fillStyle = gradient(c, x, y, w * 0.15, h, [p.base, p.shade, p.deep]);
    c.fillRect(x, y, w, h);
    const secondary = spectrumPalette(
        item.block >= 58 ? 69 : p.ink === 2 || p.ink === 3 ? 67 : p.ink | 64,
    );
    for (let row = 0; row < Math.ceil(h / 9); row++)
        for (let column = -1; column < Math.ceil(w / 13); column++) {
            const random = hash(item.block * 991 + row * 37 + column * 271 + 1001);
            const bx = x + column * 13 + (row % 2) * 6,
                by = y + row * 9;
            const color = random & 1 ? p : secondary;
            path(c, [
                [bx + 2, by + 0.4],
                [bx + 10, by + (random & 1)],
                [bx + 13.5, by + 4],
                [bx + 10, by + 9],
                [bx + 1.5, by + 9],
                [bx - 1, by + 4.5],
            ]);
            c.fillStyle = gradient(c, bx, by, 7, 10, [color.base, color.shade, color.deep]);
            c.fill();
            line(
                c,
                [
                    [bx + 0.2, by + 4],
                    [bx + 2.5, by + 1],
                    [bx + 9.7, by + 1],
                ],
                `${color.light}99`,
                0.45,
            );
            line(
                c,
                [
                    [bx + 10, by + 1],
                    [bx + 12.3, by + 4.5],
                    [bx + 9.5, by + 8.1],
                ],
                color.deep,
                0.7,
            );
            if ((random & 3) === 0)
                line(
                    c,
                    [
                        [bx + 5, by + 2],
                        [bx + 6, by + 4],
                        [bx + 4, by + 6],
                    ],
                    `${color.deep}aa`,
                    0.45,
                );
        }
    c.restore();
    if (item.block !== 41)
        line(
            c,
            [
                [x, y + 0.35],
                [x + w, y + 0.35],
            ],
            p.light,
            0.7,
        );
}

function truss(c: CanvasRenderingContext2D, item: RemasteredInstance, large = false) {
    const { x, y, w, h } = item,
        p = spectrumPalette(large ? 67 : 68),
        rail = large ? 14 : 13;
    const top = large ? y : y + 9;
    for (const xx of [x + (large ? 1 : 9), x + w - rail - (large ? 1 : 9)]) {
        metal(c, xx, top + (large ? 0 : 6), rail, h - (top - y) - 3, p, 1.4);
        for (let yy = top + 11; yy < y + h - 7; yy += 12) {
            line(
                c,
                [
                    [xx + 2.5, yy],
                    [xx + rail - 3, yy + 8],
                    [xx + 2.5, yy + 8],
                ],
                p.light,
                0.65,
            );
            oval(c, xx + rail - 3, yy + 8, 0.7, 0.7, p.deep);
        }
        metal(c, xx - (large ? 0 : 7), y + h - 5, rail + (large ? 0 : 14), 5, p, 1);
    }
    if (!large) {
        metal(c, x, top, w, 6.5, p, 1.6);
        for (let xx = x + 5; xx < x + w - 4; xx += 9)
            line(
                c,
                [
                    [xx, top + 5.5],
                    [xx + 3.5, top + 1.5],
                    [Math.min(x + w - 2, xx + 8), top + 5.5],
                ],
                p.deep,
                0.9,
            );
        metal(c, x + w * 0.36, top + 6, w * 0.28, 10, p, 1);
    }
}

function rockFormation(c: CanvasRenderingContext2D, item: RemasteredInstance) {
    const { x, y, w, h, palette: p } = item;
    // Each round terminal has its own broad base and tapering curved column.
    // Draw the separate forms back-to-front, keeping gaps between their stems.
    const forms = [
        {
            cap: [23, 6, 6, 6],
            curve: [
                [32, 66],
                [35, 36],
                [43, 1],
                [23, 6],
            ],
            base: 7,
        },
        {
            cap: [17, 23, 8, 8],
            curve: [
                [24, 66],
                [26, 47],
                [34, 20],
                [17, 23],
            ],
            base: 6,
        },
        {
            cap: [34, 29, 6, 6],
            curve: [
                [38, 66],
                [35, 53],
                [43, 28],
                [34, 29],
            ],
            base: 5,
        },
        {
            cap: [11, 39, 8.5, 8.5],
            curve: [
                [15, 66],
                [19, 54],
                [24, 37],
                [11, 39],
            ],
            base: 6.5,
        },
        {
            cap: [29, 44, 7, 7],
            curve: [
                [28, 66],
                [33, 56],
                [38, 42],
                [29, 44],
            ],
            base: 5,
        },
        {
            cap: [7, 57, 9, 7],
            curve: [
                [6, 67],
                [8, 64],
                [14, 56],
                [7, 57],
            ],
            base: 6,
        },
        {
            cap: [25, 58, 9, 6],
            curve: [
                [24, 67],
                [28, 65],
                [34, 57],
                [25, 58],
            ],
            base: 6,
        },
    ];
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    c.translate(x, y);
    c.scale(w / 40, h / 64);
    for (const [index, form] of forms.entries()) {
        const [a, b, d, e] = form.curve,
            left: number[][] = [],
            right: number[][] = [],
            centers: { x: number; y: number; nx: number; ny: number; r: number }[] = [];
        for (let n = 0; n <= 32; n++) {
            const t = n / 32,
                u = 1 - t;
            const px =
                u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * d[0] + t * t * t * e[0];
            const py =
                u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * d[1] + t * t * t * e[1];
            const dx =
                3 * u * u * (b[0] - a[0]) + 6 * u * t * (d[0] - b[0]) + 3 * t * t * (e[0] - d[0]);
            const dy =
                3 * u * u * (b[1] - a[1]) + 6 * u * t * (d[1] - b[1]) + 3 * t * t * (e[1] - d[1]);
            const length = Math.hypot(dx, dy) || 1,
                nx = -dy / length,
                ny = dx / length,
                r = 1.3 + (form.base - 1.3) * u ** 1.25;
            left.push([px + nx * r, py + ny * r]);
            right.push([px - nx * r, py - ny * r]);
            centers.push({ x: px, y: py, nx, ny, r });
        }
        path(c, [...left, ...right.reverse()]);
        c.fillStyle = gradient(c, a[0] - form.base, 0, form.base * 2, 0, [
            p.light,
            p.base,
            p.shade,
            p.deep,
        ]);
        c.fill();
        c.strokeStyle = `${p.deep}bb`;
        c.lineWidth = 0.45;
        c.stroke();
        c.save();
        c.clip();
        for (let n = 0; n < 35; n++) {
            const seed = hash((index + 1) * 991 + n * 113),
                point = centers[seed % centers.length],
                offset = (((seed >>> 8) & 255) / 127.5 - 1) * point.r;
            oval(
                c,
                point.x + point.nx * offset,
                point.y + point.ny * offset,
                0.12 + ((seed >>> 16) & 3) * 0.07,
                0.12,
                n & 1 ? `${p.deep}55` : `${p.highlight}33`,
            );
        }
        line(
            c,
            centers.map((point) => [
                point.x - point.nx * point.r * 0.55,
                point.y - point.ny * point.r * 0.55,
            ]),
            `${p.light}88`,
            0.4,
        );
        c.restore();
        const [cx, cy, rx, ry] = form.cap;
        const fill = c.createRadialGradient(
            cx - rx * 0.38,
            cy - ry * 0.42,
            0.2,
            cx + rx * 0.15,
            cy + ry * 0.2,
            Math.max(rx, ry) * 1.2,
        );
        fill.addColorStop(0, p.light);
        fill.addColorStop(0.2, p.base);
        fill.addColorStop(0.7, p.shade);
        fill.addColorStop(1, p.deep);
        c.beginPath();
        c.moveTo(cx - rx * 0.9, cy - ry * 0.2);
        c.bezierCurveTo(
            cx - rx * 0.8,
            cy - ry * 0.8,
            cx - rx * 0.35,
            cy - ry * 1.04,
            cx + rx * 0.1,
            cy - ry * 0.95,
        );
        c.bezierCurveTo(
            cx + rx * 0.65,
            cy - ry * 1.02,
            cx + rx * 0.95,
            cy - ry * 0.5,
            cx + rx * 0.94,
            cy + ry * 0.12,
        );
        c.bezierCurveTo(
            cx + rx * 1.03,
            cy + ry * 0.62,
            cx + rx * 0.4,
            cy + ry * 0.98,
            cx - rx * 0.12,
            cy + ry * 0.94,
        );
        c.bezierCurveTo(
            cx - rx * 0.7,
            cy + ry * 0.96,
            cx - rx * 1.04,
            cy + ry * 0.4,
            cx - rx * 0.9,
            cy - ry * 0.2,
        );
        c.closePath();
        c.fillStyle = fill;
        c.fill();
        c.strokeStyle = `${p.deep}99`;
        c.lineWidth = 0.4;
        c.stroke();
        c.save();
        c.clip();
        // A matte, pitted surface and branching seams distinguish stone from
        // smooth metal spheres while retaining the source's rounded forms.
        for (let n = 0; n < 40; n++) {
            const seed = hash((index + 1) * 977 + n * 71),
                px = cx + ((seed & 255) / 127.5 - 1) * rx,
                py = cy + (((seed >>> 8) & 255) / 127.5 - 1) * ry;
            oval(
                c,
                px,
                py,
                0.12 + ((seed >>> 16) & 3) * 0.07,
                0.1 + ((seed >>> 18) & 3) * 0.05,
                n & 1 ? `${p.deep}44` : `${p.highlight}33`,
            );
        }
        const direction = index & 1 ? 1 : -1;
        line(
            c,
            [
                [cx + direction * rx * 0.35, cy - ry * 0.82],
                [cx + direction * rx * 0.12, cy - ry * 0.28],
                [cx + direction * rx * 0.3, cy + ry * 0.03],
                [cx + direction * rx * 0.08, cy + ry * 0.38],
            ],
            `${p.deep}88`,
            0.35,
        );
        line(
            c,
            [
                [cx + direction * rx * 0.3, cy + ry * 0.03],
                [cx + direction * rx * 0.64, cy + ry * 0.18],
            ],
            `${p.deep}66`,
            0.25,
        );
        c.restore();
    }
    c.restore();
}

function sphereChamber(
    c: CanvasRenderingContext2D,
    item: RemasteredInstance,
    foregroundOnly = false,
) {
    // Source block21 is a 32×32 cyan enclosure above a 16px yellow
    // triangular pedestal. Its red contents belong to the moving sprite layer.
    const cyan = spectrumPalette(69),
        yellow = spectrumPalette(70);
    c.save();
    c.translate(item.x, item.y);
    c.scale(item.w / 32, item.h / 48);
    path(c, [
        [13, 31.5],
        [19, 31.5],
        [31.6, 47.7],
        [0.4, 47.7],
    ]);
    c.fillStyle = gradient(c, 3, 32, 27, 14, [
        yellow.highlight,
        yellow.base,
        yellow.shade,
        yellow.deep,
    ]);
    c.fill();
    path(c, [
        [16, 31.5],
        [19, 31.5],
        [31.6, 47.7],
        [21, 47.7],
    ]);
    c.fillStyle = yellow.shade;
    c.fill();
    line(
        c,
        [
            [12.8, 33],
            [3, 45.8],
        ],
        yellow.light,
        0.6,
    );
    line(
        c,
        [
            [4.8, 40],
            [27.2, 40],
        ],
        yellow.deep,
        0.75,
    );
    line(
        c,
        [
            [1.5, 46.9],
            [30.5, 46.9],
        ],
        yellow.light,
        0.65,
    );
    if (foregroundOnly) {
        c.restore();
        return;
    }
    oval(
        c,
        16,
        16,
        15.8,
        15.8,
        gradient(c, 2, 1, 28, 27, [cyan.highlight, cyan.light, cyan.base, cyan.shade, cyan.deep]),
    );
    const glass = c.createRadialGradient(11, 9, 1, 19, 20, 18);
    glass.addColorStop(0, '#234a59');
    glass.addColorStop(0.35, '#102536');
    glass.addColorStop(0.8, '#07131e');
    glass.addColorStop(1, '#0a1b28');
    oval(c, 16, 16, 12.8, 12.8, glass);
    c.strokeStyle = cyan.deep;
    c.lineWidth = 0.45;
    c.stroke();
    c.beginPath();
    c.arc(16, 16, 15.3, Math.PI * 1.03, Math.PI * 1.68);
    c.strokeStyle = `${cyan.highlight}cc`;
    c.lineWidth = 0.6;
    c.stroke();
    c.beginPath();
    c.arc(16, 16, 12.1, Math.PI * 1.08, Math.PI * 1.55);
    c.strokeStyle = '#b2fcff66';
    c.lineWidth = 0.5;
    c.stroke();
    c.beginPath();
    c.moveTo(6.5, 12);
    c.bezierCurveTo(7.5, 8.7, 9.5, 6.5, 12, 5.8);
    c.strokeStyle = '#c7ffff55';
    c.lineWidth = 0.7;
    c.stroke();
    c.restore();
}

function redrawnSurface(c: CanvasRenderingContext2D, item: RemasteredInstance) {
    const { x, y, w, h, block, palette: p } = item;
    if (drawRemasteredMachinery(c, item)) return true;
    if (GROUND.has(block)) {
        deck(c, item);
        return true;
    }
    if ([11, 42].includes(block)) {
        truss(c, item, block === 42);
        return true;
    }
    if (block === 13) {
        rockFormation(c, item);
        return true;
    }
    if (COLUMNS.has(block)) {
        if (block === 53) {
            for (const xx of [x + 1, x + w - 5]) cylinder(c, xx, y, 4, h, p);
            for (let yy = y + 1; yy < y + h; yy += 14) metal(c, x, yy, w, 3, p, 0.7);
        } else if (block === 50) {
            for (let yy = y; yy < y + h; yy += h / 4)
                cylinder(c, x + 1, yy + 0.5, w - 2, h / 4 - 1, p);
        } else {
            const columnW = block === 25 ? w * 0.45 : w * 0.7;
            cylinder(c, x + (w - columnW) / 2, y, columnW, h - 3, p);
            metal(c, x, y + h - 4, w, 4, p, 0.7);
        }
        return true;
    }
    if ([48, 49].includes(block)) {
        const points =
            block === 48
                ? [
                      [x + 2, y + h - 2],
                      [x + w - 2, y + 2],
                  ]
                : [
                      [x + 2, y + 2],
                      [x + w - 2, y + h - 2],
                  ];
        line(c, points, p.deep, 7);
        line(c, points, p.base, 5);
        line(
            c,
            points.map(([xx, yy]) => [xx - 0.7, yy - 0.7]),
            p.light,
            1,
        );
        return true;
    }
    if (block === 21) {
        sphereChamber(c, item);
        return true;
    }
    if ([0, 1, 28, 43, 46, 51].includes(block)) {
        if (block === 51) {
            for (const xx of [x + 1, x + w - 14]) {
                cylinder(c, xx, y + 1, 13, h - 2, p);
                for (let yy = y + 5; yy < y + h - 2; yy += 6)
                    metal(c, xx - 1, yy, 15, 2, spectrumPalette(70), 0.7);
            }
        } else if (block === 46) {
            cylinder(c, x + w * 0.3, y + h * 0.35, w * 0.4, h * 0.6, p);
            c.beginPath();
            c.ellipse(x + w / 2, y + h * 0.38, w / 2 - 0.5, h * 0.37, 0, Math.PI, TAU);
            c.closePath();
            c.fillStyle = gradient(c, x, y, w, h * 0.4, [p.highlight, p.base, p.shade]);
            c.fill();
            metal(c, x + 1, y + h * 0.36, w - 2, 3, p, 0.6);
            metal(c, x + 2, y + h - 4, w - 4, 4, p, 1);
        } else if (block === 28) {
            metal(c, x + 1, y + 1, w - 2, h * 0.65, p, 3);
            for (const xx of [x + 4, x + w - 7]) box(c, xx, y + 4, 3, h * 0.4, p.deep, 0.6);
            cylinder(c, x + w / 2 - 2, y + h * 0.62, 4, h * 0.34, spectrumPalette(71));
        } else if (block === 43) {
            cylinder(c, x + w / 2 - 2, y + 6, 4, h - 7, p);
            metal(c, x + 1, y + h - 4, w - 2, 4, p, 1);
            oval(c, x + w / 2, y + 5, 3, 4, '#c4fff0');
            glow(c, x + w / 2, y + 5, 6, '#6fffff55');
        } else {
            metal(c, x + 1, y + 1, w - 2, Math.max(3, h * 0.42), p, 2);
            if (h > 14) {
                cylinder(c, x + w * 0.31, y + h * 0.35, w * 0.38, h * 0.59, p);
                metal(c, x + 1, y + h - 5, w - 2, 5, p, 1);
            }
        }
        return true;
    }
    return block === 22;
}

function supply(c: CanvasRenderingContext2D, item: RemasteredInstance) {
    const rocket = item.block === 20,
        p = spectrumPalette(rocket ? 70 : 71);
    c.save();
    c.translate(item.x, item.y);
    c.scale(item.w / 16, item.h / 16);
    // Keep the source's raised lid, handle, side rails and tapered lower case.
    box(c, 5.4, 0.4, 5.2, 2.6, p.deep, 0.6);
    box(c, 6.3, 0.8, 3.4, 1.3, p.light, 0.3);
    path(c, [
        [1, 4],
        [15, 4],
        [15, 13.7],
        [13.5, 15.6],
        [2.5, 15.6],
        [1, 13.7],
    ]);
    c.fillStyle = gradient(c, 1, 4, 14, 12, [p.highlight, p.base, p.shade, p.deep]);
    c.fill();
    box(c, 0.5, 2.7, 15, 2.2, gradient(c, 0, 2.7, 0, 2.2, [p.highlight, p.base, p.shade]), 0.5);
    line(
        c,
        [
            [1.3, 3.1],
            [14.7, 3.1],
        ],
        p.highlight,
        0.35,
    );
    box(c, 2.9, 5.2, 10.2, 8.9, '#091722', 0.6);
    line(
        c,
        [
            [3.3, 13.8],
            [12.7, 13.8],
        ],
        p.deep,
        0.45,
    );
    for (const xx of [1.4, 13.8]) {
        box(c, xx, 5.3, 0.8, 8.5, p.light, 0.2);
        line(
            c,
            [
                [xx, 5.8],
                [xx, 12.8],
            ],
            p.highlight,
            0.3,
        );
    }
    if (rocket) {
        // A pointed nose and broad fins read as a rocket even at small scale.
        path(c, [
            [8, 5.7],
            [9.3, 8],
            [9.3, 10.3],
            [11, 12.8],
            [9.1, 12.1],
            [8.7, 13],
            [7.3, 13],
            [6.9, 12.1],
            [5, 12.8],
            [6.7, 10.3],
            [6.7, 8],
        ]);
        c.fillStyle = gradient(c, 6, 6, 4, 6, ['#ffffff', '#d9eeef', '#7cabb8']);
        c.fill();
        line(
            c,
            [
                [8, 6.7],
                [7.3, 8.1],
                [7.3, 11.4],
            ],
            '#ffffff',
            0.35,
        );
        box(c, 6.9, 9, 2.2, 0.9, '#dc674e', 0.1);
        box(c, 7.4, 12.6, 1.2, 0.65, '#748f9c', 0.1);
    } else {
        // Three pointed brass cartridges seated in a dark magazine, not tubes.
        box(c, 3.8, 11.8, 8.4, 1.6, '#506273', 0.3);
        for (const xx of [4.1, 7, 9.9]) {
            path(c, [
                [xx + 1, 5.9],
                [xx + 1.8, 7.5],
                [xx + 1.8, 8.1],
                [xx + 0.2, 8.1],
                [xx + 0.2, 7.5],
            ]);
            c.fillStyle = gradient(c, xx, 6, 2, 0, ['#ffe9b8', '#f2b262', '#a25d33']);
            c.fill();
            box(
                c,
                xx + 0.15,
                8.1,
                1.7,
                4.4,
                gradient(c, xx, 8, 2, 0, ['#ffecb3', '#cf9c45', '#805721']),
                0.15,
            );
            line(
                c,
                [
                    [xx + 0.5, 8.4],
                    [xx + 0.5, 11.9],
                ],
                '#fff5cc',
                0.25,
            );
            box(c, xx, 12.2, 2, 0.55, '#eac46a', 0.1);
        }
        line(
            c,
            [
                [4.1, 13.1],
                [11.9, 13.1],
            ],
            '#a5b5bf',
            0.35,
        );
    }
    c.restore();
}

function suitChamber(
    c: CanvasRenderingContext2D,
    item: RemasteredInstance,
    foregroundOnly = false,
) {
    const p = spectrumPalette(67),
        white = spectrumPalette(71);
    c.save();
    c.translate(item.x, item.y);
    c.scale(item.w / 40, item.h / 56);
    if (!foregroundOnly) {
        // Four posts around the open chamber: rear, two side rails, front.
        box(c, 18.8, 5, 2.4, 35, p.deep, 0.5);
        for (const side of [-1, 1]) {
            const rail = [
                [20 + side * 14, 8],
                [20 + side * 14, 16],
                [20 + side * 16, 17],
                [20 + side * 16, 27],
                [20 + side * 18, 28],
                [20 + side * 18, 41],
            ];
            line(c, rail, p.shade, 2.4);
            line(
                c,
                rail.map(([x, y]) => [x - side * 0.5, y]),
                white.base,
                0.7,
            );
        }
    }
    // The original lip is 16 pixels above the surrounding floor. Its lower
    // plinth and broad raised platform make the required hop visible.
    box(c, 7.5, 48, 25, 8, gradient(c, 8, 48, 25, 2, [p.light, p.base, p.shade, p.deep]), 0.7);
    path(c, [
        [3, 40],
        [37, 40],
        [40, 43],
        [39, 48],
        [1, 48],
        [0, 43],
    ]);
    c.fillStyle = gradient(c, 0, 40, 8, 8, [p.highlight, p.base, p.shade, p.deep]);
    c.fill();
    path(c, [
        [3, 40],
        [37, 40],
        [39, 42],
        [1, 42],
    ]);
    c.fillStyle = p.light;
    c.fill();
    line(
        c,
        [
            [2, 47],
            [38, 47],
        ],
        p.deep,
        0.45,
    );
    line(
        c,
        [
            [8.3, 49],
            [8.3, 54.7],
        ],
        p.highlight,
        0.45,
    );
    // This opaque front post is drawn again after moving actors. Open sides
    // and the white rear rails stay behind the astronaut, as in the ZX mask.
    box(
        c,
        16,
        7,
        8,
        34,
        gradient(c, 16, 7, 8, 0, [p.highlight, p.light, p.base, p.shade, p.deep]),
        0.6,
    );
    line(
        c,
        [
            [17.2, 9],
            [17.2, 39],
        ],
        p.highlight,
        0.45,
    );
    c.beginPath();
    c.moveTo(7, 8);
    c.bezierCurveTo(9, 2, 15, 0.5, 20, 0.5);
    c.bezierCurveTo(25, 0.5, 31, 2, 33, 8);
    c.bezierCurveTo(28, 11, 12, 11, 7, 8);
    c.closePath();
    c.fillStyle = gradient(c, 8, 1, 25, 8, [p.highlight, p.light, p.base, p.shade, p.deep]);
    c.fill();
    c.beginPath();
    c.moveTo(9, 6.4);
    c.bezierCurveTo(14, 1.7, 23, 1.4, 28, 4);
    c.strokeStyle = p.light;
    c.lineWidth = 0.6;
    c.stroke();
    c.restore();
}

function chamber(
    c: CanvasRenderingContext2D,
    item: RemasteredInstance,
    time: number,
    changing = false,
    foregroundOnly = false,
) {
    if (changing) {
        suitChamber(c, item, foregroundOnly);
        return;
    }
    const { x, y, w, h } = item,
        p = spectrumPalette(69);
    // A clear opening makes the original walkable chamber legible at a glance.
    if (!foregroundOnly) {
        box(c, x + 1, y + 1, w - 2, h - 2, '#07141e', 4);
        box(c, x + 4, y + 4, w - 8, h - 8, gradient(c, x, y, w, h, [p.deep, '#07111b', p.deep]), 3);
    }
    for (const side of [x + 1, x + w - 6]) {
        box(c, side, y + 3, 5, h - 5, gradient(c, side, y, 5, 0, [p.light, p.base, p.deep]), 1.6);
        for (let yy = y + 8; yy < y + h - 3; yy += 7) {
            box(c, side + 1.3, yy, 2.3, 1.3, p.highlight, 0.4);
            glow(c, side + 2.5, yy + 0.5, 3, `${p.base}55`);
        }
    }
    box(c, x + 3, y + 1, w - 6, 5, gradient(c, x, y, 0, 5, [p.highlight, p.base, p.deep]), 2);
    box(c, x + 3, y + h - 4, w - 6, 3, p.base, 0.6);
    if (foregroundOnly) return;
    c.save();
    c.beginPath();
    c.rect(x + 6, y + 7, w - 12, h - 12);
    c.clip();
    const scan =
        (((time * 0.012) % Math.max(1, h - 10)) + Math.max(1, h - 10)) % Math.max(1, h - 10);
    for (let yy = y + 8; yy < y + h - 5; yy += 3)
        line(
            c,
            [
                [x + 7, yy],
                [x + w - 7, yy],
            ],
            '#70f8ff18',
            0.35,
        );
    glow(c, x + w / 2, y + 7 + scan, w * 0.45, '#66eeff44');
    line(
        c,
        [
            [x + 6, y + 7 + scan],
            [x + w - 6, y + 7 + scan],
        ],
        '#aaffff99',
        0.6,
    );
    c.restore();
}

function lamp(c: CanvasRenderingContext2D, object: ScreenObject, time: number) {
    const x = object.x * 8,
        y = object.y * 8;
    const phase = (((time / 900) % 4) + 4) % 4,
        index = Math.floor(phase),
        part = phase - index;
    const blend = part * part * (3 - 2 * part);
    const color =
        '#' +
        LAMP_COLORS[index]
            .map((channel, i) =>
                Math.round(channel + (LAMP_COLORS[(index + 1) % 4][i] - channel) * blend)
                    .toString(16)
                    .padStart(2, '0'),
            )
            .join('');
    box(c, x + 2, y + 5, 4, 2.5, '#4f5136', 0.6);
    oval(c, x + 4, y + 3.5, 2.2, 2.3, '#29362e');
    oval(c, x + 4, y + 3.3, 1.5, 1.6, color);
    glow(c, x + 4, y + 3.3, 5, `${color}77`);
    oval(c, x + 3.6, y + 2.8, 0.45, 0.5, '#fffbe2');
}

function machines(c: CanvasRenderingContext2D, state: GameState, time: number) {
    const destroyed = new Set(state.destroyed || []);
    const inactive = new Set(
        (state.objects || []).filter((object) => !object.active).map((object) => object.instance),
    );
    for (const object of state.objects || []) {
        if (destroyed.has(object.instance!)) continue;
        const x = object.x * 8,
            y = object.y * 8;
        if (object.type === 5) {
            // The object row marks the floor surface: only the base is buried.
            box(c, x + 0.5, y - 4, 15, 4, '#42361a', 1);
            box(
                c,
                x + 1,
                y - 5,
                14,
                3,
                gradient(c, x, y - 7, 0, 6, ['#fff6aa', '#d0ae32', '#80601e']),
                1.2,
            );
            for (let stripe = 0; stripe < 4; stripe++)
                line(
                    c,
                    [
                        [x + 3 + stripe * 3, y - 4.7],
                        [x + 1 + stripe * 3, y - 2.4],
                    ],
                    '#332a16',
                    1,
                );
            const color = object.active ? '#ff4c5a' : '#efaa4c';
            oval(c, x + 8, y - 5.4, 1.2, 0.8, color);
            glow(c, x + 8, y - 5.4, 3, `${color}55`);
        }
        if (!object.active) continue;
        if (object.type === 3) {
            // The original 16×8 glyph pairs have a stepped rectangular muzzle,
            // a narrow ribbed shaft and eight one-pixel recoil positions.
            const recoil = [0, 1, 2, 3, 4, 5, 6, 7, 0][(object.phase || 1) - 1] ?? 0,
                bx = x + recoil;
            c.save();
            c.beginPath();
            c.rect(x, y, 16, 8);
            c.clip();
            box(
                c,
                bx + 5.8,
                y + 3,
                16 - recoil - 5.8,
                1.3,
                gradient(c, x, y + 3, 0, 1.3, ['#fff9ad', '#c5a923', '#53461c']),
                0.12,
            );
            for (let xx = bx + 6; xx < x + 16; xx += 2)
                box(c, xx, y + 4.1, 0.65, 0.9, '#ad9632', 0.05);
            box(
                c,
                bx,
                y + 2,
                5,
                3,
                gradient(c, bx, y + 2, 0, 3, ['#fff59c', '#d7ba43', '#786225']),
                0.1,
            );
            box(c, bx + 1, y + 0.1, 2, 0.8, '#fff59c', 0.05);
            for (const dx of [0, 2, 4]) box(c, bx + dx, y + 5, 0.7, 0.85, '#bca342', 0.05);
            line(
                c,
                [
                    [bx + 0.2, y + 2.3],
                    [bx + 4.8, y + 2.3],
                ],
                '#fffbd1',
                0.25,
            );
            line(
                c,
                [
                    [bx + 0.2, y + 2.5],
                    [bx + 0.2, y + 4.7],
                ],
                '#f4dc83',
                0.25,
            );
            c.restore();
        } else if (object.type === 4) {
            lamp(c, object, time);
        } else if (object.type === 10) {
            const py = (object.y + (object.yOffset || 0)) * 8;
            // Original foreground masks hide the whole 8×8 cell, including
            // blank source glyphs and the pump's own floor marker.
            c.save();
            c.beginPath();
            for (
                let row = Math.max(0, Math.floor(py / 8));
                row < Math.min(22, Math.ceil((py + 32) / 8));
                row++
            ) {
                for (
                    let column = Math.max(0, Math.floor(x / 8));
                    column < Math.min(32, Math.ceil((x + 24) / 8));
                    column++
                ) {
                    const tile = state.screen.tiles[row * 32 + column];
                    const present =
                        tile &&
                        !destroyed.has(tile.instance!) &&
                        !([18, 19, 20].includes(tile.block) && inactive.has(tile.instance));
                    if (!present || tile.overlay !== 0) c.rect(column * 8, row * 8, 8, 8);
                }
            }
            c.clip();
            box(
                c,
                x + 8.5,
                py + 2,
                7,
                22,
                gradient(c, x + 8, py, 7, 0, ['#b6f28f', '#3ba956', '#11452f']),
                1,
            );
            box(
                c,
                x + 2,
                py,
                20,
                7,
                gradient(c, x, py, 0, 7, ['#cbffa6', '#51c658', '#174a35']),
                2,
            );
            for (const xx of [x + 3, x + 18]) box(c, xx, py + 20, 3, 9, '#4cc369', 0.8);
            box(c, x + 2, py + 26, 20, 5.5, '#153c30', 1);
            line(
                c,
                [
                    [x + 3, py + 27],
                    [x + 21, py + 27],
                ],
                '#a4f7a0',
                0.7,
            );
            for (let yy = py + 9; yy < py + 22; yy += 3)
                line(
                    c,
                    [
                        [x + 9, yy],
                        [x + 15, yy],
                    ],
                    '#143a2b',
                    1,
                );
            c.restore();
        } else if (object.type === 15) {
            for (let n = 0; n < 8; n++) {
                const px = x + 2 + n * 3.8,
                    py = y + 7 + Math.sin(time * 0.008 + n * 2.3) * 5;
                line(
                    c,
                    [
                        [px, y + 7],
                        [px + 2, py],
                        [px + 3.5, y + 7],
                    ],
                    n & 1 ? '#d991ff' : '#91ffff',
                    0.55,
                );
            }
        } else if (object.type === 17 && object.length > 0) {
            const by = y + 8,
                height = object.length * 8,
                hits = Math.max(0, Math.min(25, object.hits || 0));
            const pulse = 0.7 + Math.sin(time * 0.024 + object.id) * 0.3;
            c.save();
            c.globalAlpha *= 1 - hits / 25;
            const beam = c.createLinearGradient(x, 0, x + 8, 0);
            beam.addColorStop(0, '#ee25ff00');
            beam.addColorStop(0.25, '#ed44f077');
            beam.addColorStop(0.45, '#d5ffff');
            beam.addColorStop(0.55, '#ffffff');
            beam.addColorStop(0.75, '#55dfff88');
            beam.addColorStop(1, '#32aaff00');
            c.fillStyle = beam;
            c.fillRect(x, by, 8, height);
            for (let yy = by + ((time * 0.05) % 8); yy < by + height; yy += 8)
                oval(c, x + 4, yy, 2.2 * pulse, 0.5, '#d9ffff');
            glow(c, x + 4, by, 6, '#b9ffff88');
            glow(c, x + 4, by + height, 6, '#d474ff88');
            c.restore();
        } else if (object.type === 2 && object.block !== 2) {
            const pulse = Math.sin(time * 0.016 + object.id),
                length = 12 + pulse * 2;
            const fire = gradient(c, x, y + 8, 0, length, [
                '#fffadc',
                '#ffcc62dd',
                '#ff427c77',
                '#c120ff00',
            ]);
            c.fillStyle = fire;
            c.beginPath();
            c.moveTo(x + 1, y + 8);
            c.bezierCurveTo(x - 1, y + 12, x + 5 + pulse, y + 16, x + 4 + pulse, y + 8 + length);
            c.bezierCurveTo(x + 6, y + 15, x + 9, y + 11, x + 7, y + 8);
            c.closePath();
            c.fill();
        }
    }
}

function stationaryItem(c: CanvasRenderingContext2D, item: RemasteredInstance, contours: Contours) {
    if (PLANETS.has(item.block) || item.block === 12) return;
    if (item.block === 2) {
        c.save();
        c.translate(item.x, item.y);
        drawSpacecraft(c, {
            cyan: spectrumPalette(69),
            white: spectrumPalette(71),
            yellow: spectrumPalette(70),
            red: spectrumPalette(66),
        });
        c.restore();
    } else if ([18, 19, 20].includes(item.block)) supply(c, item);
    else if (item.block === 29) chamber(c, item, 0, true);
    else if (!redrawnSurface(c, item)) surface(c, item, contours);
}

/** Draws scenery only. Physics, moving actors and the HUD belong to the caller. */
export function drawRemasteredScene(
    c: CanvasRenderingContext2D,
    state: GameState,
    _graphics: Graphics,
    visualTimeMs = 0,
    cache?: RemasteredLayerCache,
) {
    const time = Number.isFinite(visualTimeMs) ? visualTimeMs : 0;
    const items = instances(state),
        contours = state.world.contours || [];
    cache?.prepare(items, state.world.contours);
    function paint(id: number, draw: (context: CanvasRenderingContext2D) => void) {
        if (cache) cache.draw(c, id, draw);
        else draw(c);
    }
    c.save();
    try {
        c.beginPath();
        c.rect(0, 0, 256, 176);
        c.clip();
        c.lineJoin = 'round';
        c.lineCap = 'round';
        paint(0, (context) => spaceBackground(context));
        stars(c, time, (state.screenIndex || 0) + 1);
        paint(1, (context) => {
            for (const item of items)
                if (PLANETS.has(item.block)) {
                    planet(
                        context,
                        item.x + item.w / 2,
                        item.y + item.h / 2,
                        Math.min(item.w, item.h) / 2 - 0.4,
                        dominantAttribute(item.tiles),
                        item.block * 97 + item.instance!,
                    );
                }
        });
        let first = 0,
            layer = 2;
        function stationaryRange(end: number) {
            if (first === end) return;
            const start = first;
            paint(layer++, (context) => {
                for (let index = start; index < end; index++)
                    stationaryItem(context, items[index], contours);
            });
            first = end;
        }
        for (const [index, item] of items.entries()) {
            if (item.block === 2) {
                stationaryRange(index + 1);
                c.save();
                c.translate(item.x, item.y);
                drawSpacecraftEngines(c, time, item.instance);
                c.restore();
            } else if (item.block === 17) {
                stationaryRange(index);
                chamber(c, item, time);
                first = index + 1;
            }
        }
        stationaryRange(items.length);
        machines(c, state, time);
    } finally {
        c.restore();
    }
}

/** Source foreground objects cover actors; openings in modern artwork stay clear. */
export function drawRemasteredForeground(
    c: CanvasRenderingContext2D,
    state: GameState,
    visualTimeMs = 0,
    cache?: RemasteredLayerCache,
) {
    const items = instances(state);
    cache?.prepare(items, state.world.contours);
    c.save();
    c.beginPath();
    c.rect(0, 0, 256, 176);
    c.clip();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    function stationaryForeground(context: CanvasRenderingContext2D) {
        for (const item of items) {
            if (item.block === 29) suitChamber(context, item, true);
            else if (item.block === 17) {
                chamber(context, item, 0, false, true);
            } else if (item.tiles.some((tile) => tile.overlay === 0)) {
                if ([18, 19, 20].includes(item.block)) supply(context, item);
                else if (item.block === 21) sphereChamber(context, item, true);
                else if (COLUMNS.has(item.block) || SUPPORTS.has(item.block)) {
                    redrawnSurface(context, item);
                }
            }
        }
    }
    if (cache) cache.draw(c, -1, stationaryForeground);
    else stationaryForeground(c);
    const supports = new Set(
        items
            .filter(
                (item) =>
                    item.block === 17 ||
                    ((COLUMNS.has(item.block) || SUPPORTS.has(item.block)) &&
                        item.tiles.some((tile) => tile.overlay === 0)),
            )
            .map((item) => item.instance),
    );
    // These fixtures belong to the foreground supports, above their metalwork.
    for (const object of state.objects || [])
        if (object.type === 4 && object.active && supports.has(object.instance))
            lamp(c, object, visualTimeMs);
    c.restore();
}

const GLYPHS: Record<string, VectorPath[]> = {
    E: [
        [
            [0, 0],
            [26, 0],
            [26, 6],
            [8, 6],
            [8, 12],
            [22, 12],
            [22, 18],
            [8, 18],
            [8, 25],
            [26, 25],
            [26, 32],
            [0, 32],
        ],
    ],
    X: [
        [
            [0, 0],
            [9, 0],
            [14, 10],
            [19, 0],
            [28, 0],
            [19, 16],
            [28, 32],
            [19, 32],
            [14, 22],
            [9, 32],
            [0, 32],
            [9, 16],
        ],
    ],
    O: [
        [
            [6, 0],
            [22, 0],
            [28, 6],
            [28, 26],
            [22, 32],
            [6, 32],
            [0, 26],
            [0, 6],
        ],
        [
            [9, 7],
            [9, 25],
            [19, 25],
            [19, 7],
        ],
    ],
    L: [
        [
            [0, 0],
            [8, 0],
            [8, 25],
            [26, 25],
            [26, 32],
            [0, 32],
        ],
    ],
    N: [
        [
            [0, 32],
            [0, 0],
            [8, 0],
            [20, 19],
            [20, 0],
            [28, 0],
            [28, 32],
            [20, 32],
            [8, 13],
            [8, 32],
        ],
    ],
};

function logo(c: CanvasRenderingContext2D, y: number, scale = 1) {
    c.save();
    c.translate(128 - 94 * scale, y);
    c.scale(scale, scale);
    for (const [index, letter] of [...'EXOLON'].entries()) {
        c.save();
        c.translate(index * 32, 0);
        c.beginPath();
        for (const points of GLYPHS[letter]) {
            points.forEach(([x, yy], n) => (n ? c.lineTo(x, yy) : c.moveTo(x, yy)));
            c.closePath();
        }
        c.fillStyle = gradient(c, 0, 0, 0, 32, ['#fff9d1', '#f4ebaf', '#87dfe9', '#3382b7']);
        c.fill('evenodd');
        c.strokeStyle = '#e2ffff';
        c.lineWidth = 0.45;
        c.stroke();
        c.save();
        c.clip('evenodd');
        c.fillStyle = '#07162699';
        c.fillRect(0, 15.3, 28, 1);
        line(
            c,
            [
                [0, 30.8],
                [28, 30.8],
            ],
            '#11374e',
            1.4,
        );
        c.restore();
        c.restore();
    }
    c.restore();
}

function menuPlanets(c: CanvasRenderingContext2D, compact = false) {
    const orbs = compact
        ? [
              [13, 36, 16, 66],
              [242, 75, 21, 69],
              [7, 148, 24, 67],
              [248, 175, 15, 70],
          ]
        : [
              [11, 11, 11, 70],
              [49, 17, 7, 69],
              [90, 19, 15, 67],
              [146, 8, 10, 68],
              [185, 21, 7, 69],
              [231, 17, 17, 66],
              [35, 49, 12, 68],
              [117, 47, 7, 70],
              [176, 47, 12, 67],
              [235, 58, 8, 69],
              [10, 95, 16, 69],
              [243, 101, 12, 67],
              [25, 164, 17, 66],
              [88, 141, 13, 68],
              [175, 144, 12, 70],
              [232, 164, 19, 69],
              [126, 181, 10, 67],
          ];
    orbs.forEach(([x, y, r, attribute], id) => planet(c, x, y, r, attribute, id + 11, id === 4));
}

function card(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    box(c, x, y, w, h, gradient(c, x, y, w, h, ['#142b40ee', '#081323f5', '#101d32f5']), 5);
    line(
        c,
        [
            [x + 5, y + 0.4],
            [x + w - 5, y + 0.4],
        ],
        '#70bedb99',
        0.65,
    );
    line(
        c,
        [
            [x + 5, y + h - 0.4],
            [x + w - 5, y + h - 0.4],
        ],
        '#274764',
        0.65,
    );
}

/** Full-screen menus, except gameOver which is a card over the current scene. */
export function drawRemasteredMenu(
    c: CanvasRenderingContext2D,
    _graphics: Graphics,
    visualTimeMs = 0,
    options: MenuOptions = {},
) {
    const time = Number.isFinite(visualTimeMs) ? visualTimeMs : 0;
    const {
        kind: requestedKind = 'title',
        rows = [],
        offset = 0,
        playerName = '',
        state,
        bonus = state?.bonus || {},
    } = options;
    const kind = requestedKind === 'menu' ? 'title' : requestedKind;
    c.save();
    try {
        c.beginPath();
        c.rect(0, 0, 256, 192);
        c.clip();
        c.lineJoin = 'round';
        c.lineCap = 'round';
        if (kind === 'gameOver') {
            c.fillStyle = '#02071199';
            c.fillRect(0, 0, 256, 176);
            card(c, 29, 57, 198, 75);
            text(c, 'MISSION ENDED', 128, 76, 15, '#ffe1c3');
            text(
                c,
                `FINAL SCORE  ${String(state?.score || 0).padStart(6, '0')}`,
                128,
                98,
                9,
                '#b7efff',
            );
            text(c, 'PRESS ESC FOR MENU', 128, 119, 6.5, '#acbdd1');
            return;
        }
        const reserved = kind === 'scores' ? [42, 32, 214, 192] : null;
        space(c, time, 87, 192, reserved);
        menuPlanets(c, kind !== 'title');
        if (kind === 'title') {
            glow(c, 128, 90, 105, '#278aac26');
            text(c, 'REMASTERED', 128, 65, 7.2, '#b5dfe9');
            logo(c, 76, 1.05);
            line(
                c,
                [
                    [44, 117],
                    [212, 117],
                ],
                '#7ab9c86b',
                0.4,
            );
            const opacity = 0.65 + Math.sin(time * 0.003) * 0.25;
            c.globalAlpha = opacity;
            text(c, 'PRESS FIRE TO BEGIN', 128, 155, 8, '#ffffff');
            c.globalAlpha = 1;
        } else if (kind === 'scores') {
            logo(c, 3, 0.45);
            text(c, 'HALL OF FAME', 128, 26, 6.5, '#c1eefa');
            card(c, 43, 32, 170, 163);
            c.save();
            c.beginPath();
            c.rect(48, 36, 160, 156);
            c.clip();
            rows.forEach((row, index) => {
                const y = 44 + index * 16 - Math.floor(offset * 16);
                if (y < 29 || y > 201) return;
                const rank = index + 1;
                text(c, String(rank).padStart(2, '0'), 53, y, 5.5, '#7393b2', 'left');
                text(c, String(row.name || '').slice(0, 8), 72, y, 7, '#d6f5ff', 'left');
                text(c, String(row.score || 0).padStart(6, '0'), 202, y, 7, '#8be0c3', 'right');
                line(
                    c,
                    [
                        [54, y + 7],
                        [202, y + 7],
                    ],
                    '#29405966',
                    0.35,
                );
            });
            c.restore();
        } else if (kind === 'hallOfFame') {
            logo(c, 15, 0.65);
            card(c, 25, 57, 206, 103);
            text(
                c,
                state?.status === 'won' ? 'MISSION COMPLETE' : 'A PLACE AMONG THE STARS',
                128,
                73,
                9,
                '#ffe4a1',
            );
            text(c, 'HALL OF FAME', 128, 92, 7, '#87dbed');
            text(c, 'ENTER YOUR NAME', 128, 109, 6, '#a7bed5');
            const name = Array.from(String(playerName || '').toUpperCase()).slice(0, 8);
            for (let index = 0; index < 8; index++) {
                const x = 69 + index * 16.8;
                box(c, x - 6.5, 121, 13, 17, '#081422', 1.8);
                line(
                    c,
                    [
                        [x - 5, 138],
                        [x + 5, 138],
                    ],
                    index === name.length ? '#afffff' : '#405f76',
                    0.7,
                );
                text(
                    c,
                    name[index] ||
                        (index === name.length && Math.floor(time / 450) % 2 === 0 ? '_' : '·'),
                    x,
                    129,
                    10,
                    '#eaffff',
                );
            }
            text(c, 'PRESS ENTER TO CONFIRM', 128, 150, 5.6, '#acc3d6');
            if (state)
                text(
                    c,
                    `SCORE ${String(state.score || 0).padStart(6, '0')}`,
                    128,
                    176,
                    8,
                    '#a9f0de',
                );
        } else if (kind === 'bonus') {
            text(c, 'SECTOR COMPLETE', 128, 20, 12, '#fff0bf');
            text(c, `STAGE ${state?.stage || 1}  /  MISSION BONUS`, 128, 36, 6, '#b4d8ec');
            card(c, 27, 47, 202, 132);
            const entries = [
                ['LIVES', bonus.lifePoints ?? bonus.base ?? 0],
                ['BRAVERY', bonus.braveryPoints ?? bonus.bravery ?? 0],
            ];
            entries.forEach(([label, points], index) => {
                text(c, label, 42, 61 + index * 14, 6.5, '#b2cadf', 'left');
                text(
                    c,
                    String(points).padStart(6, '0'),
                    213,
                    61 + index * 14,
                    7,
                    '#b4ffe2',
                    'right',
                );
            });
            line(
                c,
                [
                    [41, 86],
                    [215, 86],
                ],
                '#3c5d73',
                0.5,
            );
            const cursor = (bonus.cursor || 0) & 7;
            for (let index = 0; index < 8; index++) {
                const x = 49 + (index % 4) * 52,
                    y = 102 + Math.floor(index / 4) * 26,
                    selected = index === cursor;
                box(c, x - 18, y - 10, 40, 21, selected ? '#34657a' : '#132b3d', 2.5);
                if (selected) {
                    line(
                        c,
                        [
                            [x - 15, y - 9],
                            [x + 19, y - 9],
                        ],
                        '#d5ffff',
                        1,
                    );
                    glow(c, x + 2, y, 19, '#81dfff22');
                }
                text(
                    c,
                    [0, 1000, 0, 3000, 0, 5000, 0, 7000][index],
                    x + 2,
                    y,
                    7,
                    selected ? '#ffffff' : '#6f9db6',
                );
            }
            text(c, `TOTAL  ${String(bonus.total || 0).padStart(6, '0')}`, 128, 153, 8, '#ffe7a3');
            text(c, 'PRESS FIRE TO STOP', 128, 169, 6, '#c3deef');
        }
    } finally {
        c.restore();
    }
}
