// Offline native Datelsoft timing probe. No CPU/game code enters browser bundles.
// GDG banking is modeled; pixel-plane operations and hardware WAIT are not.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

const RAM_SHA256 = '108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f';
const CPU_SHA256 = '78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b';
const CLOCK_HZ = 3546880;
const MODES = new Set(['stand', 'walk', 'crouch', 'shot', 'jump', 'walkjump']);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function options(args) {
    const values = {};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        if (!['--memory', '--z80', '--mode', '--frames'].includes(key) || !args[index + 1])
            throw new Error('Expected --memory RAM --z80 Z80.js [--mode walk] [--frames 50].');
        if (Object.hasOwn(values, key)) throw new Error(`Duplicate option ${key}.`);
        values[key] = args[index + 1];
    }
    const mode = values['--mode'] || 'walk';
    const frames = Number(values['--frames'] || 50);
    if (!values['--memory'] || !values['--z80'] || !MODES.has(mode))
        throw new Error('Required verified RAM/core paths and a supported mode.');
    if (!Number.isInteger(frames) || frames < 1 || frames > 100)
        throw new Error('--frames must be an integer from 1 to 100.');
    return { memoryPath: values['--memory'], cpuPath: values['--z80'], mode, frames };
}

function measure({ memoryPath, cpuPath, mode, frames }) {
    const source = readFileSync(memoryPath);
    const core = readFileSync(cpuPath);
    if (source.length !== 65536 || sha256(source) !== RAM_SHA256)
        throw new Error('Unsupported Sharp RAM SHA-256. Recover the archived exolnew.mzf first.');
    if (sha256(core) !== CPU_SHA256) throw new Error('Unsupported offline Z80.js SHA-256.');
    const context = createContext({ window: {} });
    runInContext(String(core), context, { timeout: 1000 });
    const memory = Uint8Array.from(source);
    const vram = new Uint8Array(8192);
    const io = {};
    const records = [];
    let bank = false;
    let keyRow = 255;
    let cycles = 0;
    let frame = 0;
    let previousCycles = 0;
    let vramReads = 0;
    let vramWrites = 0;
    let started = false;
    let haltCount = 0;
    let instructions = 0;
    const countIo = (direction, port) => {
        const key = `${direction}-${port.toString(16)}`;
        io[key] = (io[key] || 0) + 1;
    };
    const cpu = new context.Z80({
        mem_read: (address) => {
            if (bank && address >= 0x8000 && address < 0xa000) {
                vramReads++;
                return vram[address - 0x8000];
            }
            return memory[address];
        },
        mem_write: (address, value) => {
            if (bank && address >= 0x8000 && address < 0xa000) {
                vramWrites++;
                vram[address - 0x8000] = value;
            } else memory[address] = value;
        },
        io_read: (port) => {
            port &= 255;
            countIo('in', port);
            // IN E0 maps VRAM over 8000..9FFF; IN E1 restores game RAM.
            if (port === 0xe0) bank = true;
            if (port === 0xe1) bank = false;
            if (port !== 0xd1 || keyRow !== 0xf7 || !frame) return 255;
            let value = 255;
            if (mode === 'walk' || mode === 'walkjump') value &= ~8;
            if (mode === 'crouch') value &= ~16;
            if ((mode === 'jump' || mode === 'walkjump') && frame === 3) value &= ~32;
            if (mode === 'shot') value &= ~64;
            return value;
        },
        io_write: (port, value) => {
            port &= 255;
            if (port === 0xd0) keyRow = value;
            countIo('out', port);
        },
    });
    cpu.setState({ ...cpu.getState(), pc: 0x6d60 });
    for (; instructions < 20000000; instructions++) {
        const pc = cpu.getState().pc;
        // Preserve initialization, then bypass the menu; game RAM is not patched.
        if (pc === 0x6da1 && !started) {
            cpu.setState({ ...cpu.getState(), pc: 0x758a });
            started = true;
            continue;
        }
        if (pc === 0x75be) {
            if (frame)
                records.push({
                    frame: frame - 1,
                    cycles: cycles - previousCycles,
                    x: memory[0x82f5],
                    y: memory[0x82f6],
                    jump: memory[0x82f7],
                    sprite: memory[0x8269],
                    vramReads,
                    vramWrites,
                });
            previousCycles = cycles;
            vramReads = vramWrites = 0;
            if (++frame > frames) break;
        }
        if (memory[pc] === 0x76) haltCount++;
        cycles += cpu.run_instruction();
    }
    if (records.length !== frames)
        throw new Error('Native program exceeded its instruction budget.');
    return {
        platform: 'sharp-mz800',
        mode,
        memorySha256: RAM_SHA256,
        cpuSha256: CPU_SHA256,
        clockHz: CLOCK_HZ,
        timingModel: 'Bare Z80 T-states; GDG WAIT and exact pixel planes are not emulated.',
        instructions,
        haltCount,
        io,
        records,
    };
}

try {
    console.log(JSON.stringify(measure(options(process.argv.slice(2))), null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
