// Offline research helper; never imported by the browser game.
// Supply jsSID's MOS6510 source separately. It is not vendored or distributed here.
// Joe Hohertz, jsSID, GPL v2: https://github.com/jhohertz/jsSID/blob/develop/LICENSE.md
// Pinned upstream Git blob: https://api.github.com/repos/jhohertz/jsSID/git/blobs/eb7d7ab7a335338b64a5b1701e9c52fd21515875
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PRG_SHA256 = 'ab18247ac7a23b256068d746f348354274c474c71844d4dc16877805de4712b7';
const CPU_SHA256 = 'cdd7ad432f5a7ef5efb45faadbc33da31dcead53b2c6c7cdca8119808803ad16';
const RAM_SHA256 = 'd0523af437b42628042a850c8ca69a5619f03f36acf8c66bec414bfffd2b92a4';
const INSTRUCTIONS = 10000000;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Reproduce the exact research snapshot used by the graphics extractor. */
export function unpackC64Prg(program, cpuSource) {
    if (program.length !== 35062 || sha(program) !== PRG_SHA256)
        throw new Error('Unsupported C64 PRG; expected Exolon_(HS).prg.');
    if (cpuSource.length !== 36278 || sha(cpuSource) !== CPU_SHA256)
        throw new Error('Unsupported external jsSID MOS6510 source.');
    const memory = new Uint8Array(65536);
    memory[1] = 0x37;
    memory.set(program.subarray(2), 0x0801);
    let cpu;
    const unsupported = () => {
        throw new Error(
            `External CPU reported unsupported execution at $${cpu?.pc.toString(16) ?? 'initialization'}`,
        );
    };
    const context = vm.createContext({
        jsSID: {},
        console: { log: unsupported, warn: unsupported, error: unsupported },
    });
    vm.runInContext(cpuSource.toString('utf8'), context, {
        filename: 'external-jssid-mos6510.js',
        timeout: 1000,
    });
    cpu = new context.jsSID.MOS6510(memory);
    cpu.cpuResetTo(0x080d, 0);
    let cycles = 0;
    cpu.getmem = (address) => {
        address &= 65535;
        // Deterministic PAL raster input, sufficient for unpacking and the title.
        const raster = Math.floor(cycles / 63) % 312;
        if (address === 0xd012) return raster & 255;
        if (address === 0xd011) return 0x1b | ((raster & 256) >> 1);
        // Release the High Society intro only; do not press game-menu controls.
        if (address === 0x0800) return 1;
        if (address === 0xdc01 && cpu.pc >= 0x3500 && cpu.pc < 0x3700) return 0;
        if (address === 0xdc00 || address === 0xdc01) return 255;
        // The unpacker needs no external KERNAL ROM. Stub banked calls with RTS.
        if (address >= 0xe000 && memory[1] & 2) return 0x60;
        return memory[address];
    };
    for (let step = 0; step < INSTRUCTIONS; step++) {
        cycles += cpu.cpuParse();
        if (!cpu.pc) throw new Error(`Unexpected zero program counter at instruction ${step + 1}.`);
    }
    if (sha(memory) !== RAM_SHA256)
        throw new Error('Unpacked C64 RAM checksum differs from the verified research snapshot.');
    return memory;
}

async function main(args) {
    if (args.length !== 3)
        throw new Error(
            'Usage: node tools/recovery/c64.mjs /path/to/Exolon_(HS).prg /path/to/jssid.mos6510.js /path/to/ram-game.bin',
        );
    const [program, cpuSource] = await Promise.all([
        readFile(resolve(args[0])),
        readFile(resolve(args[1])),
    ]);
    const memory = unpackC64Prg(program, cpuSource);
    const output = resolve(args[2]);
    await writeFile(output, memory, { flag: 'wx' });
    console.log(
        JSON.stringify(
            { output, bytes: memory.length, instructions: INSTRUCTIONS, sha256: sha(memory) },
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
