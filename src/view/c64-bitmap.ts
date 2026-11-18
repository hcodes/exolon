import type { Bytes, Rgba, GraphicTile, NativeSurface } from '../types/graphics.ts';
// Original C64 data uses VIC-II multicolor pairs. Display uses the documented
// Pepto PAL digital palette (https://www.pepto.de/projects/colorvic/), not an
// assertion about a particular analog monitor or chip revision.
const PALETTE = [
    '000000',
    'ffffff',
    '68372b',
    '70a4b2',
    '6f3d86',
    '588d43',
    '352879',
    'b8c76f',
    '6f4f25',
    '433900',
    '9a6759',
    '444444',
    '6c6c6c',
    '9ad284',
    '6c5eb5',
    '959595',
].map((hex) => [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)));

export function createC64Surface(): NativeSurface {
    return { pixels: new Uint8Array(256 * 192), allowed: new Uint8Array(768).fill(255) };
}

export function putC64Cell(surface: NativeSurface, tile: GraphicTile) {
    const { x, y, bitmap, color = 0, ramColor = 0 } = tile;
    if (x < 0 || x >= 32 || y < 0 || y >= 24) return;
    const colors = [0, (color >> 4) & 15, color & 15, ramColor & 15];
    for (let row = 0; row < 8; row++)
        for (let column = 0; column < 8; column++) {
            surface.pixels[(y * 8 + row) * 256 + x * 8 + column] =
                colors[((bitmap[row] || 0) >> (6 - (column >> 1) * 2)) & 3];
        }
}

export function blitC64Sprite(
    surface: NativeSurface,
    bitmap: Bytes,
    width: number,
    height: number,
    x: number,
    y: number,
    color = 1,
    { mirror = false, multicolor = false, foreground = true, clipBottom = 176 } = {},
) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    const colors = [0, 2, color & 15, 1],
        stride = width / 8;
    for (let row = 0; row < height; row++)
        for (let column = 0; column < width; column++) {
            const px = x + column,
                py = y + row;
            if (
                px < 0 ||
                px >= 256 ||
                py < 0 ||
                py >= clipBottom ||
                (foreground && !surface.allowed[(py >> 3) * 32 + (px >> 3)])
            )
                continue;
            const sx = mirror ? width - 1 - column : column,
                byte = bitmap[row * stride + (sx >> 3)] || 0;
            const bits = multicolor
                ? (byte >> (6 - ((sx & 7) >> 1) * 2)) & 3
                : (byte >> (7 - (sx & 7))) & 1;
            if (bits) surface.pixels[py * 256 + px] = multicolor ? colors[bits] : color & 15;
        }
}

export function toC64Rgba(
    surface: NativeSurface,
    output: Rgba = new Uint8ClampedArray(256 * 192 * 4),
) {
    for (let i = 0; i < surface.pixels.length; i++) {
        const color = PALETTE[surface.pixels[i] & 15],
            offset = i * 4;
        output[offset] = color[0];
        output[offset + 1] = color[1];
        output[offset + 2] = color[2];
        output[offset + 3] = 255;
    }
    return output;
}
