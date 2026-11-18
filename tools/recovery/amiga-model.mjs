// Offline extraction of original Amiga model tables; never imported by the game.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { AMIGA_INITIAL_RAM_SHA256, recoverAmigaMemory } from './amiga.mjs';

const sha256 = (memory) => createHash('sha256').update(memory).digest('hex');

/** Low-level decoder for bounded, independently constructed test RAM fixtures.
 * Production extraction must use extractAmigaModel, which verifies the source hash. */
export function readAmigaModelTables(memory) {
    if (!(memory instanceof Uint8Array) || memory.length < 0x122ed)
        throw new RangeError('Amiga model RAM size is below table bounds.');
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    const bounds = (address, count) => {
        if (!Number.isInteger(address) || address < 0 || address + count > memory.length)
            throw new RangeError('Amiga model table address is outside RAM bounds.');
    };
    const word = (address) => {
        bounds(address, 2);
        return view.getInt16(address);
    };
    const long = (address) => {
        bounds(address, 4);
        return view.getUint32(address);
    };
    const bytes = (address, count) => {
        bounds(address, count);
        return Array.from(memory.subarray(address, address + count));
    };
    const words = (address, count) =>
        Array.from({ length: count }, (_, i) => word(address + i * 2));
    const longs = (address, count) =>
        Array.from({ length: count }, (_, i) => long(address + i * 4));
    const pairs = (address, sentinel = 500) => {
        const result = [];
        for (let i = 0; i < 1024; i++, address += 4) {
            const x = word(address);
            if (x === sentinel) return result;
            result.push([x, word(address + 2)]);
        }
        throw new RangeError('Amiga trajectory has no terminator within1024 pairs.');
    };
    const screens = Array.from({ length: 125 }, (_, index) => ({
        index,
        pickups: words(0x112d0 + index * 8, 4),
        podTypes: bytes(0x116b8 + index * 4, 4),
        flyer: longs(0x118ac + index * 8, 2),
        spikeColumns: bytes(0x11c94 + index * 3, 3),
        fillDestroyedBodies: bytes(0x11e0b + index, 1)[0],
        turretTypes: bytes(0x11e88 + index * 4, 4),
        barrierTypes: bytes(0x1207c + index * 5, 5),
    }));
    /** @type {Record<string, number[][]>} */
    const flyerPaths = {};
    const addresses = [...new Set(screens.map((screen) => screen.flyer[1]))]
        .filter(Boolean)
        .sort((a, b) => a - b);
    for (const address of addresses) flyerPaths['0x' + address.toString(16)] = pairs(address);
    return {
        source: 'recovered-ram.bin; original Disk.1 code starts $8000',
        jumpVertical: words(0xf896, 15),
        jumpLeft: pairs(0xf8b6, 255),
        jumpRight: pairs(0xf8f4, 255),
        grenade: pairs(0xf9fa),
        podParticles: Array.from({ length: 10 }, (_, i) => words(0xf186 + i * 4, 2)),
        flyerPaths,
        screens,
        turretBaseGraphics: longs(0x111cc, 3),
        turretAnimationGraphics: longs(0x111d8, 3),
        turretStates: bytes(0x111e4, 3),
        stageEnds: words(0x92a2, 5),
        bonusRoulette: words(0xfbec, 8),
    };
}

export function extractAmigaModel(memory) {
    if (!(memory instanceof Uint8Array) || memory.length !== 0x80000)
        throw new RangeError('Unexpected Amiga source RAM size.');
    if (sha256(memory) !== AMIGA_INITIAL_RAM_SHA256)
        throw new Error('Unsupported Amiga model source RAM checksum.');
    return readAmigaModelTables(memory);
}

export async function renderAmigaModelConstants(model) {
    const target = fileURLToPath(
        new URL('../../src/games/amiga/constants/index.ts', import.meta.url),
    );
    const source =
        '/** Original Amiga tables: $f896 jumps; $f9fa grenade; $112d0..$122ed screen metadata. */\n' +
        'export const AMIGA_NATIVE = ' +
        JSON.stringify(model, null, 4) +
        ' as const;\n\n' +
        'export const AMIGA_WIDTH = 320;\nexport const AMIGA_HEIGHT = 200;\n' +
        '// PAL display refresh is separate from the CPU-bound original gameplay loop.\n' +
        '// Source CPU traces exceed two PAL frame budgets; use three VBLs as the baseline.\n' +
        '// This is A500 pacing, not a claim of cycle-exact chipset/DMA emulation.\n' +
        'export const AMIGA_PAL_HZ = 50;\nexport const AMIGA_TICK_HZ = AMIGA_PAL_HZ / 3;\n';
    return format(source, { ...(await resolveConfig(target)), parser: 'typescript' });
}

async function main(args) {
    if (args.length < 1 || args.length > 2)
        throw new Error(
            'Usage: node tools/recovery/amiga-model.mjs /path/to/Disk.1 [constants.ts]',
        );
    const { memory } = recoverAmigaMemory(await readFile(resolve(args[0])));
    const model = extractAmigaModel(memory);
    const source = await renderAmigaModelConstants(model);
    if (args[1]) await writeFile(resolve(args[1]), source, { flag: 'wx' });
    else process.stdout.write(source);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
