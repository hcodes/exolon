// Native extraction of Exolon's original C64 bitmap bytecode and actor tables.
// Game artwork: Hewson Consultants; C64 program credit: Nick Jones, 1987.
// Encoding compared with the C64 parser at $3ac3 and the Spectrum recovery code.
// Spectrum recovery attribution: Sergey Erokhin (ESL), CC BY-SA 3.0,
// https://github.com/rusarh/exolon-esl; see research/behavior.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MEMORY_SHA256 = 'd0523af437b42628042a850c8ca69a5619f03f36acf8c66bec414bfffd2b92a4';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byte = (memory, address) => {
    if (!Number.isInteger(address) || address < 0 || address >= memory.length) {
        throw new Error(`Invalid C64 data address: ${address}`);
    }
    return memory[address];
};
const word = (memory, address) => byte(memory, address) | (byte(memory, address + 1) << 8);

/** Decode VIC-II multicolor bitmap cells into 8x8 color indices. */
export function decodeC64Pixels(bitmap, color, ramColor, background = 0) {
    if (bitmap.length !== 8) throw new Error('A C64 bitmap cell needs eight bytes.');
    const colors = [background & 15, (color >> 4) & 15, color & 15, ramColor & 15];
    return bitmap.flatMap((row) =>
        Array.from({ length: 8 }, (_, x) => colors[(row >> (6 - (x >> 1) * 2)) & 3]),
    );
}

/** Interpret data commands only: no CPU, VIC-II or runtime emulation. */
export function decodeC64Block(memory, address, origin = { x: 0, y: 0 }, { clip = true } = {}) {
    const cells = [],
        actions = [];
    const state = {
        x: origin.x,
        y: origin.y,
        font: 0x90ad,
        color: 0,
        ramColor: 0,
        collision: 1,
        overlay: 0,
    };
    let budget = 50000;
    const emit = (glyph) => {
        if (clip && (state.x >= 32 || state.y >= 24)) return;
        const bitmap = Array.from({ length: 8 }, (_, i) =>
            byte(memory, state.font + glyph * 8 + i),
        );
        cells.push({ ...state, glyph, bitmap });
    };
    const execute = (start, depth) => {
        if (depth > 16) throw new Error('C64 block recursion limit exceeded');
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
            } else if (op < 0xdf) state.color = byte(memory, 0x3a9e + op - 0xcf);
            else if (op === 0xdf) {
                state.y = next();
                state.x = next();
            } else if (op === 0xe0) {
                state.color = next();
                state.ramColor = next();
            } else if (op === 0xe1) loops.push({ count: next() || 256, pc, color: state.color });
            else if (op === 0xe2) {
                const loop = loops.at(-1);
                if (!loop) throw new Error('Unmatched C64 block loop');
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
                state.font = 0x91ad;
                emit(0);
                state.font = font;
                state.x = (state.x + 1) & 255;
            } else if (op === 0xe8) state.collision = next();
            else if (op === 0xe9 || op === 0xea) state.overlay = op === 0xea ? 255 : 0;
            else if (op === 0xeb) actions.push({ x: state.x, y: state.y, type: next() });
            else {
                if (loops.length) throw new Error('Unterminated C64 block loop');
                return;
            }
        }
        throw new Error('C64 block instruction limit exceeded');
    };
    execute(address, 0);
    return { cells, actions };
}

