import type { Rgba } from '../types/graphics.ts';
// Imagined Game Boy Color presentation, sharing the green version's pixel
// shading. Gameplay supplies independently colored sprite pixels before this
// palette pass. These are new palettes, not assets from a historical Exolon port.
import { GAMEBOY_PALETTE, toGameBoyRgba, createGameBoyRenderer } from './gameboy-renderer.ts';

const rgb5 = (value: number) => Math.round((Math.round((value * 31) / 255) * 255) / 31);
const BACKGROUND = [8, 16, 24];
// Source hue bits: red=1, green=2, blue=4. Each family has three ink shades
// and the same dark background; RGB is reduced to 5 bits per component.
const INKS = [
    [BACKGROUND, BACKGROUND, BACKGROUND],
    [
        [128, 32, 56],
        [224, 72, 72],
        [255, 160, 136],
    ],
    [
        [24, 104, 64],
        [72, 168, 80],
        [168, 224, 112],
    ],
    [
        [128, 88, 40],
        [224, 168, 64],
        [248, 232, 152],
    ],
    [
        [48, 56, 112],
        [72, 112, 208],
        [144, 184, 248],
    ],
    [
        [96, 40, 112],
        [184, 80, 176],
        [232, 160, 224],
    ],
    [
        [16, 96, 120],
        [48, 176, 184],
        [168, 232, 232],
    ],
    [
        [80, 104, 128],
        [168, 192, 200],
        [232, 240, 216],
    ],
];
export const GAMEBOY_COLOR_PALETTES = Object.freeze(
    INKS.map((inks) =>
        Object.freeze([BACKGROUND, ...inks].map((color) => Object.freeze(color.map(rgb5)))),
    ),
);
const SHADE_BY_RED = new Uint8Array(256);
GAMEBOY_PALETTE.forEach((color, index) => {
    SHADE_BY_RED[color[0]] = index;
});

export function toGameBoyColorRgba(
    source: Rgba,
    width: number,
    output: Rgba = new Uint8ClampedArray(source.length),
) {
    // Preserve original hues even when a caller explicitly reuses its input.
    const original = source.buffer === output.buffer ? source.slice() : source;
    toGameBoyRgba(original, width, output);
    for (let offset = 0; offset < original.length; offset += 4) {
        const r = original[offset],
            g = original[offset + 1],
            b = original[offset + 2],
            peak = Math.max(r, g, b);
        const family =
            peak === 0
                ? 0
                : (r >= peak / 2 ? 1 : 0) | (g >= peak / 2 ? 2 : 0) | (b >= peak / 2 ? 4 : 0);
        const color = GAMEBOY_COLOR_PALETTES[family][SHADE_BY_RED[output[offset]]];
        output[offset] = color[0];
        output[offset + 1] = color[1];
        output[offset + 2] = color[2];
    }
    return output;
}
export const createGameBoyColorRenderer = (canvas: HTMLCanvasElement) =>
    createGameBoyRenderer(canvas, toGameBoyColorRgba);
