import type { Bytes, Rgba, GraphicTile, SpectrumScreen } from '../types/graphics.ts';
// Source bitmap/attribute decoder. The optional nativePixels path stores
// independent four-bit pixels; only the ZX path applies attribute-cell colors.
const pixelInk = (attribute: number) => (attribute & 7) | (attribute & 64 ? 8 : 0);
export function createScreen(): SpectrumScreen {
    return {
        bits: new Uint8Array(256 * 192),
        attributes: new Uint8Array(768),
        background: new Uint8Array(768),
        allowed: new Uint8Array(768).fill(255),
    };
}
export function copyScreen(
    source: SpectrumScreen,
    { independentSprites = false, nativePixels = false } = {},
) {
    const screen: SpectrumScreen = {
        bits: source.bits.slice(),
        attributes: source.attributes.slice(),
        background: source.background.slice(),
        allowed: source.allowed.slice(),
    };
    // Optional per-pixel foreground for the imagined Color handheld. The ZX
    // path keeps its original attribute-cell and XOR behavior.
    if (independentSprites || source.spriteColors)
        screen.spriteColors = source.spriteColors?.slice() || new Int16Array(256 * 192).fill(-1);
    if (nativePixels || source.nativePixels) {
        screen.nativePixels = source.nativePixels?.slice() || new Uint8Array(256 * 192);
        if (!source.nativePixels)
            for (let y = 0; y < 192; y++)
                for (let x = 0; x < 256; x++) {
                    const offset = y * 256 + x;
                    screen.nativePixels[offset] = source.bits[offset]
                        ? pixelInk(source.attributes[(y >> 3) * 32 + (x >> 3)])
                        : 0;
                }
    }
    return screen;
}
export function putTile(screen: SpectrumScreen, tile: GraphicTile) {
    const { x, y, bitmap } = tile;
    if (x < 0 || x >= 32 || y < 0 || y >= 24) return;
    const cell = y * 32 + x;
    screen.attributes[cell] = tile.color || 0;
    if (tile.overlay !== undefined) screen.allowed[cell] = tile.overlay;
    for (let row = 0; row < 8; row++)
        for (let bit = 0; bit < 8; bit++) {
            const pixel = (y * 8 + row) * 256 + x * 8 + bit;
            screen.bits[pixel] = (bitmap[row] >> (7 - bit)) & 1;
            if (screen.nativePixels)
                screen.nativePixels[pixel] = screen.bits[pixel] ? pixelInk(tile.color || 0) : 0;
            if (screen.spriteColors) screen.spriteColors[pixel] = -1;
        }
}
export function freezeBackground(screen: SpectrumScreen) {
    screen.background.set(screen.attributes);
}
export function paintAttribute(
    screen: SpectrumScreen,
    x: number,
    y: number,
    width: number,
    height: number,
    color: number,
) {
    if (screen.spriteColors || screen.nativePixels) return;
    for (
        let row = Math.max(0, Math.floor(y / 8));
        row < Math.min(22, Math.ceil((y + height) / 8));
        row++
    ) {
        for (
            let column = Math.max(0, Math.floor(x / 8));
            column < Math.min(32, Math.ceil((x + width) / 8));
            column++
        ) {
            const offset = row * 32 + column;
            if (screen.background[offset] === 0) screen.attributes[offset] = color;
        }
    }
}
export function xorSprite(
    screen: SpectrumScreen,
    bitmap: Bytes,
    width: number,
    height: number,
    x: number,
    y: number,
    color: number | null,
    { mirror = false, foreground = true } = {},
) {
    x = Math.trunc(x);
    y = Math.trunc(y);
    const stride = width / 8;
    for (let row = 0; row < height; row++)
        for (let column = 0; column < width; column++) {
            const px = x + column,
                py = y + row;
            if (px < 0 || px >= 256 || py < 0 || py >= 176) continue;
            const sourceX = mirror ? width - 1 - column : column;
            if (!(bitmap[row * stride + (sourceX >> 3)] & (128 >> (sourceX & 7)))) continue;
            if (foreground && !screen.allowed[(py >> 3) * 32 + (px >> 3)]) continue;
            if (screen.nativePixels) screen.nativePixels[py * 256 + px] ^= pixelInk(color ?? 0x47);
            else if (screen.spriteColors) screen.spriteColors[py * 256 + px] = color ?? 0x47;
            else screen.bits[py * 256 + px] ^= 1;
        }
    if (color !== null && color !== undefined) paintAttribute(screen, x, y, width, height, color);
}
export function putText(
    screen: SpectrumScreen,
    font: Bytes,
    text: string,
    x: number,
    y: number,
    color = 0x47,
    { offsetY = 0, clipTop = 0, clipBottom = 192, keepAttributes = false } = {},
) {
    for (const [index, char] of Array.from(text.toUpperCase()).entries()) {
        const code = char.charCodeAt(0);
        const glyph = code >= 32 && code <= 90 ? code - 32 : 31;
        const px = (x + index) * 8,
            py = y * 8 + Math.trunc(offsetY);
        for (let row = 0; row < 8; row++)
            for (let bit = 0; bit < 8; bit++) {
                const xx = px + bit,
                    yy = py + row;
                if (xx < 0 || xx >= 256 || yy < clipTop || yy >= clipBottom) continue;
                const offset = yy * 256 + xx;
                screen.bits[offset] = (font[glyph * 8 + row] >> (7 - bit)) & 1;
                if (screen.nativePixels)
                    screen.nativePixels[offset] = screen.bits[offset]
                        ? pixelInk(
                              keepAttributes
                                  ? screen.attributes[(yy >> 3) * 32 + (xx >> 3)]
                                  : color,
                          )
                        : 0;
                if (screen.spriteColors) screen.spriteColors[yy * 256 + xx] = -1;
                if (!keepAttributes) screen.attributes[(yy >> 3) * 32 + (xx >> 3)] = color;
            }
    }
}
export function fromScr(bytes: Bytes) {
    if (bytes.length !== 6912) throw new RangeError('A Spectrum screen must contain 6912 bytes.');
    const screen = createScreen();
    screen.attributes.set(bytes.slice(6144));
    for (let y = 0; y < 192; y++)
        for (let x = 0; x < 256; x++) {
            const address = ((y & 192) << 5) | ((y & 7) << 8) | ((y & 56) << 2) | (x >> 3);
            screen.bits[y * 256 + x] = (bytes[address] >> (7 - (x & 7))) & 1;
        }
    freezeBackground(screen);
    return screen;
}
export function toRgba(
    screen: SpectrumScreen,
    flash = false,
    output: Rgba = new Uint8ClampedArray(256 * 192 * 4),
) {
    for (let y = 0; y < 192; y++)
        for (let x = 0; x < 256; x++) {
            const spriteColor = screen.spriteColors?.[y * 256 + x] ?? -1;
            const attribute =
                spriteColor >= 0 ? spriteColor : screen.attributes[(y >> 3) * 32 + (x >> 3)];
            const ink =
                spriteColor >= 0 ||
                Boolean(screen.bits[y * 256 + x]) !== Boolean(flash && attribute & 128);
            const color = ink ? attribute & 7 : (attribute >> 3) & 7;
            const level = attribute & 64 ? 255 : 205;
            const offset = (y * 256 + x) * 4;
            output[offset] = color & 2 ? level : 0;
            output[offset + 1] = color & 4 ? level : 0;
            output[offset + 2] = color & 1 ? level : 0;
            output[offset + 3] = 255;
        }
    return output;
}
