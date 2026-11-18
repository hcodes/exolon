// Offline source research only. Never imported by the browser game.
// Supply the separately obtained GPL-2.0 jsSID MOS6510 source; it is not vendored.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAM_SHA256 = 'd0523af437b42628042a850c8ca69a5619f03f36acf8c66bec414bfffd2b92a4';
const CPU_SHA256 = 'cdd7ad432f5a7ef5efb45faadbc33da31dcead53b2c6c7cdca8119808803ad16';
const PAL_CLOCK = 985248;
const INSTRUCTION_LIMIT = 12000000;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const names = (object) => new Map(Object.entries(object).map(([key, value]) => [value, key]));

export function measureC64Motion(sourceMemory, cpuSource, options = {}) {
    const { scenario = 'right', stall = 'dma', samples = 120 } = options;
    if (sourceMemory.length !== 65536 || sha256(sourceMemory) !== RAM_SHA256)
        throw new Error('Expected the verified RAM snapshot produced by tools/recovery/c64.mjs.');
    if (cpuSource.length !== 36278 || sha256(cpuSource) !== CPU_SHA256)
        throw new Error('Expected the pinned external jsSID MOS6510 source.');
    if (!['right', 'jump', 'idle'].includes(scenario)) throw new Error('Unknown input scenario.');
    if (!['none', 'dma', 'ba'].includes(stall)) throw new Error('Unknown VIC stall model.');
    if (!Number.isInteger(samples) || samples < 29 || samples > 120)
        throw new Error('Samples must be an integer between 29 and 120.');

    const memory = Uint8Array.from(sourceMemory);
    let cpu;
    const unsupported = (...values) => {
        throw new Error(
            `Unsupported CPU execution at $${cpu?.pc.toString(16)}: ${values.join(' ')}`,
        );
    };
    const context = vm.createContext({
        jsSID: {},
        console: { log: unsupported, warn: unsupported, error: unsupported },
    });
    vm.runInContext(cpuSource.toString('utf8'), context, { timeout: 1000 });
    const Cpu = context.jsSID.MOS6510;
    cpu = new Cpu(memory);
    cpu.cpuResetTo(0x1395, 0);
    const instructionNames = names(Cpu.inst);
    const modeNames = names(Cpu.mode);
    const loops = [];
    const playerUpdates = [];
    const blocked = new Uint8Array(63);
    let wallCycles = 0;
    let cpuInstructionCycles = 0;
    let irq = false;
    let instructions = 0;

    // jsSID undercounts indexed stores. Account for NMOS 6502 instruction cycles
    // separately; its arithmetic execution remains an explicitly documented limit.
    function instructionCycles() {
        const pc = cpu.pc;
        const [instruction, mode] = Cpu.opcodes[memory[pc]];
        const name = instructionNames.get(instruction);
        const addressing = modeNames.get(mode);
        const operand = memory[(pc + 1) & 65535] | (memory[(pc + 2) & 65535] << 8);
        if (['rti', 'rts', 'jsr'].includes(name)) return 6;
        if (name === 'jmp') return addressing === 'ind' ? 5 : 3;
        if (['pha', 'php'].includes(name)) return 3;
        if (['pla', 'plp'].includes(name)) return 4;
        if (addressing === 'rel') return 2;
        if (['asl', 'lsr', 'rol', 'ror', 'inc', 'dec'].includes(name) && addressing !== 'acc')
            return { zp: 5, zpx: 6, abs: 6, absx: 7 }[addressing];
        if (['sta', 'stx', 'sty'].includes(name))
            return { zp: 3, zpx: 4, zpy: 4, abs: 4, absx: 5, absy: 5, indx: 6, indy: 6 }[
                addressing
            ];
        let count = {
            imp: 2,
            acc: 2,
            imm: 2,
            zp: 3,
            zpx: 4,
            zpy: 4,
            abs: 4,
            absx: 4,
            absy: 4,
            indx: 6,
            indy: 5,
        }[addressing];
        const base =
            addressing === 'indy'
                ? memory[memory[pc + 1]] | (memory[(memory[pc + 1] + 1) & 255] << 8)
                : operand;
        const offset =
            addressing === 'absx' ? cpu.x : ['absy', 'indy'].includes(addressing) ? cpu.y : 0;
        if (offset && ((base + offset) & 0xff00) !== (base & 0xff00)) count++;
        return count;
    }

    // Sample VIC registers at line boundaries. DMA uses only stolen fetch cycles;
    // BA adds all three warning cycles, while real RDY stalls only CPU reads.
    // This approximates sprite state/latching; it is not a cycle-exact VIC model.
    function wallTick() {
        wallCycles++;
        const line = Math.floor(wallCycles / 63) % 312;
        if (wallCycles % 63 !== 0) return;
        blocked.fill(0);
        if (line === memory[0xd012]) irq = true;
        if (
            stall !== 'none' &&
            line >= 0x30 &&
            line <= 0xf7 &&
            (line & 7) === (memory[0xd011] & 7)
        ) {
            for (let position = stall === 'ba' ? 11 : 14; position < 54; position++)
                blocked[position] = 1;
        }
        if (stall !== 'none') {
            for (let sprite = 0; sprite < 8; sprite++) {
                const y = memory[0xd001 + sprite * 2];
                if (!(memory[0xd015] & (1 << sprite)) || line < y || line >= y + 21) continue;
                const start = [57, 59, 61, 0, 2, 4, 6, 8][sprite];
                for (let position = stall === 'ba' ? -3 : 0; position < 2; position++)
                    blocked[(start + position + 63) % 63] = 1;
            }
        }
    }
    function advance(count) {
        for (let cycle = 0; cycle < count; cycle++) {
            wallTick();
            while (blocked[wallCycles % 63]) wallTick();
        }
    }
    cpu.getmem = (address) => {
        address &= 65535;
        const raster = Math.floor(wallCycles / 63) % 312;
        if (address === 0xd012) return raster & 255;
        if (address === 0xd011) return (memory[address] & 127) | ((raster & 256) >> 1);
        if (address === 0xd019) return irq ? 1 : 0;
        if (address === 0xdc00) return 255;
        if (address === 0xdc01) {
            if (cpu.pc >= 0x3cfb && cpu.pc < 0x3d12) {
                const column = memory[0xdc00];
                if (scenario === 'right' && column === 0xdf) return 0xfd;
                if (scenario === 'jump' && column === 0x7f) return 0xbf;
            }
            return 255;
        }
        return memory[address];
    };
    cpu.setmem = (address, value) => {
        address &= 65535;
        value &= 255;
        if (address === 0xd019) {
            if (value & 1) irq = false;
            return;
        }
        memory[address] = value;
    };

    for (; instructions < INSTRUCTION_LIMIT; instructions++) {
        if (irq && !(cpu.p & 4)) {
            cpu.push(cpu.pc >> 8);
            cpu.push(cpu.pc & 255);
            cpu.push(cpu.p & ~16);
            cpu.p |= 4;
            cpu.pc = memory[0xfffe] | (memory[0xffff] << 8);
            advance(7);
        }
        if (cpu.pc === 0x13c4) {
            loops.push({
                wallCycles,
                cpuInstructionCycles,
                x: memory[0x20],
                y: memory[0x21],
                jumpIndex: memory[0x1e],
                animationIndex: memory[0x3f],
                level: memory[0x13],
            });
            if (loops.length === samples) break;
        }
        if (cpu.pc === 0x1b7b) {
            playerUpdates.push({
                wallCycles,
                x: memory[0x0c],
                y: memory[0x0d],
                jumpIndex: memory[0x1e],
                animationIndex: memory[0x3f],
                frame: cpu.a,
            });
        }
        const previousPc = cpu.pc;
        const addressing = modeNames.get(Cpu.opcodes[memory[previousPc]][1]);
        let count = instructionCycles();
        if (!Number.isInteger(count)) throw new Error('Instruction has no supported cycle count.');
        if (memory[cpu.pc] === 0x40) {
            // The external audio helper treats RTI as RTS. Restore real IRQ state.
            cpu.p = cpu.pop();
            cpu.pc = cpu.pop() | (cpu.pop() << 8);
        } else {
            cpu.cpuParse();
            if (addressing === 'rel' && cpu.pc !== previousPc + 2)
                count += 1 + (((previousPc + 2) & 0xff00) !== (cpu.pc & 0xff00) ? 1 : 0);
        }
        cpuInstructionCycles += count;
        advance(count);
    }
    if (loops.length !== samples)
        throw new Error('Instruction budget exhausted before sample limit.');
    const summarize = (updates) => {
        const elapsed = loops[updates].wallCycles - loops[0].wallCycles;
        return {
            updates,
            wallCycles: elapsed,
            millisecondsPerUpdate: (elapsed / updates / PAL_CLOCK) * 1000,
            updatesPerSecond: (PAL_CLOCK * updates) / elapsed,
            physicalPixelsPerSecondAtTwoPixelsPerUpdate: (2 * PAL_CLOCK * updates) / elapsed,
        };
    };
    return {
        scenario,
        stall,
        samples,
        instructions,
        inputs: { ramSha256: RAM_SHA256, cpuSha256: CPU_SHA256 },
        pal: { cyclesPerSecond: PAL_CLOCK, cyclesPerLine: 63, linesPerFrame: 312 },
        first28Updates: summarize(28),
        first22Updates: summarize(22),
        loops,
        playerUpdates,
        limits: 'Custom instruction-boundary model, not a cycle-exact VIC/CIA emulator or hardware measurement. See research/motion-c64.md.',
    };
}

async function main(args) {
    if (args.length < 3 || args.length > 5)
        throw new Error(
            'Usage: node tools/recovery/timing/c64.mjs RAM.bin MOS6510.js right|jump|idle [none|dma|ba] [samples=120]',
        );
    const [ramPath, cpuPath, scenario, stall = 'dma', sampleText = '120'] = args;
    const [memory, cpuSource] = await Promise.all([
        readFile(resolve(ramPath)),
        readFile(resolve(cpuPath)),
    ]);
    console.log(
        JSON.stringify(
            measureC64Motion(memory, cpuSource, {
                scenario,
                stall,
                samples: Number(sampleText),
            }),
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
