// Offline extraction from the verified original Atari ST release. No emulator in runtime.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAmigaPlanar, mirrorAmigaFrame } from './amiga.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const ATARI_ST_MAIN_SHA256 =
    '2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638';
const FONT_SHA256 = '8bb21d897c7204a22b3d21a63072de3da5243230763475f725e534a6b1f704a6';
const B = 0x10000;
export function atariStRgb(word) {
    return [8, 4, 0].map((shift) => Math.round((((word >> shift) & 7) * 255) / 7));
}

export function decodeAtariStFont(source) {
    if (hash(source) !== FONT_SHA256) throw new Error('Unverified Atari TOS system font.');
    const offset = source.readUInt32BE(76);
    return Array.from({ length: 256 }, (_, ch) =>
        Array.from({ length: 8 }, (_, row) => source[offset + row * 256 + ch]),
    );
}

export function extractAtariStGraphics(files, main, fontSource) {
    if (main.length !== 0xccca || hash(main) !== ATARI_ST_MAIN_SHA256)
        throw new Error('Unverified original Atari ST main program.');
    const memory = new Uint8Array(0x100000);
    memory.set(main, B);
    const word = (address) => memory[address] * 256 + memory[address + 1];
    const long = (address) => word(address) * 65536 + word(address + 2);
    const palette = (address) =>
        Array.from({ length: 16 }, (_, i) => atariStRgb(word(address + i * 2)));
    const file = (name) => {
        const value = files.get(name);
        if (!value) throw new Error(`Missing original Atari ST file ${name}.`);
        return value;
    };
    const body = (name) => {
        const bytes = file(name);
        if (bytes[0] !== 0x60 || bytes[1] !== 0x1a) return bytes;
        return bytes.subarray(28, 28 + bytes.readUInt32BE(2));
    };
    // The original startup read plan at text$26..$3d0. Preserve its full file headers.
    const loads = [
        ['BIGDATA.DAT', 0x246be],
        ['SIDEBAR.DAT', 0x394be],
        ['BACKDROP.DAT', 0x304be],
        ['GUNS.DAT', 0x3a13e],
        ['BRAIN.ANM', 0x45c90],
        ['PLANET.DAT', 0x374be],
        ['MINE.DAT', 0x49100],
        ['LOGO.DAT', 0x4ae6a],
        ['DSHIP.DAT', 0x4ad06, 356],
    ];
    for (const [name, address, length] of loads)
        memory.set(file(name).subarray(0, length), address);
    const resources = {},
        regions = [];
    const add = (
        name,
        address,
        width,
        height,
        count = 1,
        bytes = memory,
        offset = address,
        mirrors = false,
        source = 'original-main/startup-files',
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
            source,
            sourceOffset: offset,
            length: stride * count,
            sha256: hash(bytes.subarray(offset, offset + stride * count)),
        });
        return name;
    };
    const shape = (
        name,
        filename,
        address,
        width,
        height,
        count = 1,
        offset = 0,
        mirrors = false,
    ) => add(name, address, width, height, count, body(filename), offset, mirrors, filename);
    shape('player', 'SPRITE.DAT', 0x26ebe, 32, 40, 15, 0, true);
    shape('player-armored', 'SPRITE1.DAT', 0x2b9be, 32, 40, 15, 0, true);
    shape('bullets', 'AMMO.SPR', 0x3c540, 16, 6, 11);
    shape('explosion', 'PC.DAT', 0x3c750, 16, 8, 9);
    shape('small-explosion', 'BULL.PUF', 0x45810, 32, 8, 9);
    shape('pod-particles', 'PC.DAT', 0x3c750, 16, 8);
    const debris = body('EXPLO.DAT').subarray(0, 72),
        shard = decodeAmigaPlanar(debris, 32, 9, 2);
    resources.debris = {
        address: 0x39cbe,
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
        source: 'EXPLO.DAT',
        sourceOffset: 0,
        length: 72,
        sha256: hash(debris),
    });
    // $132be DBRA copies height+1 rows. Its49th row is preserved PC.DAT, not zero padding.
    const piston = Buffer.concat([body('PLUNGER.DAT'), body('PC.DAT').subarray(238, 254)]);
    add('spikes', 0x3c53e, 32, 49, 1, piston, 0, false, 'PLUNGER.DAT + PC.DAT[238..254]');
    shape('window-tiles', 'BITS.DAT', 0x48e00, 16, 16, 6);
    shape('exit-gate', 'END.DAT', 0x4e142, 16, 64, 2);
    resources['exit-gate'].frames = [0, 512].map((offset) => {
        const bytes = body('END.DAT');
        return decodeAmigaPlanar(
            Uint8Array.from(
                { length: 512 },
                (_, i) => bytes[offset + Math.floor(i / 8) * 8 + [0, 3, 2, 5, 4, 7, 6, 1][i % 8]],
            ),
            16,
            64,
        );
    });
    shape('launcher', 'BRAIN.ANM', 0x45c90, 32, 48);
    shape('laser-animation', 'BRAIN.ANM', 0x46090, 32, 32, 4, 1024);
    shape('rocket', 'MISSILE.DAT', 0x46890, 32, 15, 3);
    shape('energy-beam', 'BEAM.DAT', 0x46b60, 8, 8, 7);
    shape('powerups', 'PICKUP.DAT', 0x491c0, 16, 16, 2);
    add('missile', 0x4ad06, 32, 24);
    shape('large-explosion', 'EEXPLODE.DAT', 0x46c40, 48, 24, 15);
    shape('logo', 'LOGO.DAT', 0x4ae86, 176, 40);
    shape('menu-stars', 'BIGTWINK.DAT', 0x4bd42, 16, 16, 7);
    shape('game-stars', 'TWINKLE.SML', 0x4bc46, 8, 7, 9);
    shape('score-pipe', 'SIDEBAR.DAT', 0x394be, 64, 64);
    shape('teleport', 'FIZZ.DAT', 0x492c0, 32, 32, 13);
    add('hud', 0x1c2ca, 320, 16);
    shape('death', 'XDEATH.DAT', 0x56c42, 48, 48, 30);
    shape('mines', 'MINE.DAT', 0x49100, 16, 8, 3);
    shape('barriers', 'BIGDATA.DAT', 0x246be, 64, 64, 4);
    shape('pod-body', 'BIGDATA.DAT', 0x266be, 64, 64, 1, 8192);
    shape('turret-0', 'GUNS.DAT', 0x3a13e, 64, 64);
    shape('turret-1', 'GUNS.DAT', 0x3ad3e, 64, 32, 1, 3072);
    shape('turret-2', 'GUNS.DAT', 0x3a93e, 64, 32, 1, 2048);
    shape('turret-animation-0', 'GUNANIM.DAT', 0x3b13e, 32, 32, 5);
    shape('turret-animation-1', 'GUNANIM.DAT', 0x3bb3e, 32, 32, 5, 2560);
    const flyerFiles = ['ENEMY.SPR', 'ENEMY1.SPR', 'ENEMY2.SPR', 'ENEMY2.SPR', 'ENEMY1.SPR'];
    const stageFlyers = flyerFiles.map((name, stage) =>
        Array.from({ length: 4 }, (_, variant) =>
            shape(
                `flyer-${stage}-${variant}`,
                name,
                0x4bd42 + variant * 0x900,
                32,
                24,
                6,
                variant * 0x900,
            ),
        ),
    );
    const tilesets = ['MAPGR8.DAT', 'MAPGR81.DAT'].map((name) =>
        Array.from({ length: 256 }, (_, i) =>
            decodeAmigaPlanar(body(name).subarray(i * 32, (i + 1) * 32), 8, 8),
        ),
    );
    const stageTileSets = [0, 1, 1, 0, 1];
    const screens = [];
    for (let index = 0; index < 125; index++) {
        const stage = Math.floor(index / 25),
            sourceOffset = (index % 25) * 920;
        const tiles = Array.from(
            body(`L${stage + 1}MAP.DAT`).subarray(sourceOffset, sourceOffset + 920),
        );
        const screen = { index, stage, source: 0x1cce6 + sourceOffset, tiles, static: [] };
        const positions = (ids) =>
            tiles.flatMap((tile, i) =>
                ids.includes(tile) ? [{ x: (i % 40) * 8, y: Math.floor(i / 40) * 8 }] : [],
            );
        const draw = (address, x, y, width, height, transparent = false) => {
            const name = `static-${address.toString(16)}-${width}-${height}`;
            if (!resources[name]) add(name, address, width, height);
            screen.static.push({ address, x, y, width, height, transparent, resource: name });
        };
        positions([0xfe]).forEach(({ x, y }, i) =>
            draw(long(0x1b32a + index * 32 + i * 4), x & ~15, y, 64, 64),
        );
        positions([0xff, 0xf7]).forEach(({ x, y }, i) =>
            draw(0x246be + memory[0x1b0b8 + index * 5 + i] * 2048, x & ~15, y, 64, 64, true),
        );
        positions([0xf5, 0xf6]).forEach(({ x, y }, i) => {
            if (memory[0x1a6f4 + index * 4 + i] === 0) draw(0x266be, x & ~15, y, 64, 64, true);
        });
        positions([0xfc, 0xf8]).forEach(({ x, y }, i) => {
            const selector = memory[0x1aec4 + index * 4 + i];
            draw(
                long(0x1a208 + selector * 4),
                x & ~15,
                y,
                64,
                memory[0x1a220 + selector] === 1 ? 64 : 32,
                true,
            );
        });
        positions([0xfb]).forEach(({ x, y }) => draw(0x45c90, (x + 8) & ~15, y, 32, 48, true));
        positions([0xa2]).forEach(({ x, y }) => draw(0x49100, x & ~15, y, 16, 8));
        draw(0x1c2ca, 0, 184, 320, 16);
        screens.push(screen);
    }
    const textRecords = (start) => {
        let at = start,
            x = 0,
            y = 0,
            ink = 7;
        const records = [];
        while (main[at]) {
            if (main[at] === 27) {
                const code = main[at + 1];
                at += 2;
                if (code === 98) ink = main[at++] & 15;
                else if (code === 99) at++;
                else if (code === 89) {
                    y = (main[at++] - 32) * 8;
                    x = (main[at++] - 32) * 8;
                } else if (code === 69) x = y = 0;
                else throw new Error(`Unsupported original VT52 command ${code}.`);
            } else if (main[at] === 8) {
                x -= 8;
                at++;
            } else {
                const address = at;
                let text = '';
                while (main[at] && main[at] !== 27 && main[at] !== 8)
                    text += String.fromCharCode(main[at++]);
                records.push({ address: B + address, x, y, text, ink });
                x += text.length * 8;
            }
        }
        return records;
    };
    const text = Object.fromEntries(
        Object.entries({
            loading: 0x8b4a,
            menu: 0x8b64,
            bonus: 0x8c05,
            bravery: 0x8cfa,
            normalBravery: 0x8d12,
            armoredBravery: 0x8d27,
            lifeBonus: 0x8d3c,
            nameEntry: 0x8da1,
            ending: 0x8e1f,
            gameOver: 0x8ea4,
        }).map(([name, offset]) => [name, textRecords(offset)]),
    );
    const highScores = Array.from({ length: 34 }, (_, i) => {
        const record = textRecords(0x8ecc + i * 22)[0].text;
        return {
            name: record.slice(0, 10).replace(/\.+$/, ''),
            score: Number(record.slice(11)),
        };
    });
    const asciiFont = decodeAtariStFont(fontSource);
    const font = Array.from(
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ.0123456789* ',
        (ch) => asciiFont[ch.charCodeAt(0)],
    );
    const hudFont = Array.from({ length: 10 }, (_, i) =>
        Array.from(body('SCORE.TXT').subarray(i * 7, (i + 1) * 7)),
    );
    const titlePixels = new Array(320 * 200).fill(0),
        cover = decodeAmigaPlanar(body('EXOPIC.PIC'), 240, 187);
    for (let y = 0; y < 187; y++)
        titlePixels.splice(y * 320 + 48, 240, ...cover.slice(y * 240, (y + 1) * 240));
    const title = { width: 320, height: 200, pixels: titlePixels, palette: palette(0x1a2ec) };
    const graphics = {
        palette: palette(0x1a2cc),
        text,
        highScores,
        stagePalettes: Array.from({ length: 5 }, (_, i) => palette(0x1a22c + i * 32)),
        stageTileSets,
        stageFlyers,
        resources,
        tilesets,
        font,
        asciiFont,
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
    const provenance = {
        source: 'Original Hewson Atari ST Pasti disk, canonical FAT12 files and independently recovered unpatched GAME.PRG.',
        mainSha256: hash(main),
        fontSha256: hash(fontSource),
        fontSource: 'https://github.com/th-otto/tos1x/blob/master/vdi/fonts/8x8/system.fnt',
        fontSelectionSource: 'https://github.com/th-otto/tos1x/blob/master/vdi/font8x8.c',
        files: Array.from(files, ([name, bytes]) => ({
            name,
            size: bytes.length,
            sha256: hash(bytes),
        })),
        formats: {
            shapes: 'ST four word-interleaved bitplanes; shared byte decoder only, all resources extracted independently from ST files.',
            palette:
                'Original text$a22c five stage palettes, $a2cc menu, $a2ec loading; 3-bit RGB channels rounded to0..255.',
            title: 'EXOPIC.PIC 28-byte header +22440-byte240×187 bitmap. Original $d82 copies240×189 at(48,0); extra two rows depend on memory beyond EOF, represented as background zero.',
            font: 'Original TOS8x8 system FNT dat_table offset$25a, form_width256; full256-glyph ASCII table plus39-glyph shared native subset.',
            text: 'Original GEMDOS9 VT52 streams: ESCb hardware ink, ESCY row/column biased32, 8×8 cells.',
            missile:
                'Native32×24 source reads DSHIP.DAT first356 bytes followed by28-byte LOGO.DAT header, matching original contiguous RAM.',
            spikes: 'PLUNGER.DAT48rows plus retained PC.DAT bytes238..253; $132be DBRA renders height+1 rows.',
            source: 'Screen.source is the active map record address in original RAM; each stage reloads its own L1MAP..L5MAP bank at$1ccca.',
        },
        regions,
        limitations: [
            'Square pixels; analog monitor/PAL pixel aspect is not baked in.',
            'Reference composites omit clock-seeded runtime star fields.',
            'The loading composite uses zero for the two source-overread rows and outside-art framebuffer.',
        ],
    };
    return { graphics, world, provenance };
}

