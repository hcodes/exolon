import type { Bytes, Point, GraphicTile, SpectrumScreen } from '../types/graphics.ts';
// Original menu sprites/sequence: Raffaele Cecco / Sergey Erokhin, CC BY-SA 3.0.
import { copyScreen } from './spectrum.ts';

// The 100 ms browser clock and deterministic placement adapt the variable menu loop.
const FRAMES = [12, 12, 14, 13, 14, 14, 15, 15, 15, 14, 14, 13, 13, 12, 12, 0];
const FRAME_MS = 100,
    PERIOD = 17 * FRAME_MS;
const EMPTY_POSITIONS = Array.from({ length: 22 * 16 }, (_, index) => ({
    x: (index % 16) * 16,
    y: (index >> 4) * 8,
}));
// Planet rectangles measured in the original 256×192 loading SCR, including dithering.
const TITLE_PLANETS = [
    [0, 0, 24, 24],
    [133, 0, 24, 24],
    [208, 0, 32, 32],
    [40, 8, 16, 16],
    [72, 8, 32, 32],
    [173, 8, 16, 16],
    [24, 40, 24, 24],
    [104, 40, 16, 16],
    [157, 40, 24, 24],
    [208, 40, 16, 16],
    [224, 72, 24, 24],
    [0, 80, 32, 32],
    [208, 112, 32, 32],
    [72, 120, 32, 32],
    [160, 120, 24, 24],
    [32, 128, 16, 16],
    [240, 144, 16, 16],
    [8, 152, 32, 32],
    [136, 160, 32, 32],
    [96, 168, 24, 24],
    [208, 168, 24, 24],
];
export function createTitleBackground(source: SpectrumScreen, logo: GraphicTile[]) {
    const screen = copyScreen(source),
        artwork = new Uint8Array(256 * 192);
    for (const [x, y, width, height] of [...TITLE_PLANETS, [0, 184, 256, 8]]) {
        for (let row = y; row < Math.min(192, y + height); row++)
            artwork.fill(1, row * 256 + x, row * 256 + x + width);
    }
    // The logo's empty cells also contain baked flares: protect its exact source bits.
    for (const tile of logo)
        for (let row = 0; row < 8; row++)
            for (let bit = 0; bit < 8; bit++) {
                if ((tile.bitmap[row] >> (7 - bit)) & 1)
                    artwork[((tile.y + 10) * 8 + row) * 256 + (tile.x + 8) * 8 + bit] = 1;
            }
    for (let pixel = 0; pixel < screen.bits.length; pixel++)
        if (!artwork[pixel]) screen.bits[pixel] = 0;
    return screen;
}
function hash(value: number) {
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
    return (value ^ (value >>> 16)) >>> 0;
}
function gcd(a: number, b: number) {
    while (b) [a, b] = [b, a % b];
    return a;
}
export function findTitleStarPositions(screen: Pick<SpectrumScreen, 'bits' | 'attributes'>) {
    const occupied = new Uint8Array(768);
    for (let cell = 0; cell < 768; cell++) {
        const attribute = screen.attributes[cell];
        if (attribute & 0x38 || (attribute & 0x80 && attribute & 7)) {
            occupied[cell] = 1;
            continue;
        }
        const x = (cell % 32) * 8,
            y = (cell >> 5) * 8;
        for (let row = 0; row < 8; row++)
            for (let bit = 0; bit < 8; bit++)
                occupied[cell] |= screen.bits[(y + row) * 256 + x + bit];
    }
    return EMPTY_POSITIONS.filter(({ x, y }) => {
        const cell = (y / 8) * 32 + x / 8;
        return !(
            occupied[cell] ||
            occupied[cell + 1] ||
            occupied[cell + 32] ||
            occupied[cell + 33]
        );
    });
}
export function getTitleStars(timeMs = 0, positions: Point[] = EMPTY_POSITIONS) {
    if (!Number.isFinite(timeMs) || timeMs <= 0 || !positions.length) return [];
    const time = Math.min(Number.MAX_SAFE_INTEGER, timeMs),
        stars: (Point & { id: number; frame: number; cycle: number })[] = [];
    for (let id = 0; id < 12; id++) {
        const local = time - id * FRAME_MS;
        if (local < FRAME_MS) continue;
        const cycle = Math.floor(local / PERIOD),
            phase = Math.floor((local % PERIOD) / FRAME_MS);
        const frame = phase ? FRAMES[phase - 1] : 0;
        if (!frame) continue;
        const start = hash(id + 1) % positions.length;
        let stride = hash(id + 37) % positions.length || 1;
        while (gcd(stride, positions.length) !== 1) stride = (stride + 1) % positions.length || 1;
        const position =
            positions[(start + (cycle % positions.length) * stride) % positions.length];
        stars.push({ id, ...position, frame, cycle });
    }
    return stars;
}
export function drawTitleStars(
    screen: SpectrumScreen,
    timeMs: number,
    positions: Point[],
    sprites: Bytes,
) {
    for (const star of getTitleStars(timeMs, positions)) {
        for (let row = 0; row < 16; row++)
            for (let bit = 0; bit < 16; bit++) {
                const ink =
                    (sprites[star.frame * 32 + row * 2 + (bit >> 3)] >> (7 - (bit & 7))) & 1;
                screen.bits[(star.y + row) * 256 + star.x + bit] ^= ink;
            }
        const cell = (star.y / 8) * 32 + star.x / 8;
        for (const offset of [0, 1, 32, 33]) screen.attributes[cell + offset] = 0x47;
    }
}
