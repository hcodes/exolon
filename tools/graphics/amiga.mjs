// Native Amiga asset extraction. The original disk is an offline input only.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverAmigaMemory, AMIGA_DISK_SHA256 } from '../recovery/amiga.mjs';
import { encodePng } from './png.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function decodeAmigaPlanar(source, width, height, planes = 4, planeStride = null) {
    const required =
        planeStride === null
            ? (width * height * planes) / 8
            : planeStride * (planes - 1) + (width * height) / 8;
    if (
        !Number.isInteger(width) ||
        width < 8 ||
        width % 8 ||
        height < 1 ||
        source.length < required
    )
        throw new RangeError('Incomplete Amiga planar image.');
    if (planeStride === null && width !== 8 && width % 16)
        throw new RangeError('Native Amiga shapes use whole 16 pixel words.');
    return Array.from({ length: width * height }, (_, i) => {
        const x = i % width,
            y = Math.floor(i / width);
        let value = 0;
        for (let p = 0; p < planes; p++) {
            const offset =
                planeStride !== null
                    ? p * planeStride + (y * width) / 8 + Math.floor(x / 8)
                    : width === 8
                      ? y * planes + p
                      : (y * width * planes) / 8 +
                        Math.floor(x / 16) * planes * 2 +
                        p * 2 +
                        Math.floor((x % 16) / 8);
            value |= ((source[offset] >> (7 - (x % 8))) & 1) << p;
        }
        return value;
    });
}

export function mirrorAmigaFrame(pixels, width, height) {
    return Array.from(
        { length: width * height },
        (_, i) => pixels[Math.floor(i / width) * width + width - 1 - (i % width)],
    );
}

