// Compose an OG card from original pixels; normal builds never modify source artwork.
import { readFile } from 'node:fs/promises';
import { decodePng, encodePng } from '../graphics/png.mjs';

export async function createSocialPreview(output) {
    const width = 1200,
        height = 630,
        rgba = new Uint8Array(width * height * 4);
    const put = (x, y, color) => rgba.set([...color, 255], (y * width + x) * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, [8, 12, 18]);
    const art = decodePng(await readFile(new URL('assets/images/zx-spectrum/loading.png', output)));
    for (let y = 0; y < art.height * 2; y++)
        for (let x = 0; x < art.width * 2; x++) {
            const source = (Math.floor(y / 2) * art.width + Math.floor(x / 2)) * 4;
            put(624 + x, 123 + y, art.rgba.subarray(source, source + 3));
        }
    const { font } = JSON.parse(
        await readFile(
            new URL('../../src/assets/graphics/zx-spectrum/graphics.json', import.meta.url),
            'utf8',
        ),
    );
    const text = (label, left, top, scale, color) => {
        for (let i = 0; i < label.length; i++)
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++)
                    if (font[(label.charCodeAt(i) - 32) * 8 + y] & (128 >> x))
                        for (let dy = 0; dy < scale; dy++)
                            for (let dx = 0; dx < scale; dx++)
                                put(left + (i * 8 + x) * scale + dx, top + y * scale + dy, color);
    };
    text('EXOLON', 64, 175, 8, [230, 235, 233]);
    text('PLAY ONLINE', 64, 263, 3, [164, 245, 219]);
    text('ZX SPECTRUM . C64 . CPC', 64, 351, 2, [181, 195, 205]);
    text('AMIGA . ATARI ST . SHARP', 64, 383, 2, [181, 195, 205]);
    text('REMASTERED + SPLIT', 64, 415, 2, [181, 195, 205]);
    const colors = [
        [255, 50, 50],
        [255, 221, 50],
        [50, 221, 90],
        [50, 190, 255],
    ];
    for (let x = 64; x < 448; x++)
        for (let y = 475; y < 481; y++) put(x, y, colors[Math.floor((x - 64) / 96)]);
    return encodePng(width, height, rgba);
}
