// Execute the verified commercial CPC code offline; no CPU is shipped to browsers.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { cpcCycles } from './cpc-cycles.mjs';

const MEMORY_SHA256 = '496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec';
const CPU_SHA256 = '78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const range = (values) => ({
    mean: average(values),
    min: Math.min(...values),
    max: Math.max(...values),
});

function capture(Z80, source, mode) {
    const memory = Uint8Array.from(source);
    let cycles = 0;
    let instructions = 0;
    const inputPorts = new Set();
    const opcodes = new Map();
    const cpu = new Z80({
        mem_read: (address) => memory[address],
        mem_write: (address, value) => {
            memory[address] = value;
        },
        io_read: (port) => {
            inputPorts.add(port >> 8);
            return port >> 8 === 0xf6 ? 0x30 : 0xff;
        },
        io_write: () => {},
    });
    function step() {
        const pc = cpu.getState().pc;
        // Preserve opcodes before execution: the original renderer self-modifies.
        const bytes = memory.slice(pc, pc + 4);
        const baseCycles = cpu.run_instruction();
        cycles += cpcCycles(bytes, 0, baseCycles);
        instructions++;
        const key = Array.from(bytes.slice(0, [0xcb, 0xed, 0xdd, 0xfd].includes(bytes[0]) ? 2 : 1))
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
        opcodes.set(key, (opcodes.get(key) || 0) + 1);
        if (cpu.getState().halted) throw new Error(`Unexpected HALT at ${pc.toString(16)}`);
    }
    function until(address) {
        for (let budget = 20000000; budget > 0; budget--) {
            if (cpu.getState().pc === address) return;
            step();
        }
        throw new Error(`Instruction budget exhausted at ${cpu.getState().pc.toString(16)}`);
    }
    cpu.setState({ ...cpu.getState(), pc: 0x0100 });
    until(0x0159);
    // Choose the existing start-game entry after original machine initialization.
    cpu.setState({ ...cpu.getState(), pc: 0x068f });
    until(0x06c3);
    const origin = cycles;
    opcodes.clear();
    inputPorts.clear();
    instructions = 0;
    const frames = [];
    let previousUpdate = null;
    for (let frame = 0; frame < 24; frame++) {
        if (frame) until(0x06c3);
        const start = cycles;
        until(0x06d0);
        // The complete original keyboard scan executes before these input flags.
        memory[0x0d6c] = 0;
        memory[0x0d6d] = mode === 'idle' ? 0 : 1;
        memory[0x0d6e] = mode === 'jump' && frame === 0 ? 1 : 0;
        memory[0x0d6f] = 0;
        memory[0x0d70] = 0;
        until(0x06d3);
        const update = cycles;
        until(0x0788);
        step();
        const state = cpu.getState();
        if (state.iff1) throw new Error('Unexpected enabled interrupts');
        frames.push({
            frame,
            loopCycles: cycles - start,
            loopMicros: (cycles - start) / 4,
            playerUpdateMicros: (update - origin) / 4,
            playerIntervalMicros: previousUpdate === null ? null : (update - previousUpdate) / 4,
            x: memory[0x10ee],
            y: memory[0x10ef],
            walkPhase: memory[0x10f2],
            jumpCountdown: memory[0x10f0],
            sprite: memory[0x1062],
        });
        previousUpdate = update;
    }
    return {
        summary: {
            loops: frames.length,
            loopMicros: range(frames.map((frame) => frame.loopMicros)),
            playerIntervalMicros: range(frames.slice(1).map((frame) => frame.playerIntervalMicros)),
            ...(mode === 'jump'
                ? {
                      firstDisplacementToLandingMicros:
                          frames[21].playerUpdateMicros - frames[0].playerUpdateMicros,
                  }
                : {}),
            inputPortHighBytes: [...inputPorts]
                .sort((a, b) => a - b)
                .map((port) => `0x${port.toString(16)}`),
            interruptEnabled: false,
            instructions,
        },
        frames,
        opcodeHistogram: Object.fromEntries([...opcodes].sort(([a], [b]) => a.localeCompare(b))),
    };
}