export function extractC64Graphics(memory) {
    if (memory.length !== 65536 || sha(memory) !== MEMORY_SHA256)
        throw new Error('Unsupported original C64 memory.');
    const raw = (address, length) => Array.from({ length }, (_, i) => byte(memory, address + i));
    const signed = (n) => (n >= 128 ? n - 256 : n);
    const relative = (cell) => ({ ...cell, x: signed(cell.x), y: signed(cell.y) });
    const blocks = Array.from({ length: 62 }, (_, id) => {
        const address = word(memory, 0x5ed4 + id * 2);
        const decoded = decodeC64Block(memory, address, { x: 0, y: 0 }, { clip: false });
        return {
            id,
            address,
            tiles: decoded.cells.map(relative),
            actions: decoded.actions.map(relative),
        };
    });
    const tables = {
        player: raw(0xa8fd, 25 * 96),
        small: raw(0xb25d, 45 * 32),
        shifted: raw(0xa6bd, 9 * 64),
        font: raw(0x91ad, 59 * 8),
        torch: raw(0x944d, 48),
        mine: raw(0x948d, 32),
        beam: raw(0x94cd, 8),
        turret: raw(0x9745, 128),
    };
    const messageAddresses = {
        menu: 0x39df,
        logo: 0x515f,
        hud: 0x3816,
        scores: 0x459d,
        gameOver: 0x1d9d,
    };
    const screens = Object.fromEntries(
        Object.entries(messageAddresses).map(([name, address]) => [
            name,
            decodeC64Block(memory, address).cells,
        ]),
    );
    return {
        version: 1,
        platform: 'c64',
        width: 256,
        height: 192,
        playfieldHeight: 176,
        memorySha256: MEMORY_SHA256,
        cellEncoding: 'vic-ii-multicolor-bitmap',
        background: 0,
        tableSha256: Object.fromEntries(
            Object.entries(tables).map(([name, bytes]) => [name, sha(Buffer.from(bytes))]),
        ),
        blocks,
        ...tables,
        screens,
        messageAddresses,
    };
}

