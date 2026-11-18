// Original Exolon artwork: Raffaele Cecco / Hewson; Sharp adaptation: Datelsoft.
// Drawing-data decoding follows Sergey Erokhin's CC BY-SA 3.0 disassembly.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverWorld, browserWorld, decodeBlock } from '../recovery/world.mjs';
import { sha256, SHARP_MZF_SHA256, SHARP_RAM_SHA256 } from '../recovery/sharp.mjs';

export function reverseSharpByte(value) {
    value = ((value & 0x55) << 1) | ((value >>> 1) & 0x55);
    value = ((value & 0x33) << 2) | ((value >>> 2) & 0x33);
    return ((value & 15) << 4) | (value >>> 4);
}
export function decodeSharpBlock(memory, address, origin = { x: 0, y: 0 }) {
    const result = decodeBlock(memory, address, origin);
    return {
        ...result,
        cells: result.cells.map((cell) => ({ ...cell, bitmap: cell.bitmap.map(reverseSharpByte) })),
    };
}

export function extractSharpGraphics(memory, world) {
    if (memory.length !== 65536 || sha256(memory) !== SHARP_RAM_SHA256)
        throw new Error('Unsupported archived Datelsoft Sharp memory.');
    const recovered = recoverWorld(memory);
    for (const screen of recovered.screens)
        for (const tile of screen.tiles) if (tile) tile.bitmap = tile.bitmap.map(reverseSharpByte);
    for (const tile of recovered.pump.tiles) tile.bitmap = tile.bitmap.map(reverseSharpByte);
    const compact = browserWorld(recovered);
    // The 125 placement maps, tile attributes, collision flags and shape IDs
    // match the shared model. Shape 451's bitmap has a one-pixel source change.
    for (let index = 0; index < 125; index++) {
        const actual = compact.screens[index],
            expected = world.screens[index];
        if (
            JSON.stringify(actual.tiles) !== JSON.stringify(expected.tiles) ||
            JSON.stringify(actual.placements) !== JSON.stringify(expected.placements)
        )
            throw new Error(`Sharp/shared screen ${index} differs; matching assets are required.`);
    }
    if (
        JSON.stringify(compact.pump) !== JSON.stringify(world.pump) ||
        compact.contours.length !== world.contours.length
    )
        throw new Error('Sharp/shared pump or shape indices differ.');
    const shapes = compact.contours.map(() => null);
    const add = (tile, source) => {
        if (!tile) return;
        if (
            shapes[tile.shape] &&
            JSON.stringify(shapes[tile.shape]) !== JSON.stringify(source.bitmap)
        )
            throw new Error('Ambiguous Sharp bitmap for shared shape.');
        shapes[tile.shape] = source.bitmap;
    };
    compact.screens.forEach((screen, index) =>
        screen.tiles.forEach((tile, offset) => add(tile, recovered.screens[index].tiles[offset])),
    );
    compact.pump.tiles.forEach((tile, index) => add(tile, recovered.pump.tiles[index]));
    shapes[0] = Array(8).fill(0);
    if (shapes.some((shape) => !shape)) throw new Error('Missing source Sharp bitmap.');
    const ranges = {
        player: [0xef80, 2400],
        small: [0xf8e0, 1440],
        shifted: [0xed40, 576],
        font: [0xd8e0, 472],
        torch: [0xdb60, 48],
        beam: [0xdbe0, 8],
        mine: [0xdba0, 32],
        star: [0xe858, 8],
        turret: [0xde58, 128],
    };
    const rawTables = Object.fromEntries(
        Object.entries(ranges).map(([name, [address, length]]) => [
            name,
            Array.from(memory.subarray(address, address + length)),
        ]),
    );
    const tables = Object.fromEntries(
        Object.entries(rawTables).map(([name, bytes]) => [name, bytes.map(reverseSharpByte)]),
    );
    const messageAddresses = {
        menu: 0x6e17,
        logo: 0x70ff,
        scores: 0x718d,
        hud: 0x76a2,
        gameOver: 0xa057,
        hallOfFame: 0xa156,
        bonus: 0xa961,
        combat: 0xaa3f,
        bravery: 0xaaf2,
    };
    const decoded = Object.fromEntries(
        Object.entries(messageAddresses).map(([name, address]) => [
            name,
            decodeSharpBlock(memory, address).cells,
        ]),
    );
    const screens = Object.fromEntries(
        Object.entries(decoded).map(([name, cells]) => [
            name,
            cells.map(({ x, y, bitmap, color }) => ({ x, y, bitmap, color })),
        ]),
    );
    const menuText = Array.from({ length: 24 }, (_, y) => ({
        y,
        text: decoded.menu
            .filter((cell) => cell.y === y && cell.font === 0xd7e0)
            .map((cell) => String.fromCharCode(cell.glyph))
            .join(''),
    })).filter((row) => row.text);
    const sourceHighScores = Array.from({ length: 50 }, (_, row) => {
        const record = Buffer.from(memory.subarray(0x71f1 + row * 16, 0x7201 + row * 16)).toString(
            'ascii',
        );
        if (!/^.{10}\d{6}$/.test(record)) throw new Error('Invalid Sharp source score record.');
        return { name: record.slice(0, 10).trimEnd(), score: Number(record.slice(10)) };
    });
    return {
        version: 1,
        platform: 'sharp-mz800',
        width: 320,
        height: 200,
        playfieldHeight: 176,
        cellEncoding: 'sharp-mz800-1bpp',
        sourceMZFSha256: SHARP_MZF_SHA256,
        sourceRamSha256: SHARP_RAM_SHA256,
        memorySha256: SHARP_RAM_SHA256,
        worldContoursSha256: sha256(JSON.stringify(world.contours)),
        sourceContoursSha256: sha256(JSON.stringify(compact.contours)),
        sourceMapsSha256: sha256(
            JSON.stringify(compact.screens.map((screen) => screen.placements)),
        ),
        sourceTableSha256: Object.fromEntries(
            Object.entries(rawTables).map(([name, bytes]) => [name, sha256(Buffer.from(bytes))]),
        ),
        tableSha256: Object.fromEntries(
            Object.entries(tables).map(([name, bytes]) => [name, sha256(Buffer.from(bytes))]),
        ),
        shapes,
        ...tables,
        screens,
        messageAddresses,
        menuText,
        sourceHighScores,
        adaptations: {
            display: '320x200 original Datelsoft sixteen-color mode',
            sourceDisplay:
                'Datelsoft archive initializes sixteen-color mode with the MZ-1R25 video RAM expansion',
            bitmapNormalization: 'Original LSB-first rows reversed to shared MSB-first encoding',
            logicalPlayfield:
                'Shared 256x176 model centered within the native 320x200 presentation',
            sharedCollisionModel:
                'Shape 451 retains shared collisions while its original Sharp bitmap is preserved',
        },
    };
}
async function main(args) {
    if (args.length !== 1)
        throw new Error('Usage: node tools/graphics/sharp.mjs /path/to/sharp-ram.bin');
    const world = JSON.parse(
        await readFile(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    const graphics = extractSharpGraphics(await readFile(resolve(args[0])), world);
    const output = new URL('../../src/assets/graphics/sharp-mz800/graphics.json', import.meta.url);
    await mkdir(new URL('.', output), { recursive: true });
    await writeFile(output, JSON.stringify(graphics));
    console.log(
        JSON.stringify(
            {
                output: fileURLToPath(output),
                sha256: sha256(await readFile(output)),
                shapes: graphics.shapes.length,
                tables: graphics.tableSha256,
            },
            null,
            2,
        ),
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
