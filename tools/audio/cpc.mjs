import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { renderAy } from '../../src/audio/synthesize.ts';
import { encodeWave } from './c64.mjs';

export const CPC_CLOCK = 1000000;
export const SOURCE_MEMORY_SHA256 =
    '496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assetDirectory = fileURLToPath(new URL('../../originals/audio/cpc/', import.meta.url));
const runtimeDirectory = fileURLToPath(new URL('../../src/audio/cpc/', import.meta.url));
const TRACE_RATE = 1000;
const Z80_SOURCE_SHA256 = '78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b';
const effects = [
    ['shot', 0x65a8],
    ['grenade', 0x65ef],
    ['rocket', 0x656c],
    ['explosion', 0x6579],
    ['enemy-destroyed', 0x6586],
    ['teleport', 0x6593],
    ['refill-ammo', 0x6525],
    ['refill-grenades', 0x6532],
    ['crusher', 0x65da],
    ['bonus', 0x655f],
];

/** A trace stores original AY writes, with integer microsecond timestamps. */
export function encodeTrace(events, durationMicros) {
    if (!Number.isInteger(durationMicros) || durationMicros < 1 || durationMicros > 0xffffffff)
        throw new RangeError('Invalid trace duration');
    const bytes = Buffer.alloc(16 + events.length * 8);
    bytes.write('CPCAY001');
    bytes.writeUInt32LE(durationMicros, 8);
    bytes.writeUInt32LE(events.length, 12);
    let previous = 0;
    events.forEach(([time, register, value], index) => {
        if (
            !Number.isInteger(time) ||
            time < previous ||
            time >= durationMicros ||
            !Number.isInteger(register) ||
            register < 0 ||
            register > 13 ||
            !Number.isInteger(value) ||
            value < 0 ||
            value > 255
        )
            throw new RangeError('Invalid AY event');
        const offset = 16 + index * 8;
        bytes.writeUInt32LE(time, offset);
        bytes[offset + 4] = register;
        bytes[offset + 5] = value;
        previous = time;
    });
    return bytes;
}

export function decodeTrace(bytes) {
    if (bytes.length < 16 || bytes.toString('ascii', 0, 8) !== 'CPCAY001')
        throw new Error('Invalid CPC AY trace header');
    const durationMicros = bytes.readUInt32LE(8),
        count = bytes.readUInt32LE(12);
    if (bytes.length !== 16 + count * 8 || !durationMicros)
        throw new Error('Invalid CPC AY trace length');
    const events = [];
    let previous = 0;
    for (let offset = 16; offset < bytes.length; offset += 8) {
        const time = bytes.readUInt32LE(offset),
            register = bytes[offset + 4],
            value = bytes[offset + 5];
        if (
            time < previous ||
            time >= durationMicros ||
            register > 13 ||
            bytes.readUInt16LE(offset + 6)
        )
            throw new Error('Invalid CPC AY trace event');
        events.push([time, register, value]);
        previous = time;
    }
    return { events, durationMicros };
}

export function traceFrames({ events, durationMicros }) {
    const frames = [],
        registers = new Uint8Array(14);
    let event = 0;
    for (let frame = 0; frame < Math.ceil((durationMicros * TRACE_RATE) / 1000000); frame++) {
        while (event < events.length && events[event][0] <= (frame * 1000000) / TRACE_RATE) {
            const [, register, value] = events[event++];
            // Exolon's CPC driver uses software envelopes; reject unsupported captures.
            if (register >= 8 && register <= 10 && value & 16)
                throw new Error('Hardware envelope is unsupported by this renderer');
            registers[register] = value;
        }
        frames.push(registers.slice());
    }
    return frames;
}

export const renderTrace = (trace, sampleRate = 44100) =>
    encodeWave(renderAy(traceFrames(trace), sampleRate, TRACE_RATE, CPC_CLOCK), sampleRate);

// External MIT Z80.js is used only by this offline extraction tool. Nothing is
// installed, fetched or interpreted by the game. See originals/audio/cpc/provenance.json.
function createCapture(Z80, source) {
    const memory = Uint8Array.from(source),
        events = [];
    let portA = 0,
        selected = 0,
        cycles = 0;
    const cpu = new Z80({
        mem_read: (address) => memory[address],
        mem_write: (address, value) => {
            memory[address] = value;
        },
        io_read: (port) => (port >> 8 === 0xf4 ? 255 : port >> 8 === 0xf6 ? 0x30 : 255),
        io_write: (port, value) => {
            if (port >> 8 === 0xf4) portA = value;
            if (port >> 8 !== 0xf6) return;
            if ((value & 0xc0) === 0xc0) selected = portA;
            if ((value & 0xc0) === 0x80 && selected < 14)
                events.push([Math.floor(cycles / 4), selected, portA]);
        },
    });
    function step() {
        cycles += Math.ceil(cpu.run_instruction() / 4) * 4;
    }
    function call(address) {
        memory[0xfe00] = 0;
        memory[0xfe01] = 0xff;
        cpu.setState({ ...cpu.getState(), pc: address, sp: 0xfe00 });
        for (let instructions = 0; instructions < 100000; instructions++) {
            step();
            if (cpu.getState().pc === 0xff00) return;
        }
        throw new Error(`CPC subroutine $${address.toString(16)} exceeded instruction budget`);
    }
    function program(start, stop) {
        cpu.setState({ ...cpu.getState(), pc: start, sp: 0x100 });
        for (let instructions = 0; instructions < 100000000; instructions++) {
            if (cpu.getState().pc === stop) return;
            step();
        }
        throw new Error('CPC audio program exceeded instruction budget');
    }
    return {
        memory,
        events,
        call,
        program,
        get cycles() {
            return cycles;
        },
        set cycles(value) {
            cycles = value;
        },
    };
}