async function main(args) {
    if (args.length !== 1)
        throw new Error('Usage: node tools/graphics/c64.mjs /path/to/ram-game.bin');
    const memory = await readFile(resolve(args[0]));
    const graphics = extractC64Graphics(memory);
    const output = new URL('../../src/assets/graphics/c64/c64-graphics.json', import.meta.url);
    const bytes = Buffer.from(JSON.stringify(graphics));
    await mkdir(new URL('.', output), { recursive: true });
    await writeFile(output, bytes);
    const provenance = {
        title: 'Exolon — original Commodore 64 graphics',
        version: 1,
        artifact: {
            file: 'c64-graphics.json',
            generator: 'tools/graphics/c64.mjs',
            command: 'node tools/graphics/c64.mjs /path/to/ram-game.bin',
            sha256: sha(bytes),
            bytes: bytes.length,
        },
        source: {
            title: 'Exolon',
            publisher: 'Hewson Consultants',
            year: 1987,
            c64ProgramCredit: 'Nick Jones',
            originalConceptCredit: 'Raffaele Cecco',
            archiveUrl: 'https://www.c64games.de/hugo.php?art=d&fil=230&Dateiname=/e/exolon.zip',
            archiveSha256: '26c6203905c4992d6aaa8661093020629c9da4a10e5411d82518c03414eea641',
            sourcePrg: 'Exolon_(HS).prg',
            sourcePrgSha256: 'ab18247ac7a23b256068d746f348354274c474c71844d4dc16877805de4712b7',
            memoryBytes: 65536,
            memorySha256: MEMORY_SHA256,
            entrySignature: { address: '0x080d', bytes: 'a9ff8d660020e354' },
            notes: 'The archived High Society PRG was unpacked offline with tools/recovery/c64.mjs. Only extracted data is used by the browser; no 6510/VIC-II emulator is shipped.',
        },
        unpacking: {
            helper: 'tools/recovery/c64.mjs',
            command:
                'node tools/recovery/c64.mjs "/path/to/Exolon_(HS).prg" /path/to/jssid.mos6510.js /path/to/ram-game.bin',
            nextCommand: 'node tools/graphics/c64.mjs /path/to/ram-game.bin',
            externalCpu: {
                project: 'jsSID',
                author: 'Joe Hohertz',
                license: 'GPL-2.0',
                sourceUrl:
                    'https://raw.githubusercontent.com/jhohertz/jsSID/develop/js/jssid.mos6510.js',
                gitBlobUrl:
                    'https://api.github.com/repos/jhohertz/jsSID/git/blobs/eb7d7ab7a335338b64a5b1701e9c52fd21515875',
                sha256: 'cdd7ad432f5a7ef5efb45faadbc33da31dcead53b2c6c7cdca8119808803ad16',
                bytes: 36278,
                licenseUrl: 'https://github.com/jhohertz/jsSID/blob/develop/LICENSE.md',
                distribution:
                    'The research helper loads a separately supplied upstream source file. No CPU source or runtime dependency is included in this repository or game.',
            },
            procedure:
                'Exactly 10,000,000 CPU instructions from 0x080d, zero-filled 64 KiB RAM, bank byte 0x37; PAL raster uses 63 cycles per line and 312 lines. Read 0x0800 as 1; read CIA 0xdc01 as 0 only while PC is 0x3500..0x36ff to release the High Society intro, otherwise both CIA ports read 255. Banked KERNAL reads return RTS. Unsupported CPU execution aborts. Both input checksums and the final RAM checksum are required before a new output file is written.',
        },
        decoding: {
            parserAddress: '0x3ac3',
            blockPointerTable: '0x5ed4',
            blocks: 62,
            compactColorTableAddress: '0x3a9e',
            compactColorTable: rawHex(memory, 0x3a9e, 16),
            cell: 'Eight bitmap bytes, screen color byte and color RAM byte; 00=background, 01=screen high nibble, 10=screen low nibble, 11=color RAM low nibble. Each pair is doubled horizontally.',
            coordinates:
                'Block cells retain signed local coordinates and original draw order; the shared world model supplies placements. Static message cells use absolute 32x24 character coordinates.',
            repeat: 'E0 consumes two attribute bytes. E1/E2 restore only screen color. E3 restores x/y/screen color; font and color RAM persist. E7 draws glyph zero at 0x91ad.',
        },
        tables: {
            player: {
                start: '0xa8fd',
                frames: 25,
                frameBytes: 96,
                width: 24,
                height: 32,
                sha256: graphics.tableSha256.player,
            },
            small: {
                start: '0xb25d',
                frames: 45,
                frameBytes: 32,
                width: 16,
                height: 16,
                sha256: graphics.tableSha256.small,
                encoding:
                    'Original software frame bytes; C64 hardware enemy sprites use multicolor pairs, unlike the hires player.',
            },
            shifted: {
                start: '0xa6bd',
                frames: 9,
                frameBytes: 64,
                width: 16,
                height: 8,
                sha256: graphics.tableSha256.shifted,
            },
            font: {
                start: '0x91ad',
                firstCharacter: 32,
                lastCharacter: 90,
                bytes: 472,
                sha256: graphics.tableSha256.font,
            },
            torch: {
                start: '0x944d',
                font: '0x93a5',
                glyphs: '0x15..0x1a',
                frames: 3,
                frameBytes: 16,
                sha256: graphics.tableSha256.torch,
            },
            mine: {
                start: '0x948d',
                font: '0x93a5',
                glyphs: '0x1d..0x20',
                frames: 2,
                frameBytes: 16,
                sha256: graphics.tableSha256.mine,
            },
            beam: {
                start: '0x94cd',
                font: '0x93a5',
                glyph: '0x25',
                bytes: 8,
                sha256: graphics.tableSha256.beam,
            },
            turret: {
                start: '0x9745',
                font: '0x96c5',
                glyphs: '0x10..0x1f',
                frames: 8,
                frameBytes: 16,
                sha256: graphics.tableSha256.turret,
            },
        },
        messageAddresses: graphics.messageAddresses,
        rights: 'Original commercial game artwork remains with its original rights holders. Availability of the archival copy does not establish a new license.',
        decoderAttribution: {
            spectrumDisassembly: 'https://github.com/rusarh/exolon-esl',
            author: 'Sergey Erokhin (ESL)',
            license: 'CC-BY-SA-3.0',
            notes: 'The C64-specific command differences were cross-checked against its original 6510 parser.',
        },
        limitations: [
            'The shared JavaScript world and behavior are adaptations. Asset extraction does not establish complete C64 gameplay fidelity.',
            'Palette conversion and browser scaling are presentation choices, not measured analog C64 video.',
        ],
    };
    await mkdir(new URL('../../originals/graphics/c64/', import.meta.url), { recursive: true });
    await writeFile(
        new URL('../../originals/graphics/c64/c64-graphics-provenance.json', import.meta.url),
        JSON.stringify(provenance, null, 2) + '\n',
    );
    console.log(
        JSON.stringify(
            {
                output: fileURLToPath(output),
                blocks: graphics.blocks.length,
                tables: graphics.tableSha256,
                sha256: sha(bytes),
            },
            null,
            2,
        ),
    );
}
const rawHex = (memory, address, length) =>
    Buffer.from(memory.subarray(address, address + length)).toString('hex');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
