// Offline reconstruction of the archived Datelsoft MZ-800 tape loader.
// The external MIT Z80 interpreter is used only by this research tool.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARP_MZF_SHA256 = '57bf60e91a20d1f0357bd1fac0048fdca27381b7b29789511a7665a2191b35cf';
export const SHARP_RAM_SHA256 = '108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f';
export const SHARP_CPU_SHA256 = '78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const word = (bytes, address) => bytes[address] | (bytes[address + 1] << 8);

export function readSharpMzf(bytes) {
    if (bytes.length < 128) throw new Error('Truncated Sharp MZF header.');
    const length = word(bytes, 18),
        load = word(bytes, 20),
        execute = word(bytes, 22);
    if (bytes[0] !== 1 || bytes.length !== 128 + length || load + length > 65536)
        throw new Error('Invalid Sharp MZF machine-code record.');
    return { length, load, execute, body: bytes.subarray(128) };
}

/** Reproduce the header LDDR and the original $6d4b bootstrap, stopping before game entry. */
export function recoverSharpMemory(mzf, cpuSource) {
    const record = readSharpMzf(mzf);
    if (sha256(mzf) !== SHARP_MZF_SHA256)
        throw new Error('Unsupported archived Datelsoft Sharp MZF.');
    if (sha256(cpuSource) !== SHARP_CPU_SHA256)
        throw new Error('Unsupported offline Z80 interpreter.');
    if (record.length !== 38560 || record.load !== 0x3960 || record.execute !== 0x1108)
        throw new Error('Unexpected Sharp loader addresses.');
    const memory = new Uint8Array(65536);
    memory.set(record.body, record.load);
    // Header: HL=$d000, DE=$0000, BC=$9700, LDDR. DE wraps at zero;
    // descending order matters because the source and destination overlap.
    for (let offset = 0; offset < 0x9700; offset++)
        memory[-offset & 65535] = memory[(0xd000 - offset) & 65535];
    const context = createContext({ window: {} });
    runInContext(String(cpuSource), context, { timeout: 1000 });
    const cpu = new context.Z80({
        mem_read: (address) => memory[address],
        mem_write: (address, value) => {
            memory[address] = value;
        },
        io_read: () => 255,
        io_write: () => {},
    });
    cpu.setState({ ...cpu.getState(), pc: 0x6d4b });
    let instructions = 0;
    while (cpu.getState().pc !== 0x6d60 && instructions < 10000) {
        cpu.run_instruction();
        instructions++;
    }
    if (instructions !== 1056 || sha256(memory) !== SHARP_RAM_SHA256)
        throw new Error('Sharp bootstrap did not produce the verified RAM image.');
    return { memory, instructions, stopPc: 0x6d60 };
}

async function main(args) {
    if (args.length !== 3)
        throw new Error(
            'Usage: node tools/recovery/sharp.mjs /path/to/exolnew.mzf /path/to/Z80.js /path/to/sharp-ram.bin',
        );
    const result = recoverSharpMemory(
        await readFile(resolve(args[0])),
        await readFile(resolve(args[1])),
    );
    await writeFile(resolve(args[2]), result.memory, { flag: 'wx' });
    console.log(
        JSON.stringify(
            {
                instructions: result.instructions,
                stopPc: result.stopPc,
                memorySha256: sha256(result.memory),
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
