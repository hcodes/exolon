import { GRAPHICS_ASSETS, PLATFORM_IMAGES } from '../../src/constants/assets.ts';
// Reproducible, lossless loading-screen extraction. No redrawing or AI assets.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fromScr, toRgba } from '../../src/view/spectrum.ts';
import { decodePng, encodePng } from './png.mjs';

const root = new URL('../../src/', import.meta.url),
    output = new URL('../../src/', import.meta.url),
    originals = new URL('../../originals/', import.meta.url),
    hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const [zx, cpc] = await Promise.all(
    [GRAPHICS_ASSETS.retro, GRAPHICS_ASSETS.cpc].map(async (file) =>
        JSON.parse(await readFile(new URL(file, root), 'utf8')),
    ),
);
const source = await readFile(
    new URL('images/shared/reference/exolon-loading-comparison.png', originals),
);
if (hash(source) !== 'ed304f41b0876501ef4adc5596a83e6e06bc79af3e59be43ee3e21ff1943298e')
    throw Error('Unexpected archival loading-screen montage');
const original = decodePng(source),
    c64 = new Uint8Array(320 * 200 * 4);
// The archive contains the full C64 screen at exactly 2× nearest-neighbour
// size. Check EVERY 2×2 block before reducing it, preserving source pixels.
for (let y = 0; y < 200; y++)
    for (let x = 0; x < 320; x++) {
        const start = ((466 + y * 2) * original.width + 1381 + x * 2) * 4;
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
                for (let channel = 0; channel < 4; channel++)
                    if (
                        original.rgba[start + (dy * original.width + dx) * 4 + channel] !==
                        original.rgba[start + channel]
                    )
                        throw Error('C64 source is no longer an exact 2x pixel copy');
        c64.set(original.rgba.subarray(start, start + 4), (y * 320 + x) * 4);
    }
const zxPixels = toRgba(fromScr(zx.loading));
const cpcSource = await readFile(
    new URL('images/amstrad-cpc/source/exolon-cpc-loading.png', originals),
);
if (hash(cpcSource) !== 'cb3341adfe0bc033927408e0e47731a5fe505d30bad64176badefe1f0fa6c709')
    throw Error('Unexpected original CPC loading capture');
const cpcCapture = decodePng(cpcSource),
    cpcPixels = new Uint8Array(320 * 200 * 4);
for (let y = 0; y < 200; y++)
    for (let x = 0; x < 320; x++) {
        const start = ((72 + y * 2) * cpcCapture.width + 64 + x * 2) * 4;
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
                for (let channel = 0; channel < 4; channel++)
                    if (
                        cpcCapture.rgba[start + (dy * cpcCapture.width + dx) * 4 + channel] !==
                        cpcCapture.rgba[start + channel]
                    )
                        throw Error('CPC capture no longer has exact 2x pixels');
        cpcPixels.set(cpcCapture.rgba.subarray(start, start + 4), (y * 320 + x) * 4);
    }
// Independent CPC archive confirms the recovered bitmap's entire geometry.
// Its native loading inks are black/red/green/white, unlike the later disk
// palette. The emulator capture places the 192 bitmap rows three lines lower.
for (let y = 0; y < 192; y++)
    for (let x = 0; x < 320; x++) {
        const byte = cpc.loading[(y & 7) * 2048 + (y >> 3) * 80 + (x >> 2)],
            shift = x & 3,
            pen = ((byte >> (7 - shift)) & 1) | (((byte >> (3 - shift)) & 1) << 1),
            offset = ((y + 3) * 320 + x) * 4;
        const ink = [
            [0, 0, 0],
            [255, 0, 0],
            [0, 255, 0],
            [255, 255, 255],
        ][pen];
        if (ink.some((value, channel) => value !== cpcPixels[offset + channel]))
            throw Error('CPC archive differs from recovered loading bitmap');
    }
// Archive's Sharp panel is a complete 256x192 monochrome picture at 2x.
// Its identification as a cassette loading screen is uncertain; preserve it
// as archival artwork rather than claiming extraction from Datelsoft's MZF.
const sharpPixels = new Uint8Array(256 * 192 * 4);
for (let y = 0; y < 192; y++)
    for (let x = 0; x < 256; x++) {
        const start = ((25 + y * 2) * original.width + 1438 + x * 2) * 4;
        const pixel = original.rgba.subarray(start, start + 4);
        if (
            (pixel[0] !== 0 && pixel[0] !== 255) ||
            pixel[0] !== pixel[1] ||
            pixel[0] !== pixel[2] ||
            pixel[3] !== 255
        )
            throw Error('Sharp archive panel must contain opaque black and white pixels');
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
                for (let channel = 0; channel < 4; channel++)
                    if (
                        original.rgba[start + (dy * original.width + dx) * 4 + channel] !==
                        pixel[channel]
                    )
                        throw Error('Sharp source is no longer an exact 2x pixel copy');
        sharpPixels.set(pixel, (y * 256 + x) * 4);
    }
