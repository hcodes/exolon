// Original Amstrad CPC Mode 0 artwork, decoded from the game's own data tables.
// The renderer at $3b92 copies two bytes per row, without Spectrum attributes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../recovery/cpc.mjs';

const CPC_MEMORY_SHA256 = '496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec';
const byte = (memory, address) => {
    if (!Number.isInteger(address) || address < 0 || address >= memory.length)
        throw new Error(`Invalid CPC data address: ${address}`);
    return memory[address];
};
const word = (memory, address) => byte(memory, address) | (byte(memory, address + 1) << 8);

/** One original Mode 0 byte encodes two 4-bit ink indices. */
export function decodeCpcByte(value) {
    return [0, 1].map(
        (shift) =>
            ((value >> (7 - shift)) & 1) |
            (((value >> (3 - shift)) & 1) << 1) |
            (((value >> (5 - shift)) & 1) << 2) |
            (((value >> (1 - shift)) & 1) << 3),
    );
}

/** Each native pixel is doubled to the shared 256-pixel logical playfield. */
export function decodeCpcPixels(bitmap) {
    if (bitmap.length !== 16) throw new Error('A CPC tile needs sixteen bytes.');
    return bitmap.flatMap((value) => decodeCpcByte(value).flatMap((ink) => [ink, ink]));
}

/** Interpret the original drawing data only, with finite recursion/instruction limits. */
export function decodeCpcBlock(memory, address, origin = { x: 0, y: 0 }, { clip = true } = {}) {
    const cells = [],
        actions = [];
    const state = { x: origin.x, y: origin.y, font: 0x69dd, color: 0, collision: 1, overlay: 0 };
    let budget = 50000;
    const emit = (glyph) => {
        if (clip && (state.x >= 32 || state.y >= 24)) return;
        const bitmap = Array.from({ length: 16 }, (_, i) =>
            byte(memory, state.font + glyph * 16 + i),
        );
        cells.push({ ...state, glyph, bitmap });
    };
    const execute = (start, depth) => {
        if (depth > 16) throw new Error('CPC block recursion limit exceeded.');
        let pc = start;
        const loops = [];
        const next = () => byte(memory, pc++);
        while (--budget > 0) {
            const op = next();
            if (op <= 0x60) {
                emit(op);
                state.x = (state.x + 1) & 255;
            } else if (op < 0x90) {
                state.y = (state.y + op - 0x78) & 255;
                state.x = (state.x + next()) & 255;
            } else if (op < 0xcf) {
                state.y = (state.y + 1) & 255;
                state.x = (state.x + op - 0xaf) & 255;
            } else if (op < 0xdf) {
                let color = op - 0xcf;
                if (color >= 8) color = (color - 8) | 64;
                state.color = (state.color & 0x38) | color;
            } else if (op === 0xdf) {
                state.y = next();
                state.x = next();
            } else if (op === 0xe0) state.color = next();
            else if (op === 0xe1) loops.push({ count: next() || 256, pc, color: state.color });
            else if (op === 0xe2) {
                const loop = loops.at(-1);
                if (!loop) throw new Error('Unmatched CPC drawing loop.');
                state.color = loop.color;
                if (--loop.count) pc = loop.pc;
                else loops.pop();
            } else if (op === 0xe3) {
                const target = word(memory, pc);
                pc += 2;
                const { x, y, color } = state;
                execute(target, depth + 1);
                Object.assign(state, { x, y, color });
            } else if (op === 0xe4 || op === 0xe5) {
                const count = next() || 256,
                    glyph = next(),
                    axis = op === 0xe4 ? 'x' : 'y';
                for (let i = 0; i < count; i++) {
                    emit(glyph);
                    state[axis] = (state[axis] + 1) & 255;
                }
            } else if (op === 0xe6) {
                state.font = word(memory, pc);
                pc += 2;
            } else if (op === 0xe7) {
                const font = state.font;
                state.font = 0x69dd;
                emit(32);
                state.font = font;
                state.x = (state.x + 1) & 255;
            } else if (op === 0xe8) state.collision = next();
            else if (op === 0xe9 || op === 0xea) state.overlay = op === 0xea ? 255 : 0;
            else if (op === 0xeb) actions.push({ x: state.x, y: state.y, type: next() });
            else {
                if (loops.length) throw new Error('Unterminated CPC drawing loop.');
                return;
            }
        }
        throw new Error('CPC drawing instruction limit exceeded.');
    };
    execute(address, 0);
    return { cells, actions };
}

