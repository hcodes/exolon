import type { Rgba } from '../types/graphics.ts';
// Imagined Game Boy styling of the shared ZX raster. These are chosen LCD-green
// display shades, not recovered Game Boy assets or an emulation of its hardware.
export const GAMEBOY_PALETTE = Object.freeze([
    Object.freeze([15, 56, 15]),
    Object.freeze([48, 98, 48]),
    Object.freeze([139, 172, 15]),
    Object.freeze([155, 188, 15]),
]);
const DITHER = [-0.375, 0.125, 0.375, -0.125];

export function toGameBoyRgba(
    source: Rgba,
    width: number,
    output: Rgba = new Uint8ClampedArray(source.length),
) {
    if (
        !Number.isInteger(width) ||
        width <= 0 ||
        source.length % (width * 4) !== 0 ||
        output.length !== source.length
    )
        throw new RangeError('Incomplete Game Boy display scanlines.');
    for (let offset = 0; offset < source.length; offset += 4) {
        const r = source[offset] / 255,
            g = source[offset + 1] / 255,
            b = source[offset + 2] / 255;
        const peak = Math.max(r, g, b),
            pixel = offset >> 2;
        // Keep colored source ink distinct from black space, including blue
        // sprites; luminance alone would lose them against the darkest shade.
        const brightness = 0.4 * peak + 0.6 * (0.299 * r + 0.587 * g + 0.114 * b);
        const threshold = DITHER[(Math.floor(pixel / width) & 1) * 2 + ((pixel % width) & 1)];
        const shade =
            peak === 0
                ? 0
                : Math.max(1, Math.min(3, Math.floor(0.5 + 2.5 * brightness + 0.5 + threshold)));
        const color = GAMEBOY_PALETTE[shade];
        output[offset] = color[0];
        output[offset + 1] = color[1];
        output[offset + 2] = color[2];
        output[offset + 3] = 255;
    }
    return output;
}

export function createGameBoyRenderer(canvas: HTMLCanvasElement, convert = toGameBoyRgba) {
    canvas.width = 256;
    canvas.height = 192;
    const context = canvas.getContext('2d')!,
        image = context.createImageData(256, 192);
    context.imageSmoothingEnabled = false;
    return {
        render(source: HTMLCanvasElement) {
            const original = source.getContext('2d')!.getImageData(0, 0, 256, 192);
            convert(original.data, 256, image.data);
            context.putImageData(image, 0, 0);
        },
        reset() {
            context.clearRect(0, 0, 256, 192);
        },
    };
}
