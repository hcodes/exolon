import type { Rgba, SpectrumScreen } from '../types/graphics.ts';

// Digital PAL display palette used by mz800emu and the source archive captures.
// https://github.com/MZPico/mz800emu/blob/master/src/emulator/display.c
// Analogue monitor calibration is not simulated. No CPU/GDG emulator runs here.
export const SHARP_PALETTE = Object.freeze(
    [
        '000000',
        '4040ac',
        'd03400',
        'b40c8c',
        '406c00',
        '24ccff',
        'e8d430',
        'd0d0d0',
        '848484',
        '008ce8',
        'ff0000',
        'f054cc',
        '54ff54',
        '80ffff',
        'ffff28',
        'ffffff',
    ].map((hex) =>
        Object.freeze([0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))),
    ),
);
// Original boot writes F0:40,00,19,2A,3B: palette group0 maps inks0..3 to0,9,10,11.
export const SHARP_INK_MAP = Object.freeze([
    0, 9, 10, 11, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);
export const SHARP_WIDTH = 320,
    SHARP_HEIGHT = 200;

export function toSharpRgba(
    screen: SpectrumScreen,
    _flash = false,
    output: Rgba = new Uint8ClampedArray(SHARP_WIDTH * SHARP_HEIGHT * 4),
) {
    if (
        screen.bits.length !== 256 * 192 ||
        screen.attributes.length !== 768 ||
        (screen.nativePixels && screen.nativePixels.length !== 256 * 192) ||
        output.length !== SHARP_WIDTH * SHARP_HEIGHT * 4
    )
        throw new RangeError('Incomplete Sharp MZ-800 raster');
    output.fill(0);
    for (let i = 3; i < output.length; i += 4) output[i] = 255;
    for (let y = 0; y < 192; y++)
        for (let x = 0; x < 256; x++) {
            const offset = y * 256 + x;
            const attribute = screen.attributes[(y >> 3) * 32 + (x >> 3)];
            // Datelsoft writes glyphs with GDG REPLACE, using INK on black.
            // Moving sprites have already XORed the native pixel planes.
            // PAPER and hardware FLASH are ZX features, not Sharp GDG state.
            const logical = screen.nativePixels
                ? screen.nativePixels[offset]
                : screen.bits[offset]
                  ? (attribute & 7) | (attribute & 64 ? 8 : 0)
                  : 0;
            const rgb = SHARP_PALETTE[SHARP_INK_MAP[logical]];
            const target = ((y + 4) * SHARP_WIDTH + x + 32) * 4;
            output[target] = rgb[0];
            output[target + 1] = rgb[1];
            output[target + 2] = rgb[2];
        }
    return output;
}
export function createSharpDisplay(canvas: HTMLCanvasElement) {
    canvas.width = SHARP_WIDTH;
    canvas.height = SHARP_HEIGHT;
    const context = canvas.getContext('2d')!,
        image = context.createImageData(SHARP_WIDTH, SHARP_HEIGHT);
    return {
        render(screen: SpectrumScreen, time = 0) {
            toSharpRgba(screen, Boolean(Math.floor(time / 320) & 1), image.data);
            context.putImageData(image, 0, 0);
        },
        reset() {
            context.clearRect(0, 0, SHARP_WIDTH, SHARP_HEIGHT);
        },
    };
}
