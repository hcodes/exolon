// Offline reconstruction of the original Amiga PAL disk reads; no CPU runtime.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AMIGA_DISK_SHA256 = '54260a1b4f95b18b115ef69d5f90cbc7a584e74c28572e7296e80196989ee8d1';
export const AMIGA_INITIAL_RAM_SHA256 =
    '8eb436440c0f6af0381079341779e24dcbd21d485144f2dcacb059a7e9c724e7';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const word = (bytes, offset) => (bytes[offset] << 8) | bytes[offset + 1];
const long = (bytes, offset) => word(bytes, offset) * 65536 + word(bytes, offset + 2);

export function readAmigaLoadPlan(startup) {
    if (startup.length !== 0x3c2 || word(startup, 0) !== 0x2e7c)
        throw new Error('Incomplete Amiga startup code.');
    let source, target, length;
    const loads = [];
    for (let offset = 0x2e; offset < startup.length;) {
        const opcode = word(startup, offset);
        if (opcode === 0x43f9) {
            source = long(startup, offset + 2);
            offset += 6;
        } else if (opcode === 0x2c3c) offset += 6;
        else if (opcode === 0x3e3c || opcode === 0x2e3c) {
            length = opcode === 0x3e3c ? word(startup, offset + 2) : long(startup, offset + 2);
            offset += opcode === 0x3e3c ? 4 : 6;
        } else if (opcode === 0x23fc && long(startup, offset + 6) === 0xfbba) {
            target = long(startup, offset + 2);
            offset += 10;
        } else if (opcode === 0x6100) {
            const displacement = (word(startup, offset + 2) << 16) >> 16;
            if (
                0x8000 + offset + 2 + displacement !== 0xee52 ||
                ![source, target, length].every(Number.isInteger)
            )
                throw new Error('Unexpected Amiga startup read.');
            loads.push({ source, target, length });
            offset += 4;
        } else if (offset === 0x398 && opcode === 0x23f9) offset += 10;
        else throw new Error(`Unsupported Amiga startup instruction at ${offset.toString(16)}.`);
    }
    if (loads.length !== 30) throw new Error('Incomplete Amiga startup read sequence.');
    return loads;
}

export function copyAmigaRegions(disk, regions) {
    const memory = new Uint8Array(0x80000);
    for (const { source, target, length } of regions) {
        if (
            ![source, target, length].every(Number.isInteger) ||
            source < 0 ||
            target < 0 ||
            length < 1 ||
            source + length > disk.length ||
            target + length > memory.length
        )
            throw new RangeError('Invalid Amiga disk region.');
        memory.set(disk.subarray(source, source + length), target);
    }
    return memory;
}

export function recoverAmigaMemory(disk) {
    if (disk.length !== 901120) throw new Error('Unexpected Amiga disk size.');
    if (hash(disk) !== AMIGA_DISK_SHA256) throw new Error('Unsupported Amiga disk checksum.');
    const loads = [
        { source: 0x12800, target: 0x8000, length: 0xb400 },
        { source: 0x1dc00, target: 0x15000, length: 0x1800 },
        { source: 0x8a00, target: 0x70600, length: 0x9e00 },
        { source: 0x1ec00, target: 0x5da00, length: 0x800 },
        { source: 0x1f400, target: 0x5e4f0, length: 0x9e00 },
        ...readAmigaLoadPlan(disk.subarray(0x12800, 0x12bc2)),
    ];
    const memory = copyAmigaRegions(disk, loads);
    if (hash(memory) !== AMIGA_INITIAL_RAM_SHA256)
        throw new Error('Amiga startup recovery checksum mismatch.');
    return { memory, loads };
}

async function main(args) {
    if (args.length !== 2)
        throw new Error(
            'Usage: node tools/recovery/amiga.mjs /path/to/Disk.1 /path/to/amiga-ram.bin',
        );
    const result = recoverAmigaMemory(await readFile(resolve(args[0])));
    await writeFile(resolve(args[1]), result.memory, { flag: 'wx' });
    console.log(JSON.stringify({ loads: result.loads.length, sha256: hash(result.memory) }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