export function extractAmigaGraphics(disk) {
    const { memory } = recoverAmigaMemory(disk);
    const word = (a) => memory[a] * 256 + memory[a + 1];
    const long = (a) => word(a) * 65536 + word(a + 2);
    const rgb = (n) => [8, 4, 0].map((s) => ((n >> s) & 15) * 17);
    const palette = (a) => Array.from({ length: 16 }, (_, i) => rgb(word(a + i * 2) * 2));
    const resources = {};
    const regions = [];
    const add = (
        name,
        address,
        width,
        height,
        count = 1,
        bytes = memory,
        offset = address,
        mirrors = false,
    ) => {
        const stride = (width * height) / 2;
        const frames = Array.from({ length: count }, (_, i) =>
            decodeAmigaPlanar(
                bytes.subarray(offset + i * stride, offset + (i + 1) * stride),
                width,
                height,
            ),
        );
        if (mirrors) frames.push(...frames.map((frame) => mirrorAmigaFrame(frame, width, height)));
        resources[name] = { address, width, height, frames };
        regions.push({
            name,
            address,
            source: bytes === memory ? 'recovered-ram' : 'disk',
            sourceOffset: offset,
            length: stride * count,
            sha256: hash(bytes.subarray(offset, offset + stride * count)),
        });
        return name;
    };
    add('player', 0x30870, 32, 40, 15, memory, 0x30870, true);
    add('player-armored', 0x35370, 32, 40, 15, memory, 0x35370, true);
    add('bullets', 0x16000, 16, 6, 11);
    add('explosion', 0x16210, 16, 8, 9);
    add('small-explosion', 0x16450, 32, 8, 9);
    // $d5d4 draws two source planes into one of four native palette pairs.
    const debris = memory.subarray(0x285ec, 0x285ec + 72);
    const shard = decodeAmigaPlanar(debris, 32, 9, 2);
    resources.debris = {
        address: 0x285ec,
        width: 32,
        height: 9,
        frames: [
            [1, 2],
            [2, 4],
            [4, 8],
            [8, 2],
        ].map(([a, b]) => shard.map((ink) => (ink & 1 ? a : 0) | (ink & 2 ? b : 0))),
    };
    regions.push({
        name: 'debris',
        address: 0x285ec,
        source: 'recovered-ram',
        sourceOffset: 0x285ec,
        length: 72,
        sha256: hash(debris),
    });
    add('pod-particles', 0x16210, 16, 8);
    // $8660 loads this sprite only after the recovered startup read plan.
    // $a404 uses DBRA and copies one extra cleared row at full extension.
    const pistonSource = disk.subarray(0x37000, 0x37300);
    const piston = new Uint8Array((32 * 49) / 2);
    piston.set(pistonSource);
    resources.spikes = {
        address: 0x18102,
        width: 32,
        height: 49,
        frames: [decodeAmigaPlanar(piston, 32, 49)],
    };
    regions.push({
        name: 'spikes',
        address: 0x18102,
        source: 'disk',
        sourceOffset: 0x37000,
        length: 768,
        sha256: hash(pistonSource),
        zeroPaddingBytes: 16,
    });
    add('window-tiles', 0x17864, 16, 16, 6);
    add('exit-gate', 0x1cb90, 16, 64, 2);
    // $91c2 stores a custom byte order rather than native word-interleaved planes.
    resources['exit-gate'].frames = [0x1cb90, 0x1cd90].map((address) => {
        const reordered = Uint8Array.from(
            { length: 512 },
            (_, i) => memory[address + Math.floor(i / 8) * 8 + [0, 3, 2, 5, 4, 7, 6, 1][i % 8]],
        );
        return decodeAmigaPlanar(reordered, 16, 64);
    });
    add('launcher', 0x168d0, 32, 48);
    add('laser-animation', 0x16cd0, 32, 32, 4);
    add('rocket', 0x174d0, 32, 15, 3);
    add('energy-beam', 0x177a0, 8, 8, 7);
    add('powerups', 0x17c24, 16, 16, 2);
    add('missile', 0x17d6a, 32, 24);
    add('large-explosion', 0x185d0, 48, 24, 15);
    add('logo', 0x1cfac, 176, 40);
    add('menu-stars', 0x1a790, 16, 16, 7);
    add('game-stars', 0x17ece, 8, 7, 9);
    add('score-pipe', 0x28a6c, 64, 64);
    add('teleport', 0x1dd6c, 32, 32, 13);
    add('hud', 0x2da6c, 320, 16);
    add('death', 0x42e8c, 48, 48, 30);
    add('mines', 0x17b64, 16, 8, 3);
    add('barriers', 0x2926c, 64, 64, 4);
    add('pod-body', 0x2b26c, 64, 64);
    add('turret-0', 0x2e470, 64, 64);
    add('turret-1', 0x2f070, 64, 32);
    add('turret-2', 0x2ec70, 64, 32);
    add('turret-animation-0', 0x2f470, 32, 32, 5);
    add('turret-animation-1', 0x2fe70, 32, 32, 5);
    const stageFlyerBanks = [0x6e400, 0x70800, 0x72c00, 0x72c00, 0x70800];
    const stageFlyers = stageFlyerBanks.map((offset, stage) =>
        Array.from({ length: 4 }, (_, variant) =>
            add(
                `flyer-${stage}-${variant}`,
                0x1a790 + variant * 0x900,
                32,
                24,
                6,
                disk,
                offset + variant * 0x900,
            ),
        ),
    );
    const tileSources = [0x29200, 0x4ec00];
    const tilesets = tileSources.map((a) =>
        Array.from({ length: 256 }, (_, i) =>
            decodeAmigaPlanar(disk.subarray(a + i * 32, a + (i + 1) * 32), 8, 8),
        ),
    );
    const stagePalettes = Array.from({ length: 5 }, (_, i) => palette(0x111f0 + i * 32));
    const stageTileSets = [0, 1, 1, 0, 1];
    const banks = [0x51e00, 0x57800, 0x5d200, 0x62c00, 0x68600];
    const screens = [];
    for (let index = 0; index < 125; index++) {
        const stage = Math.floor(index / 25),
            source = banks[stage] + 28 + (index % 25) * 920;
        const tiles = Array.from(disk.subarray(source, source + 920));
        const screen = { index, stage, source, tiles, static: [] };
        const positions = (ids) =>
            tiles.flatMap((t, i) =>
                ids.includes(t) ? [{ x: (i % 40) * 8, y: Math.floor(i / 40) * 8 }] : [],
            );
        const draw = (address, x, y, width, height, transparent = false) => {
            const name = `static-${address.toString(16)}-${width}-${height}`;
            if (!resources[name]) add(name, address, width, height);
            screen.static.push({ address, x, y, width, height, transparent, resource: name });
        };
        positions([0xfe]).forEach(({ x, y }, i) =>
            draw(long(0x122ee + index * 32 + i * 4), x & ~15, y, 64, 64),
        );
        positions([0xff, 0xf7]).forEach(({ x, y }, i) =>
            draw(0x2926c + memory[0x1207c + index * 5 + i] * 2048, x & ~15, y, 64, 64, true),
        );
        positions([0xf5, 0xf6]).forEach(({ x, y }, i) => {
            if (memory[0x116b8 + index * 4 + i] === 0) draw(0x2b26c, x & ~15, y, 64, 64, true);
        });
        positions([0xfc, 0xf8]).forEach(({ x, y }, i) => {
            const selector = memory[0x11e88 + index * 4 + i];
            draw(
                long(0x111cc + selector * 4),
                x & ~15,
                y,
                64,
                memory[0x111e4 + selector] === 1 ? 64 : 32,
                true,
            );
        });
        positions([0xfb]).forEach(({ x, y }) => draw(0x168d0, (x + 8) & ~15, y, 32, 48, true));
        positions([0xa2]).forEach(({ x, y }) => draw(0x17b64, x & ~15, y, 16, 8));
        // The original draws the sixteen HUD scanlines at display y=184 after objects.
        draw(0x2da6c, 0, 184, 320, 16);
        screens.push(screen);
    }
    const font = Array.from({ length: 39 }, (_, i) =>
        Array.from(memory.subarray(0x17fca + i * 8, 0x17fca + (i + 1) * 8)),
    );
    const hudFont = Array.from({ length: 10 }, (_, i) =>
        Array.from(memory.subarray(0x17d24 + i * 7, 0x17d24 + (i + 1) * 7)),
    );
    const title = {
        width: 320,
        height: 200,
        pixels: decodeAmigaPlanar(disk.subarray(0x8a00, 0x8a00 + 40000), 320, 200, 5, 8000),
        palette: Array.from({ length: 32 }, (_, i) => rgb(word(0x15b1c + i * 4))),
    };
    const textRecords = (address) => {
        const records = [];
        let at = address;
        for (;;) {
            const start = at,
                x = memory[at++] * 8,
                y = memory[at++];
            let text = '';
            while (memory[at] !== 0 && memory[at] !== 255)
                text += String.fromCharCode(memory[at++]);
            records.push({ address: start, x, y, text });
            if (memory[at++] === 0) return records;
        }
    };
    const text = Object.fromEntries(
        Object.entries({
            loading: 0xfc02,
            menu: 0xfc0f,
            bonus: 0xfcbd,
            bravery: 0xfd70,
            normalBravery: 0xfd83,
            armoredBravery: 0xfd96,
            lifeBonus: 0xfda9,
            nameEntry: 0xfe0a,
            ending: 0xfe61,
            gameOver: 0xfeca,
        }).map(([name, address]) => [name, textRecords(address)]),
    );
    const highScores = Array.from({ length: 34 }, (_, i) => {
        const address = 0xfee8 + i * 20;
        const record = textRecords(address)[0].text;
        return { name: record.slice(0, 10).replace(/\.+$/, ''), score: Number(record.slice(11)) };
    });
    const graphics = {
        palette: palette(0x11290),
        text,
        highScores,
        stagePalettes,
        stageTileSets,
        stageFlyers,
        resources,
        tilesets,
        font,
        hudFont,
        title,
    };
    const world = {
        width: 40,
        height: 23,
        screenWidth: 320,
        screenHeight: 200,
        screenCount: 125,
        worldYOffset: 40,
        solidTileRange: [0x78, 0xa6],
        screens,
    };
    const packedRegions = [
        ['menu-text', memory, 0xfc02, 0x2e6],
        ['hall-of-fame', memory, 0xfee8, 680],
        ['font', memory, 0x17fca, 304],
        ['hud-font', memory, 0x17d24, 70],
        ['stage-palettes', memory, 0x111f0, 160],
        ['title-copper-palette', memory, 0x15b1a, 128],
        ['loading-title', disk, 0x8a00, 40000],
        ...banks.map((offset, i) => [`map-bank-${i}`, disk, offset + 28, 23000]),
        ...tileSources.map((offset, i) => [`tile-bank-${i}`, disk, offset, 8192]),
    ];
    for (const [name, bytes, offset, length] of packedRegions)
        regions.push({
            name,
            source: bytes === memory ? 'recovered-ram' : 'disk',
            sourceOffset: offset,
            length,
            sha256: hash(bytes.subarray(offset, offset + length)),
        });
    const codeRanges = [
        [0x8b62, 0x8c62],
        [0x88f0, 0x8932],
        [0x8ed8, 0x906c],
        [0x83c2, 0x840c],
        [0x8660, 0x867e],
        [0xbedc, 0xbff8],
        [0xc0f2, 0xc18e],
        [0xd5d4, 0xd6a6],
        [0xc18e, 0xc29c],
        [0x95e6, 0x9886],
        [0x8774, 0x881a],
        [0x9310, 0x9570],
        [0xc768, 0xc822],
        [0xc824, 0xc8c2],
        [0xc91e, 0xcacc],
        [0xcd4e, 0xcf28],
        [0xcf28, 0xd350],
        [0xd9dc, 0xdbe2],
        [0xe072, 0xe0f0],
        [0x9bd2, 0x9cf4],
        [0x91c2, 0x922a],
        [0xa3a6, 0xa4a2],
        [0xa648, 0xa806],
        [0xaad6, 0xab78],
        [0xddaa, 0xe034],
    ];
    const provenance = {
        source: 'Original Amiga Exolon PAL Disk.1 from Exolon_v1.3_0015.lha; WHDLoad package used only to recover the unpatched disk bytes.',
        diskSha256: AMIGA_DISK_SHA256,
        diskSize: disk.length,
        formats: {
            maps: 'Five disk banks, each 28 byte executable-data header then 25 records of 40×23 row-major bytes; screen boundaries read from RAM$92a2.',
            spikes: 'Late $8660 disk read: $37000..$37300 to RAM $18102. Native $a404 copies height+1 rows; full extension includes the following16 zero bytes.',
            shapes: 'Four bitplanes per 16-pixel word, MSB-first; 8-byte groups for each 16 pixels, then next horizontal word; 8×8 tiles use four bytes per scanline.',
            palette:
                'Gameplay palette words RAM$111f0+stage*32 doubled by $c802 before writing 12-bit RGB registers. Title palette direct 12-bit values in loader copper$15b1a.',
            player: '15 source 32×40 frames and 15 bit-reversed frames generated by $c768; frame 640 bytes. Armor has separate source bank.',
            exitGate:
                'Custom byte-per-plane row order at RAM $1cb90/$1cd90; source bytes [0,3,2,5,4,7,6,1] map to ordinary planar word order; draw routine $91c2.',
            title: 'Five complete 320×200 bitplanes, 8000 byte plane stride at disk$8a00; loader copper$15bba.',
        },
        regions,
        code: codeRanges.map(([start, end]) => ({
            start,
            end,
            hex: Buffer.from(memory.subarray(start, end)).toString('hex'),
        })),
        limitations: [
            'Static composite output follows initial screen draw; mutable objects are also represented by native marker bytes and independent model metadata.',
            'Reference screen PNGs omit the runtime generated star field whose seed comes from the hardware clock.',
            'Physical PAL pixel aspect is intentionally not baked into extracted square-pixel data.',
        ],
    };
    return { graphics, world, provenance };
}