async function main() {
    const args = process.argv.slice(2);
    const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const output = resolve(option('--output') || assetDirectory);
    const runtimeOutput = resolve(
        option('--runtime-output') || (option('--output') ? output : runtimeDirectory),
    );
    await mkdir(output, { recursive: true });
    await mkdir(runtimeOutput, { recursive: true });
    let cpuSourceSha256 = Z80_SOURCE_SHA256;
    if (!args.includes('--traces-only')) {
        if (!option('--memory') || !option('--z80'))
            throw new Error(
                'Usage: node tools/audio/cpc.mjs --memory /path/to/original-memory.bin --z80 /path/to/Z80.js [--output /tmp/originals] [--runtime-output /tmp/runtime-effects] (or --traces-only)',
            );
        const source = await readFile(option('--memory'));
        if (source.length !== 65536 || sha256(source) !== SOURCE_MEMORY_SHA256)
            throw new Error('Original CPC memory SHA-256 mismatch');
        const cpuSource = await readFile(option('--z80'));
        cpuSourceSha256 = sha256(cpuSource);
        const context = createContext({ window: {} });
        runInContext(cpuSource.toString(), context, {
            filename: 'external-offline-Z80.js',
            timeout: 1000,
        });
        const Z80 = context.Z80;
        if (typeof Z80 !== 'function')
            throw new Error('External Z80.js does not expose Z80 constructor');
        await writeFile(join(output, 'audio-engine.bin'), source.subarray(0x59fa, 0x6bdd));
        for (const [name, entry] of effects) {
            const capture = createCapture(Z80, source);
            capture.call(0x5a7c);
            capture.call(entry);
            let frame = 0;
            for (; frame < 2000; frame++) {
                capture.cycles = (frame + 1) * 80000;
                capture.call(0x63af);
                if (
                    Array.from(
                        { length: 16 },
                        (_, index) => capture.memory[0x6a1c + index * 16],
                    ).every((value) => value === 255)
                )
                    break;
            }
            if (frame === 2000) throw new Error(`CPC effect ${name} did not terminate`);
            await writeFile(
                join(output, `${name}.ayr`),
                encodeTrace(capture.events, (frame + 2) * 20000 + 120000),
            );
        }
        const title = createCapture(Z80, source);
        title.program(0x100, 0x5d20);
        title.call(0x5a7c);
        await writeFile(
            join(output, 'title.ayr'),
            encodeTrace(title.events, Math.ceil(title.cycles / 4) + 120000),
        );
        const gameOver = createCapture(Z80, source);
        gameOver.program(0x2d21, 0x2d39);
        await writeFile(
            join(output, 'game-over.ayr'),
            encodeTrace(gameOver.events, Math.ceil(gameOver.cycles / 4) + 120000),
        );
    }
    const recordings = [];
    for (const name of ['title', 'game-over', ...effects.map(([name]) => name)]) {
        const bytes = await readFile(join(output, `${name}.ayr`)),
            trace = decodeTrace(bytes),
            wave = renderTrace(trace);
        await writeFile(
            join(name === 'title' || name === 'game-over' ? output : runtimeOutput, `${name}.wav`),
            wave,
        );
        recordings.push({
            name,
            file: `${name}.wav`,
            trace: `${name}.ayr`,
            seconds: (wave.length - 44) / 88200,
            writes: trace.events.length,
            traceSha256: sha256(bytes),
            sha256: sha256(wave),
        });
    }
    await writeFile(
        join(output, 'render.json'),
        `${JSON.stringify(
            {
                sourceMemorySha256: SOURCE_MEMORY_SHA256,
                engineSha256: sha256(await readFile(join(output, 'audio-engine.bin'))),
                cpuSourceSha256,
                sampleRate: 44100,
                ayClock: CPC_CLOCK,
                traceRate: TRACE_RATE,
                effectsRate: 50,
                recordings,
            },
            null,
            2,
        )}\n`,
    );
    console.log(JSON.stringify(recordings));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    await main();