async function main(args) {
    if (args.length !== 2)
        throw new Error(
            'Usage: node tools/graphics/atari-st.mjs /path/to/source-files /path/to/original-main.bin',
        );
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const assets = resolve(root, 'src/assets/graphics/atari-st'),
        originals = resolve(root, 'originals/graphics/atari-st'),
        data = resolve(root, 'src/games/atari-st/data');
    const manifest = JSON.parse(
        await readFile(resolve(originals, 'canonical-inputs.json'), 'utf8'),
    );
    const files = new Map(
        await Promise.all(
            manifest.map(async ({ name, size, sha256 }) => {
                const bytes = await readFile(resolve(args[0], name));
                if (bytes.length !== size || hash(bytes) !== sha256)
                    throw new Error(`Unverified original Atari ST file ${name}.`);
                return [name, bytes];
            }),
        ),
    );
    const result = extractAtariStGraphics(
        files,
        await readFile(resolve(args[1])),
        await readFile(resolve(originals, 'tos-system-8x8.fnt')),
    );
    await mkdir(data, { recursive: true });
    await mkdir(assets, { recursive: true });
    await mkdir(originals, { recursive: true });
    await writeFile(resolve(assets, 'resources.json'), JSON.stringify(result.graphics));
    await writeFile(
        resolve(originals, 'provenance.json'),
        JSON.stringify(result.provenance, null, 2) + '\n',
    );
    await writeFile(resolve(data, 'world.json'), JSON.stringify(result.world));
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
