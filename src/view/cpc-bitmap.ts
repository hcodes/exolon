import type { Bytes, Rgba, SpectrumScreen, NativeSurface } from '../types/graphics.ts';
// CPC Gate Array Mode 0: two interleaved 4-bit pens per byte.
// Amstrad CPC Firmware Guide, section 6.4. Native pixels are twice as wide
// as the shared display coordinate; no Spectrum palette filter is involved.
export function decodeCpcMode0Byte(value: number) {
    return [
        ((value >> 7) & 1) | ((value >> 2) & 2) | ((value >> 3) & 4) | ((value << 2) & 8),
        ((value >> 6) & 1) | ((value >> 1) & 2) | ((value >> 2) & 4) | ((value << 3) & 8),
    ];
}
export function createCpcSurface(): NativeSurface {
    return { pixels: new Uint8Array(256 * 192), allowed: new Uint8Array(768).fill(255) };
}
// The Mode1 loading picture is centered inside a standard 320×200 screen.
// Its four original inks also occur in the gameplay palette at 0/15/5/11.
export function createCpcLoadingSurface(bitmap: Bytes, mask?: Pick<SpectrumScreen, 'bits'>) {
    const surface = createCpcSurface(),
        inks = [0, 15, 5, 11];
    for (let y = 0; y < 192; y++)
        for (let x = 0; x < 256; x++) {
            const sx = x + 32,
                shift = sx & 3,
                value = bitmap[(y & 7) * 2048 + (y >> 3) * 80 + (sx >> 2)];
            const pixel = y * 256 + x,
                ink = ((value >> (7 - shift)) & 1) | (((value >> (3 - shift)) & 1) << 1);
            if (!mask || mask.bits[pixel]) surface.pixels[pixel] = inks[ink];
        }
    return surface;
}
export function blitCpcBitmap(
    surface: NativeSurface,
    bitmap: Bytes,
    width: number,
    height: number,
    x: number,
    y: number,
    { mirror = false, foreground = true, transparent = true, clipBottom = 176, xor = false } = {},
) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    const stride = width / 4;
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
            const sx = mirror ? width - 1 - column : column;
            const value = decodeCpcMode0Byte(bitmap[row * stride + (sx >> 2)] || 0)[(sx >> 1) & 1];
            if (!transparent || value) {
                if (xor) surface.pixels[py * 256 + px] ^= value;
                else surface.pixels[py * 256 + px] = value;
            }
        }
}
export function toCpcRgba(
    surface: NativeSurface,
    palette: number[][],
    output: Rgba = new Uint8ClampedArray(256 * 192 * 4),
) {
    for (let i = 0; i < surface.pixels.length; i++) {
        const color = palette[surface.pixels[i] & 15] || [0, 0, 0],
            offset = i * 4;
        output[offset] = color[0];
        output[offset + 1] = color[1];
        output[offset + 2] = color[2];
        output[offset + 3] = 255;
    }
    return output;
}