const assets = [
    ['zx', 256, 192, zxPixels],
    ['c64', 320, 200, c64],
    ['cpc', 320, 200, cpcPixels],
    ['sharp-mz800', 256, 192, sharpPixels],
];
await mkdir(new URL('assets/images/', output), { recursive: true });
const outputs = [];
for (const [mode, width, height, pixels] of assets) {
    const bytes = encodePng(width, height, pixels),
        file = PLATFORM_IMAGES[mode === 'zx' ? 'retro' : mode].replace(/^\.\//, '');
    await mkdir(new URL('.', new URL(file, output)), { recursive: true });
    await writeFile(new URL(file, output), bytes);
    outputs.push({ mode, file, width, height, sha256: hash(bytes), rgbaSha256: hash(pixels) });
}

const stGraphics = JSON.parse(
    await readFile(new URL('assets/graphics/atari-st/resources.json', root), 'utf8'),
);
const stTitle = stGraphics.title;
const stRgba = new Uint8Array(stTitle.width * stTitle.height * 4);
for (const [index, ink] of stTitle.pixels.entries())
    stRgba.set([...stTitle.palette[ink], 255], index * 4);
await mkdir(new URL('assets/images/atari-st/', output), { recursive: true });
await writeFile(
    new URL('assets/images/atari-st/loading.png', output),
    encodePng(stTitle.width, stTitle.height, stRgba),
);

outputs.push({
    mode: 'atari-st',
    file: 'assets/images/atari-st/loading.png',
    width: stTitle.width,
    height: stTitle.height,
    sha256: hash(encodePng(stTitle.width, stTitle.height, stRgba)),
    rgbaSha256: hash(stRgba),
});

await writeFile(
    new URL('images/loading-screens-provenance.json', originals),
    JSON.stringify(
        {
            generator: 'npm run graphics:loading-screens',
            zx: {
                source: 'src/assets/graphics/zx-spectrum/graphics.json: loading',
                sha256: hash(Buffer.from(zx.loading)),
                provenance: 'originals/graphics/zx-spectrum/graphics-provenance.json',
                notes: 'Original 6912-byte ZX SCR, full 256x192, FLASH off; no removal of stars, credits or counter.',
            },
            cpc: {
                source: 'originals/images/amstrad-cpc/source/exolon-cpc-loading.png',
                sha256: hash(cpcSource),
                url: 'https://www.cpc-power.com/extra_lire_fichier.php?extra=cpcold&fiche=54&part=A&slot=1&type=.png',
                page: 'https://www.cpc-power.com/index.php?num=54&page=detail',
                crop: { x: 64, y: 72, width: 640, height: 400 },
                scale: 2,
                bitmapSource: 'src/assets/graphics/amstrad-cpc/cpc-graphics.json: loading',
                bitmapSha256: hash(Buffer.from(cpc.loading)),
                notes: 'Lossless native 320x200 active area from the original CPC archive capture; every 2x2 block verified. All 320x192 recovered bitmap pixels independently match at y+3 with the original black/red/green/white inks. No claim of identical cassette loader code.',
            },
            c64: {
                artist: 'Stephen Robertson (SIR’88)',
                status: 'Authentic archived artwork intended for the unreleased Rack-It edition; not present on the original retail tape.',
                source: 'originals/images/shared/reference/exolon-loading-comparison.png',
                sha256: hash(source),
                url: 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEii7akkvpsmOUWxpzuB4BgHVsJmCnPqJCDgGYrN6NbX2xsm55R0Ii195X2E97HG6VSVhCqjHw-M5FYvDem4h2KHNgWcOinnR92NLbIpCsxzbNim0Ke5jrji34OvPQgykTwg92q6CW3PNu_g/s2058/Exolon+loaders+upgrade.png',
                page: 'https://frgcb.blogspot.com/2020/08/exolon-hewson-consultants-1987.html',
                artistInterview: 'https://www.lemon64.com/page/stephen-robertson-interview',
                editionNotes: 'https://www.lemon64.com/game/exolon',
                crop: { x: 1381, y: 466, width: 640, height: 400 },
                scale: 2,
                notes: 'Lossless extraction of the complete native 320x200 panel; all 2x2 source blocks verified identical. Source palette and credits preserved.',
            },
            sharp: {
                source: 'originals/images/shared/reference/exolon-loading-comparison.png',
                sha256: hash(source),
                page: 'https://frgcb.blogspot.com/2020/08/exolon-hewson-consultants-1987.html',
                crop: { x: 1438, y: 25, width: 512, height: 384 },
                scale: 2,
                status: 'Archival monochrome picture attributed to Sharp MZ-800. The source author explicitly questions whether it is an actual loading screen; its use by the Datelsoft edition is unconfirmed.',
                notes: 'Full 256x192 panel extracted losslessly; every 2x2 source block and both opaque black/white inks verified. Used for the platform banner at user request; no separate pre-title loading cover is displayed. Datelsoft menus, sprites and gameplay palette remain separate original assets.',
            },
            atariSt: {
                source: 'src/assets/graphics/atari-st/resources.json: title',
                provenance: 'originals/graphics/atari-st/provenance.json',
                notes: 'Original ST EXOPIC.PIC 240x187 at48,0 on320x200; two overread rows and exterior use zero padding.',
            },
            remastered: {
                file: 'originals/images/remastered/intro-green-weapon.jpg',
                notes: 'Preserved existing yellow illustration. Its author and initial URL remain unverified; see research/behavior.md. The red illustration is archived and never selected.',
            },
            outputs,
            rights: 'Original artwork retains its original ownership; archival availability is not a new license.',
        },
        null,
        2,
    ) + '\n',
);
console.log(
    `Exolon platform artwork: ${outputs.length} native PNG files generated in ${fileURLToPath(new URL('assets/images/', output))}`,
);