export function measureCpcTiming(memory, cpuSource) {
    if (memory.length !== 65536 || sha256(memory) !== MEMORY_SHA256)
        throw new Error('Expected the verified original CPC Exolon memory image.');
    if (sha256(cpuSource) !== CPU_SHA256)
        throw new Error('Expected the external MIT Molly Howell Z80.js interpreter.');
    const context = createContext({ window: {} });
    runInContext(cpuSource.toString(), context, { filename: 'external-Z80.js' });
    const captures = Object.fromEntries(
        ['walk', 'idle', 'jump'].map((mode) => [mode, capture(context.Z80, memory, mode)]),
    );
    return {
        version: 1,
        platform: 'amstrad-cpc',
        source: {
            memorySha256: MEMORY_SHA256,
            cpuSha256: CPU_SHA256,
            originalDiskUrl: 'https://acpc.me/emul/dsk/exolon,exolon.dsk',
            originalDiskSha256: 'f8cb122713118feb48fcd7193f77ca66ad86e4fb739c37088ec8f71d34e54fd9',
            commercialTapeSha256:
                '32f84af268431975f72847f1cd2d53bcfd1d4db1de0c04eed3f62532b8e2cf30',
            originalByteVerification: 'originals/graphics/amstrad-cpc/cpc-graphics-provenance.json',
            hardwareTiming:
                'https://64nops.wordpress.com/2021/01/13/perfectly-accurate-z80-flags-and-cpc-timing/',
        },
        reproduction:
            'node tools/recovery/timing/cpc.mjs --memory /path/to/cpc-ram.bin --z80 /path/to/Z80.js --output /path/to/motion-cpc.json',
        method: {
            clockHz: 4000000,
            cycleModel:
                'CPC opcode NOP timings include memory and I/O stretching; not ceil(total generic Z80 T-states / 4).',
            start: '0100 -> 0159; select original game entry 068f; sample 24 complete loops 06c3 -> 0788 -> 06c3.',
            input: 'Original keyboard scan runs in full; replace only flags 0d6c..0d70 after scan at 06d0. PPI F6 reads30, other inputsFF.',
            heroUpdate:
                'CALL 0fa2 at 06d0, once per loop; X/Y at10ee/10ef, walk phase10f2, jump count10f0.',
            synchronization:
                'DI at0100 and068f. No HALT, enabled interrupts or F5 VSYNC reads in measured gameplay.',
            workloadPadding:
                '2b88 fills16 small sprite operations via2020;2b9c fills6 large sprite operations via0b5f.',
        },
        interpretation: {
            recommendedFixedIntervalMs: 52,
            accuracy:
                'A fixed approximation of original variable rendering-bound cadence; first screen only, not a physical-machine recording or all-scene guarantee.',
            logicalPixelsPerHorizontalStep: 2,
            walkAnimationFrames: 10,
            jumpDeltas: Array.from(memory.slice(0x1063, 0x1079))
                .reverse()
                .map((byte) => (byte > 127 ? byte - 256 : byte)),
            sharedModelGeometry:
                'Shared X increments and22-step jump table already match original CPC; adjust time, not distance.',
            limitations:
                'Offline functional CPU with hardware opcode timing table; nominal stock CPC4MHz; original first-screen enemies, collisions and sound driver execute. No CRTC pixels, analog output or hardware-revision differences are emulated.',
        },
        captures,
    };
}

async function main(args) {
    const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const memoryPath = value('--memory');
    const cpuPath = value('--z80');
    if (!memoryPath || !cpuPath)
        throw new Error(
            'Usage: node tools/recovery/timing/cpc.mjs --memory /path/to/cpc-ram.bin --z80 /path/to/Z80.js [--output /path/to/motion-cpc.json]',
        );
    const result = measureCpcTiming(
        await readFile(resolve(memoryPath)),
        await readFile(resolve(cpuPath)),
    );
    const json = JSON.stringify(result, null, 2) + '\n';
    if (value('--output')) await writeFile(resolve(value('--output')), json);
    else process.stdout.write(json);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