export function rasterizeAmigaScreen(graphics, world, index) {
    const screen = world.screens[index],
        pixels = new Array(64000).fill(0),
        set = graphics.tilesets[graphics.stageTileSets[screen.stage]];
    const draw = (frame, x, y, width, height, transparent) => {
        for (let yy = 0; yy < height; yy++)
            for (let xx = 0; xx < width; xx++) {
                if (x + xx < 0 || x + xx >= 320 || y + yy < 0 || y + yy >= 200) continue;
                const color = frame[yy * width + xx];
                if (!transparent || color !== 0) pixels[(y + yy) * 320 + x + xx] = color;
            }
    };
    screen.tiles.forEach((tile, at) =>
        draw(set[tile], (at % 40) * 8, Math.floor(at / 40) * 8, 8, 8, false),
    );
    for (const shape of screen.static)
        draw(
            graphics.resources[shape.resource].frames[0],
            shape.x,
            shape.y,
            shape.width,
            shape.height,
            shape.transparent,
        );
    return pixels;
}

const rgba = (pixels, palette) =>
    Uint8Array.from(pixels.flatMap((index) => [...palette[index], 255]));
async function main(args) {
    if (args.length !== 1)
        throw new Error('Usage: node tools/graphics/amiga.mjs /path/to/Exolon/Disk.1');
    const disk = await readFile(resolve(args[0])),
        result = extractAmigaGraphics(disk);
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const assets = resolve(root, 'src/assets/graphics/amiga'),
        images = resolve(root, 'src/assets/images/amiga'),
        originalGraphics = resolve(root, 'originals/graphics/amiga'),
        originalImages = resolve(root, 'originals/images/amiga'),
        data = resolve(root, 'src/games/amiga/data');
    await Promise.all([
        mkdir(assets, { recursive: true }),
        mkdir(images, { recursive: true }),
        mkdir(originalGraphics, { recursive: true }),
        mkdir(originalImages, { recursive: true }),
        mkdir(data, { recursive: true }),
    ]);
    await writeFile(resolve(assets, 'resources.json'), JSON.stringify(result.graphics));
    await writeFile(
        resolve(originalGraphics, 'provenance.json'),
        JSON.stringify(result.provenance, null, 2) + '\n',
    );
    await writeFile(resolve(data, 'world.json'), JSON.stringify(result.world));
    const title = result.graphics.title;
    await writeFile(
        resolve(images, 'loading.png'),
        encodePng(title.width, title.height, rgba(title.pixels, title.palette)),
    );
    for (const index of [0, 24, 25, 49, 50, 74, 75, 99, 100, 124]) {
        const pixels = rasterizeAmigaScreen(result.graphics, result.world, index);
        await writeFile(
            resolve(originalImages, `screen-${String(index).padStart(3, '0')}.png`),
            encodePng(
                320,
                200,
                rgba(pixels, result.graphics.stagePalettes[Math.floor(index / 25)]),
            ),
        );
    }
    console.log(
        JSON.stringify({
            screens: result.world.screens.length,
            resources: Object.keys(result.graphics.resources).length,
            worldSha256: hash(Buffer.from(JSON.stringify(result.world))),
            graphicsSha256: hash(Buffer.from(JSON.stringify(result.graphics))),
        }),
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
