// Original game graphics: Raffaele Cecco / Hewson, disassembly Sergey Erokhin.
// Source-derived data and decoder attribution: CC BY-SA 3.0; research/behavior.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverWorld, browserWorld, decodeBlock } from '../recovery/world.mjs';

const sha = (data) => createHash('sha256').update(data).digest('hex');
export function extractGraphics(memory, loadingScr, world) {
    if (
        memory.length !== 65536 ||
        sha(memory) !== '2ee3509dc114d70a2bd2d7e22ada889d93088091964380e4b2583341e41617b5'
    )
        throw new Error('Unsupported original TAP memory.');
    if (
        loadingScr.length !== 6912 ||
        sha(loadingScr) !== '327fa6c5d945415fe627e5c86478e69162cc6317f4a7acfc0512727c8f375654'
    )
        throw new Error('Unsupported original loading screen.');
    const recovered = recoverWorld(memory),
        compact = browserWorld(recovered);
    if (JSON.stringify(world.contours) !== JSON.stringify(compact.contours))
        throw new Error('World bitmap/contour indices differ; regenerate matching assets.');
    const shapes = compact.contours.map(() => null);
    const add = (tile, source) => {
        if (!tile) return;
        const bytes = source.bitmap;
        if (shapes[tile.shape] && JSON.stringify(shapes[tile.shape]) !== JSON.stringify(bytes))
            throw new Error('Ambiguous source bitmap.');
        shapes[tile.shape] = bytes;
    };
    compact.screens.forEach((screen, index) =>
        screen.tiles.forEach((tile, offset) => add(tile, recovered.screens[index].tiles[offset])),
    );
    compact.pump.tiles.forEach((tile, index) => add(tile, recovered.pump.tiles[index]));
    shapes[0] = Array(8).fill(0);
    if (shapes.some((shape) => !shape)) throw new Error('Missing original tile bitmap.');
    const raw = (address, length) => Array.from(memory.slice(address, address + length));
    const tables = {
        player: raw(0xef80, 25 * 96),
        small: raw(0xf8e0, 45 * 32),
        shifted: raw(0xed40, 9 * 64),
        font: raw(0xd8e0, 59 * 8),
    };
    const addresses = {
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
    const screens = Object.fromEntries(
        Object.entries(addresses).map(([name, address]) => [
            name,
            decodeBlock(memory, address, { x: 0, y: 0 }).cells.map(({ x, y, bitmap, color }) => ({
                x,
                y,
                bitmap,
                color,
            })),
        ]),
    );
    return {
        version: 1,
        width: 256,
        height: 192,
        playfieldHeight: 176,
        memorySha256: sha(memory),
        loadingSha256: sha(loadingScr),
        worldContoursSha256: sha(JSON.stringify(world.contours)),
        tableSha256: Object.fromEntries(
            Object.entries(tables).map(([name, bytes]) => [name, sha(Buffer.from(bytes))]),
        ),
        shapes,
        ...tables,
        screens,
        loading: Array.from(loadingScr),
        torch: raw(0xdb60, 48),
        beam: raw(0xdbe0, 8),
        mine: raw(0xdba0, 32),
        star: raw(0xe858, 8),
        turret: raw(0xde58, 128),
        messageAddresses: addresses,
    };
}
async function main(args) {
    if (args.length !== 2)
        throw new Error(
            'Usage: npm run graphics:zx -- /path/to/memory.bin /path/to/original-exolon.sna',
        );
    const memory = await readFile(resolve(args[0])),
        snapshot = await readFile(resolve(args[1]));
    if (snapshot.length !== 49179) throw new Error('Expected a 48K SNA snapshot.');
    const world = JSON.parse(
        await readFile(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    const graphics = extractGraphics(memory, snapshot.subarray(27, 27 + 6912), world);
    const output = new URL('../../src/assets/graphics/zx-spectrum/graphics.json', import.meta.url);
    await mkdir(new URL('.', output), { recursive: true });
    await writeFile(output, JSON.stringify(graphics));
    console.log(
        JSON.stringify(
            {
                output: fileURLToPath(output),
                shapes: graphics.shapes.length,
                tables: graphics.tableSha256,
                loadingSha256: graphics.loadingSha256,
                sha256: sha(await readFile(output)),
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