const firmwareHardware = [
    20, 4, 21, 28, 24, 29, 12, 5, 13, 22, 6, 23, 30, 0, 31, 14, 7, 15, 18, 2, 19, 26, 25, 27, 10, 3,
    11,
];
export function cpcHardwareRgb(hardware) {
    const color = firmwareHardware.indexOf(hardware & 31);
    if (color < 0) throw new Error('Unsupported CPC hardware ink.');
    const levels = [0, 128, 255];
    return [levels[Math.floor(color / 3) % 3], levels[Math.floor(color / 9)], levels[color % 3]];
}

export function extractCpcGraphics(memory, world, loading) {
    if (memory.length !== 65536 || sha256(memory) !== CPC_MEMORY_SHA256)
        throw new Error('Unsupported original CPC memory.');
    if (
        loading?.length !== 16384 ||
        sha256(loading) !== '9b06aa698f71ee227ad6087ca9d85dafd6bb95e13c7229c4d87195ffaf743c0b'
    )
        throw new Error('Unsupported archived CPC loading picture.');
    const raw = (address, length) => Array.from({ length }, (_, i) => byte(memory, address + i));
    const signed = (value) => (value >= 128 ? value - 256 : value);
    const relative = (cell) => ({ ...cell, x: signed(cell.x), y: signed(cell.y) });
    const blocks = Array.from({ length: 62 }, (_, id) => {
        const address = word(memory, 0x1305 + id * 2),
            decoded = decodeCpcBlock(memory, address, { x: 0, y: 0 }, { clip: false });
        return {
            id,
            address,
            tiles: decoded.cells.map(relative),
            actions: decoded.actions.map(relative),
        };
    });
    // These four native CPC templates are absent. The shared model retains their
    // ZX collision-cell layouts, so reuse complete, unchanged CPC glyphs there.
    // This is an explicit compatibility composition, never a reconstructed CPC
    // arrangement and never a conversion of Spectrum pixels or attributes.
    const compatibilityLayouts = {
        41: [
            ...Array.from({ length: 3 }, (_, x) => [x, 0, 0x778d, 12 + x]),
            ...Array.from({ length: 6 }, (_, i) => [i - 1, 1, 0x778d, (i + 3) % 4]),
            ...Array.from({ length: 6 }, (_, i) => [i - 1, 2, 0x778d, 16 + ((i + 3) % 4)]),
        ],
        48: [
            [0, 0, 0x8edd, 12],
            [1, 0, 0x8edd, 14],
            [-1, 1, 0x8edd, 15],
            [0, 1, 0x8edd, 17],
            [-1, 2, 0x8edd, 18],
        ],
        49: [
            [0, 0, 0x8edd, 12],
            [1, 0, 0x8edd, 14],
            [1, 1, 0x8edd, 15],
            [2, 1, 0x8edd, 17],
            [2, 2, 0x8edd, 20],
        ],
        51: [0, 6].flatMap((x) =>
            Array.from({ length: 6 }, (_, y) =>
                [0, 1].map((side) => [
                    x + side,
                    y,
                    0x8edd,
                    (y === 0 ? 12 : y === 5 ? 18 : 15) + side * 2,
                ]),
            ).flat(),
        ),
    };
    const compatibilityBlocks = Object.fromEntries(
        Object.entries(compatibilityLayouts).map(([id, layout]) => [
            id,
            {
                id: Number(id),
                nativeDefinition: 'empty',
                layout: 'shared ZX occupied cells; original CPC glyphs',
                actions: [],
                tiles: layout.map(([x, y, font, glyph]) => ({
                    x,
                    y,
                    font,
                    glyph,
                    color: 0,
                    collision: 1,
                    overlay: Number(id) === 48 || Number(id) === 49 ? 255 : 0,
                    bitmap: raw(font + glyph * 16, 16),
                })),
            },
        ]),
    );
    const tables = {
        player: raw(0x93cd, 25 * 192),
        small: raw(0xa68d, 45 * 64),
        shifted: raw(0x921d, 9 * 48),
        font: raw(0x6bdd, 59 * 16),
        torch: raw(0x70dd, 96),
        mine: raw(0x715d, 64),
        beam: raw(0x38e5, 16),
        turret: raw(0x768d, 256),
        star: raw(0x302e, 16),
    };
    const messageAddresses = {
        menu: 0x0174,
        logo: 0x0491,
        hud: 0x07a1,
        scores: 0x051a,
        gameOver: 0x2d57,
        hallOfFame: 0x2e59,
        bonus: 0x367a,
        combat: 0x3758,
        bravery: 0x380b,
    };
    const screens = Object.fromEntries(
        Object.entries(messageAddresses).map(([name, address]) => [
            name,
            decodeCpcBlock(memory, address).cells,
        ]),
    );
    // Score entries are ordinary text drawn separately by $04f5, following $051a.
    for (let row = 0; row < 17; row++) {
        for (let x = 0; x < 16; x++) {
            const glyph = byte(memory, 0x056c + row * 16 + x);
            screens.scores.push({
                x: 8 + x,
                y: 5 + row,
                font: 0x69dd,
                glyph,
                color: 0,
                collision: 1,
                overlay: 0,
                bitmap: raw(0x69dd + glyph * 16, 16),
            });
        }
    }
    const sourceMaps = Array.from({ length: 125 }, (_, id) => {
        let address = word(memory, 0x490e + id * 2);
        const placements = [];
        while (byte(memory, address) !== 255) {
            if (placements.length >= 128) throw new Error('Invalid CPC screen placements.');
            placements.push({
                y: byte(memory, address),
                x: byte(memory, address + 1),
                block: byte(memory, address + 2),
            });
            address += 3;
        }
        return placements;
    });
    const mapPlacementsSha256 = sha256(JSON.stringify(sourceMaps));
    if (
        world &&
        JSON.stringify(sourceMaps) !==
            JSON.stringify(world.screens.map((screen) => screen.placements))
    )
        throw new Error('Shared maps differ from the original CPC placements.');
    const paletteHardware = raw(0x3ef0, 16);
    return {
        version: 1,
        platform: 'cpc',
        width: 256,
        height: 192,
        nativeWidth: 128,
        playfieldHeight: 176,
        cellEncoding: 'amstrad-cpc-mode-0',
        mapPlacementsSha256,
        memorySha256: CPC_MEMORY_SHA256,
        paletteHardware,
        palette: paletteHardware.map(cpcHardwareRgb),
        tableSha256: Object.fromEntries(
            Object.entries(tables).map(([name, bytes]) => [name, sha256(Buffer.from(bytes))]),
        ),
        blocks,
        compatibilityBlocks,
        ...tables,
        loading: Array.from(loading),
        screens,
        messageAddresses,
        menuUnsupportedRows: [13, 17],
        proceduralPixels: {
            enemyBullet: {
                address: 0x1d9a,
                width: 4,
                height: 2,
                even: [0x8a, 0x88],
                odd: [0x45, 0x44],
            },
            bullet: { address: 0x10f5, even: [0x4d, 0x8e], odd: [0x04, 0xcf, 0x08] },
            star: { address: 0x3017, row: 4, byte: 0, randomMask: 0x54 },
        },
        spriteLayout: {
            player: {
                address: 0x93cd,
                frames: 25,
                width: 24,
                height: 32,
                frameBytes: 192,
                rowBytes: 6,
            },
            small: {
                address: 0xa68d,
                frames: 45,
                width: 16,
                height: 16,
                frameBytes: 64,
                rowBytes: 4,
            },
            shifted: {
                address: 0x921d,
                frames: 9,
                width: 12,
                height: 8,
                frameBytes: 48,
                rowBytes: 3,
                phaseBytes: 24,
            },
        },
    };
}

