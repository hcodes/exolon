// Offline ZX Spectrum beeper capture. No CPU interpreter is shipped to browsers.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodeWave } from './c64.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MEMORY_SHA256 = '2ee3509dc114d70a2bd2d7e22ada889d93088091964380e4b2583341e41617b5';
const CORE_SHA256 = '78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b';
const CPU_HZ = 3500000;

export function captureCheatBeeper(source, core) {
    if (source.length !== 65536 || hash(source) !== MEMORY_SHA256)
        throw new Error('Expected the verified ZX TAP memory image.');
    if (hash(core) !== CORE_SHA256) throw new Error('Expected the pinned offline MIT Z80.js core.');
    const scope = createContext({ window: {} });
    runInContext(core.toString(), scope, { timeout: 1000 });
    const memory = Uint8Array.from(source),
        events = [];
    let cycles = 0,
        previous = 0;
    const cpu = new scope.Z80({
        mem_read: (address) => memory[address],
        mem_write: (address, value) => (memory[address] = value),
        io_read: () => 255,
        io_write: (port, value) => {
            if ((port & 255) !== 254) throw new Error('Unexpected beeper output port.');
            const level = (value >> 4) & 1;
            if (level !== previous) events.push([cycles, level]);
            previous = level;
        },
    });
    memory[0x2f00] = 0;
    memory[0x2f01] = 0x2e;
    cpu.setState({ ...cpu.getState(), pc: 0x7d17, sp: 0x2f00, h: 0x7d, l: 0x68 });
    for (let instruction = 0; instruction < 2000000; instruction++) {
        cycles += cpu.run_instruction();
        if (cpu.getState().pc === 0x2e00) {
            events.push([cycles, 0]);
            return { cpuHz: CPU_HZ, cycles, events };
        }
    }
    throw new Error('Original beeper program exceeded its instruction budget.');
}

export function renderCheatBeeper({ cpuHz, cycles, events }, sampleRate = 44100) {
    const samples = new Float32Array(Math.ceil((cycles / cpuHz + 0.12) * sampleRate));
    let cursor = 0,
        event = 0,
        level = 0,
        previous = 0,
        filtered = 0;
    const ac = Math.exp((-2 * Math.PI * 20) / sampleRate);
    for (let sample = 0; sample < samples.length; sample++) {
        const end = ((sample + 1) * cpuHz) / sampleRate;
        let integral = 0;
        while (event < events.length && events[event][0] < end) {
            const [at, next] = events[event++];
            integral += (at - cursor) * level;
            cursor = at;
            level = next;
        }
        integral += (end - cursor) * level;
        cursor = end;
        const input = (integral * sampleRate * 0.5) / cpuHz;
        filtered = input - previous + ac * filtered;
        previous = input;
        samples[sample] = filtered;
    }
    return encodeWave(samples, sampleRate);
}

async function main() {
    const args = process.argv.slice(2);
    const option = (key) => args[args.indexOf(key) + 1];
    if (
        !args.includes('--output') ||
        (!args.includes('--trace') && (!args.includes('--memory') || !args.includes('--z80')))
    )
        throw new Error('Use --output DIR with --trace FILE, or --memory RAM --z80 Z80.js.');
    const output = resolve(option('--output'));
    const trace = args.includes('--trace')
        ? JSON.parse(await readFile(option('--trace'), 'utf8'))
        : captureCheatBeeper(await readFile(option('--memory')), await readFile(option('--z80')));
    const wave = renderCheatBeeper(trace);
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'cheat-enabled.wav'), wave);
    await writeFile(join(output, 'cheat-enabled.trace.json'), JSON.stringify(trace) + '\n');
    console.log(
        JSON.stringify({ output, sha256: hash(wave), bytes: wave.length, cycles: trace.cycles }),
    );
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
