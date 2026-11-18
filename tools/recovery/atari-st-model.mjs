// Offline extraction only. No Atari CPU, ROM, or disk code runs in the browser.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

export const ATARI_ST_MAIN_SHA256 =
    '2b86fbe9a39a7cffa7970434e9fedca859feefe3998f86a2ee7b56108ca5a638';
export const ATARI_ST_MAIN_BYTES = 52426;
const RAM_BASE = 0x10000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Read only the hash-verified original text, relocated at RAM $10000.
 * Graphics pointers become semantic IDs1..4; trajectory keys retain ST addresses.
 * This entry point deliberately rejects synthetic/unverified memory fixtures. */
export function readAtariStModelTables(mainBytes) {
    if (!(mainBytes instanceof Uint8Array) || mainBytes.length !== ATARI_ST_MAIN_BYTES)
        throw new RangeError('Unexpected Atari ST source text size.');
    if (sha256(mainBytes) !== ATARI_ST_MAIN_SHA256)
        throw new Error('Unsupported Atari ST source text checksum.');
    const view = new DataView(mainBytes.buffer, mainBytes.byteOffset, mainBytes.byteLength);
    const offset = (address, count) => {
        const at = address - RAM_BASE;
        if (
            !Number.isSafeInteger(address) ||
            !Number.isSafeInteger(count) ||
            count < 0 ||
            at < 0 ||
            at + count > mainBytes.length
        )
            throw new RangeError('Atari ST model table address is outside source text bounds.');
        return at;
    };
    const word = (address) => view.getInt16(offset(address, 2));
    const long = (address) => view.getUint32(offset(address, 4));
    const bytes = (address, count) => {
        const at = offset(address, count);
        return Array.from(mainBytes.subarray(at, at + count));
    };
    const words = (address, count) =>
        Array.from({ length: count }, (_, index) => word(address + index * 2));
    const longs = (address, count) =>
        Array.from({ length: count }, (_, index) => long(address + index * 4));
    const pairs = (address, sentinel = 500) => {
        const result = [];
        for (let index = 0; index < 1024; index++, address += 4) {
            const x = word(address);
            if (x === sentinel) return result;
            result.push([x, word(address + 2)]);
        }
        throw new RangeError('Atari ST trajectory has no bounded terminator.');
    };
    const flyerGraphics = new Map([
        [0, 0],
        [0x4bd42, 1],
        [0x4c642, 2],
        [0x4cf42, 3],
        [0x4d842, 4],
    ]);
    const screens = Array.from({ length: 125 }, (_, index) => {
        const [graphics, path] = longs(0x1a8e8 + index * 8, 2);
        const graphicId = flyerGraphics.get(graphics);
        if (graphicId === undefined) throw new Error('Unknown Atari ST flyer graphics pointer.');
        return {
            index,
            pickups: words(0x1a30c + index * 8, 4),
            podTypes: bytes(0x1a6f4 + index * 4, 4),
            flyer: [graphicId, path],
            spikeColumns: bytes(0x1acd0 + index * 3, 3),
            fillDestroyedBodies: bytes(0x1ae47 + index, 1)[0],
            turretTypes: bytes(0x1aec4 + index * 4, 4),
            barrierTypes: bytes(0x1b0b8 + index * 5, 5),
        };
    });
    /** @type {Record<string, number[][]>} */
    const flyerPaths = {};
    const addresses = [...new Set(screens.map((screen) => screen.flyer[1]))]
        .filter(Boolean)
        .sort((a, b) => a - b);
    for (const address of addresses) flyerPaths['0x' + address.toString(16)] = pairs(address);
    return {
        source: 'Original Atari ST AUTO/GAME.PRG from canonical Exolon.stx; recovered and relocated at $10000.',
        jumpVertical: words(0x18614, 15),
        jumpLeft: pairs(0x18634, 255),
        jumpRight: pairs(0x18672, 255),
        grenade: pairs(0x18778),
        podParticles: Array.from({ length: 10 }, (_, index) => words(0x17f04 + index * 4, 2)),
        flyerPaths,
        screens,
        turretBaseGraphics: longs(0x1a208, 3),
        turretAnimationGraphics: longs(0x1a214, 3),
        turretStates: bytes(0x1a220, 3),
        stageEnds: words(0x113d0, 5),
        bonusRoulette: words(0x18b34, 8),
    };
}

export async function renderAtariStModelConstants(model) {
    const target = fileURLToPath(
        new URL('../../src/games/atari-st/constants/index.ts', import.meta.url),
    );
    return format(
        '// Independently recovered original Atari ST tables; native path addresses retained.\n' +
            "import type { NativeModelTables } from '../../16bit/model/index.ts';\n" +
            'export const ATARI_ST_NATIVE = ' +
            JSON.stringify(model, null, 4) +
            ' as const satisfies NativeModelTables;\n' +
            'export const ATARI_ST_PAL_HZ = 50;\n' +
            '// Original native first-screen updates exceed two PAL frame budgets.\n' +
            'export const ATARI_ST_TICK_HZ = ATARI_ST_PAL_HZ / 3;\n',
        { ...(await resolveConfig(target)), parser: 'typescript' },
    );
}

async function main(args) {
    if (args.length < 1 || args.length > 2)
        throw new Error(
            'Usage: node tools/recovery/atari-st-model.mjs /path/to/original-main.bin [constants.ts]',
        );
    const model = readAtariStModelTables(await readFile(resolve(args[0])));
    const constants = await renderAtariStModelConstants(model);
    if (args[1]) await writeFile(resolve(args[1]), constants, { flag: 'wx' });
    else process.stdout.write(constants);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