async function main(args) {
    if (args.length !== 2)
        throw new Error(
            'Usage: node tools/graphics/cpc.mjs /path/to/cpc-ram.bin /path/to/cpc-disk-loading.bin',
        );
    const memory = await readFile(resolve(args[0]));
    const loading = await readFile(resolve(args[1]));
    const world = JSON.parse(
        await readFile(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    const graphics = extractCpcGraphics(memory, world, loading);
    const output = new URL(
            '../../src/assets/graphics/amstrad-cpc/cpc-graphics.json',
            import.meta.url,
        ),
        bytes = Buffer.from(JSON.stringify(graphics));
    await mkdir(new URL('.', output), { recursive: true });
    await writeFile(output, bytes);
    const provenance = {
        title: 'Exolon — original Amstrad CPC graphics',
        version: 1,
        artifact: {
            file: 'cpc-graphics.json',
            generator: 'tools/graphics/cpc.mjs',
            command:
                'node tools/graphics/cpc.mjs /path/to/cpc-ram.bin /path/to/cpc-disk-loading.bin',
            sha256: sha256(bytes),
            bytes: bytes.length,
        },
        source: {
            title: 'Exolon',
            publisher: 'Hewson Consultants',
            year: 1987,
            programCredit: 'Raffaele Cecco',
            archiveUrl: 'https://acpc.me/emul/dsk/exolon,exolon.dsk',
            archiveBytes: 194816,
            archiveSha256: 'f8cb122713118feb48fcd7193f77ca66ad86e4fb739c37088ec8f71d34e54fd9',
            diskLoader:
                'Aragorn, 1995; archived loading picture retained separately from the original game tables.',
            memoryBytes: 65536,
            memorySha256: CPC_MEMORY_SHA256,
            commercialVerification: {
                archiveUrl:
                    'https://acpc.me/ACME/LOGICIELS/LOGICIELS_CPC_COMMERCIAUX_CLASSES_PAR_NOM/E/Exolon.7z',
                archiveSha256: '14d500a20b5225adfc508f295da35fcafc79fbfa975d705e5071842ca3fff33e',
                file: 'Exolon/Exolon_UK_[Original]_[Erbe].cdt',
                sha256: '32f84af268431975f72847f1cd2d53bcfd1d4db1de0c04eed3f62532b8e2cf30',
                codeSha256: sha256(memory.subarray(0x100, 0x6bdd)),
                graphicsSha256: sha256(memory.subarray(0x6bdd, 0xb1cd)),
                comparison:
                    'CDT turbo records 6 and 8 (sync/checksum removed) match all 27357 code bytes and 17904 graphics bytes in EXOLON.1/.2/.3 exactly.',
            },
        },
        unpacking: {
            helper: 'tools/recovery/cpc.mjs',
            command:
                'node tools/recovery/cpc.mjs /path/to/exolon,exolon.dsk /path/to/cpc-ram.bin /path/to/cpc-disk-loading.bin /path/to/original-erbe.cdt',
            description:
                'Extended DSK track sectors are sorted by sector ID. CP/M directory extents reconstruct the AMSDOS files, validated with header checksums. Copy EXOLON.1 to 0100 (6add bytes), EXOLON.2 to 6bdd (3424 bytes), EXOLON.3 to a001 (11cc bytes), as the original disk loader does. No CPU, machine ROM or emulator is included or required.',
        },
        decoding: {
            parserAddress: '0x3cdd',
            glyphRendererAddress: '0x3b92',
            blockPointerTable: '0x1305',
            blocks: 62,
            cell: 'Two Mode 0 bytes per row, eight rows. Byte bits 7/3/5/1 form the left ink and 6/2/4/0 the right ink. Native pixels double horizontally to the shared 256x192 coordinates. Attributes retained in the drawing bytecode do not recolor pixels.',
            fontBase: '0x69dd',
            fontActualStart: '0x6bdd',
            fontCharacters: '32..90',
            paletteAddress: '0x3ef0',
            palette:
                'Original gate-array hardware inks; 0/128/255 RGB conversion is a browser presentation choice.',
            sprites:
                'Player at 93cd: 25 frames of 192 bytes (6 bytes/row x 32). Small at a68d: 45 frames of 64 bytes (4 bytes/row x 16). Shifted weapons at 921d: 9 frames of 48 bytes, two 24-byte phases (3 bytes/row x 8). Original software actors XOR pixels.',
            coordinates:
                'Signed local block coordinates, original draw order; shared JavaScript world supplies placements.',
            emptyBlocks: {
                ids: [18, 41, 48, 49, 51],
                explanation:
                    'Original immediate-FF no-op templates. ID18 is unused. ID41 occurs in screen22; IDs48/49 in screens25/26; ID51 in screens25/66. Original definitions remain empty.',
            },
            compatibilityBlocks: {
                ids: [41, 48, 49, 51],
                layout: 'Only shared ZX occupied-cell layouts are retained to display collision geometry. These arrangements are adaptations, not original CPC block definitions.',
                pixels: 'Every tile copies an intact original CPC glyph: ground at 778d glyphs0..3/12..14/16..19, barrel at 8edd glyphs12/14/15/17/18/20. No ZX bitmap bytes, recoloring or newly drawn pixels.',
                absentArtwork:
                    'The CPC 8a4d font ends after19glyphs (redhillglyphs19..27 absent); 8edd ends after21glyphs (diagonalglyphs21..30 absent); original ZX high-voltage font is absent entirely.',
            },
            sourceMapPlacementsSha256: graphics.mapPlacementsSha256,
            sourceMapComparison:
                'All 125 original CPC placement arrays at 490e exactly match world.json placements; checked by the generator.',
            proceduralPixels:
                'Enemy bullet at 1d9a XORs two one-byte scanlines 8a/88 at even native X and 45/44 at odd native X. Beam at 38e5 is the original 55/aa pair repeated eight times; 38ad copies it down a column and 394e removes it with XOR. Bullet at 10f5 XORs bytes 4d/8e for even native X, 04/cf/08 for odd native X. Star template at 302e is zero-filled; 3017 patches byte 3036 with random AND 54 before copying its glyph.',
            sharedWorld:
                'The original CPC code has 125 screen pointers at 490e; the browser deliberately retains the shared ZX-derived maps and behavior.',
        },
        loading: {
            file: 'EXOLON.SCR',
            bytes: loading.length,
            sha256: sha256(loading),
            mode: 1,
            screenWidth: 320,
            screenHeight: 200,
            rowBytes: 80,
            crop: { x: 32, y: 0, width: 256, height: 192 },
            firmwareInks: [0, 5, 18, 26],
            gamePaletteIndices: [0, 15, 5, 11],
            origin: 'Picture preserved by the 1995 Aragorn disk; absent from the verified ERBE cassette. UK cassette editions have a planet loading picture, but byte identity with this disk copy has not been established.',
            reference: 'https://cpcrulez.fr/GamesTest/exolon.htm',
            adaptation:
                'The cropped nonzero pixel mask above y184 exactly matches the original ZX loading picture. The browser masks baked stars using the same cleaned ZX artwork mask, then animates original CPC star sprites. No gameplay palettes or Mode0 artwork are changed.',
        },
        exclusions: [
            'The original define-keys menu at rows 13 and 17 is hidden by the browser adaptation, whose controls are shared across rendering modes.',
        ],
        limitations: [
            'The shared JavaScript world and behavior are adaptations, not a complete CPC gameplay implementation.',
            'Digital RGB and browser scaling do not reproduce an analog CPC display.',
        ],
        rights: 'Original commercial game artwork remains with its original rights holders. Archival availability does not establish a new license.',
    };
    await mkdir(new URL('../../originals/graphics/amstrad-cpc/', import.meta.url), {
        recursive: true,
    });
    await writeFile(
        new URL(
            '../../originals/graphics/amstrad-cpc/cpc-graphics-provenance.json',
            import.meta.url,
        ),
        JSON.stringify(provenance, null, 2) + '\n',
    );
    console.log(
        JSON.stringify(
            {
                output: fileURLToPath(output),
                sha256: sha256(bytes),
                blocks: blocksCount(graphics),
                tableSha256: graphics.tableSha256,
            },
            null,
            2,
        ),
    );
}
const blocksCount = (graphics) => graphics.blocks.length;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
