// Offline extraction of the Datelsoft Sharp MZ-800 SN76489 conversion.
// The external Z80 interpreter is never shipped with or loaded by the game.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { encodeWave } from './c64.mjs';

export const SHARP_CLOCK = 3546880;
export const SOURCE_MEMORY_SHA256 =
    '108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f';
const Z80_SOURCE_SHA256 = '78609811c202d717c94d2f2aaf6f540d2d5c4d0485f723dedc42bf384625637b';
const directory = fileURLToPath(new URL('../../originals/audio/sharp-mz800/', import.meta.url));
const runtimeDirectory = fileURLToPath(new URL('../../src/audio/sharp-mz800/', import.meta.url));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const effectEntries = [
    ['shot', 0xc177],
    ['grenade', 0xc1be],
    ['rocket', 0xc13b],
    ['explosion', 0xc148],
    ['enemy-destroyed', 0xc155],
    ['teleport', 0xc162],
    ['refill-ammo', 0xc0f4],
    ['refill-grenades', 0xc101],
];

/** Original F2 output bytes, not reconstructed AY register snapshots. */
export function encodeTrace(events, durationMicros) {
    if (!Number.isInteger(durationMicros) || durationMicros < 1 || durationMicros > 0xffffffff)
        throw new RangeError('Invalid trace duration');
    const bytes = Buffer.alloc(16 + events.length * 8);
    bytes.write('MZ8SN001');
    bytes.writeUInt32LE(durationMicros, 8);
    bytes.writeUInt32LE(events.length, 12);
    let previous = 0;
    events.forEach(([time, value], index) => {
        if (
            !Number.isInteger(time) ||
            time < previous ||
            time >= durationMicros ||
            !Number.isInteger(value) ||
            value < 0 ||
            value > 255
        )
            throw new RangeError('Invalid PSG event');
        const offset = 16 + index * 8;
        bytes.writeUInt32LE(time, offset);
        bytes[offset + 4] = value;
        previous = time;
    });
    return bytes;
}

export function decodeTrace(bytes) {
    if (bytes.length < 16 || bytes.toString('ascii', 0, 8) !== 'MZ8SN001')
        throw new Error('Invalid Sharp PSG trace header');
    const durationMicros = bytes.readUInt32LE(8),
        count = bytes.readUInt32LE(12);
    if (!durationMicros || bytes.length !== 16 + count * 8)
        throw new Error('Invalid Sharp PSG trace length');
    const events = [];
    let previous = 0;
    for (let offset = 16; offset < bytes.length; offset += 8) {
        const time = bytes.readUInt32LE(offset);
        if (
            time < previous ||
            time >= durationMicros ||
            bytes[offset + 5] ||
            bytes.readUInt16LE(offset + 6)
        )
            throw new Error('Invalid Sharp PSG trace event');
        events.push([time, bytes[offset + 4]]);
        previous = time;
    }
    return { events, durationMicros };
}

/** SN76489A: three 10-bit tones, 2 dB attenuation, periodic/white noise.
 * Integrate chip-clock transitions over each PCM sample to avoid aliasing the
 * original short silence/write sequences. No CPU instructions are interpreted.
 */
export function renderPcm(trace, sampleRate = 44100, clock = SHARP_CLOCK) {
    if (!Number.isFinite(sampleRate) || sampleRate < 1 || !Number.isFinite(clock) || clock < 1)
        throw new RangeError('Invalid Sharp audio clock or sample rate');
    const { events, durationMicros } = decodeTrace(encodeTrace(trace.events, trace.durationMicros));
    const pcm = new Float32Array(Math.ceil((durationMicros * sampleRate) / 1000000));
    const periods = [1024, 1024, 1024],
        tones = [0, 0, 0],
        counters = [0, 0, 0, 0],
        output = [0, 0, 0, 0];
    const attenuation = [15, 15, 15, 15],
        levels = Array.from({ length: 16 }, (_, index) =>
            index === 15 ? 0 : Math.pow(10, -index / 10),
        );
    let selected = 0,
        noise = 0,
        shift = 0x10000,
        event = 0,
        nextTick = 0,
        now = 0;
    let lastInput = 0,
        filtered = 0;
    const tickSeconds = 16 / clock,
        ac = Math.exp((-2 * Math.PI * 20) / sampleRate);
    function write(value) {
        if (value & 128) selected = (value >> 4) & 7;
        const channel = selected >> 1;
        if (selected & 1) attenuation[channel] = value & 15;
        else if (selected === 6) {
            noise = value & 7;
            shift = 0x10000;
        } else {
            tones[channel] =
                value & 128
                    ? (tones[channel] & 0x3f0) | (value & 15)
                    : (tones[channel] & 15) | ((value & 63) << 4);
            periods[channel] = tones[channel] || 1024;
        }
    }
    function tick() {
        for (let channel = 0; channel < 3; channel++) {
            if (--counters[channel] <= 0) {
                output[channel] ^= 1;
                counters[channel] = periods[channel];
            }
        }
        if (--counters[3] <= 0) {
            const feedback = ((shift >> 2) & 1) ^ (noise & 4 ? (shift >> 3) & 1 : 0);
            shift = (shift >> 1) | (feedback << 16);
            output[3] = shift & 1;
            counters[3] = (noise & 3) === 3 ? periods[2] * 2 : 1 << (5 + (noise & 3));
        }
    }
    for (let sample = 0; sample < pcm.length; sample++) {
        const end = (sample + 1) / sampleRate;
        let integral = 0;
        while (now < end) {
            while (event < events.length && events[event][0] / 1000000 <= now + 1e-12)
                write(events[event++][1]);
            if (nextTick <= now + 1e-12) {
                tick();
                nextTick += tickSeconds;
            }
            const nextEvent = event < events.length ? events[event][0] / 1000000 : Infinity;
            const until = Math.min(end, nextTick, nextEvent);
            let amplitude = 0;
            for (let channel = 0; channel < 4; channel++)
                amplitude += (output[channel] ? 1 : -1) * levels[attenuation[channel]] * 0.2;
            integral += amplitude * (until - now);
            now = until;
        }
        const input = integral * sampleRate;
        filtered = input - lastInput + ac * filtered;
        lastInput = input;
        pcm[sample] = filtered;
    }
    return pcm;
}

export const renderTrace = (trace, sampleRate = 44100) =>
    encodeWave(renderPcm(trace, sampleRate), sampleRate);

function createCapture(Z80, source) {
    const memory = Uint8Array.from(source),
        events = [];
    let cycles = 0;
    const cpu = new Z80({
        mem_read: (address) => memory[address],
        mem_write: (address, value) => {
            memory[address] = value;
        },
        io_read: () => 255,
        io_write: (port, value) => {
            if ((port & 255) !== 0xf2)
                throw new Error(`Unexpected sound port $${port.toString(16)}`);
            events.push([Math.floor((cycles * 1000000) / SHARP_CLOCK), value]);
        },
    });
    function call(address) {
        memory[0x2f00] = 0;
        memory[0x2f01] = 0x2e;
        cpu.setState({ ...cpu.getState(), pc: address, sp: 0x2f00 });
        for (let instructions = 0; instructions < 100000; instructions++) {
            cycles += cpu.run_instruction();
            if (cpu.getState().pc === 0x2e00) {
                if (cpu.getState().sp !== 0x2f02)
                    throw new Error('Original sound call corrupted the capture stack');
                return;
            }
        }
        throw new Error(
            `Sharp sound subroutine $${address.toString(16)} exceeded instruction budget`,
        );
    }
    return {
        memory,
        events,
        call,
        set cycles(value) {
            cycles = value;
        },
    };
}

async function main() {
    const args = process.argv.slice(2);
    const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    const output = resolve(option('--output') || directory);
    const runtimeOutput = resolve(
        option('--runtime-output') || (option('--output') ? output : runtimeDirectory),
    );
    await mkdir(output, { recursive: true });
    await mkdir(runtimeOutput, { recursive: true });
    if (!args.includes('--traces-only')) {
        if (!option('--memory') || !option('--z80'))
            throw new Error(
                'Usage: node tools/audio/sharp.mjs --memory /path/to/exolnew-unpacked.bin --z80 /path/to/Z80.js [--output /tmp/originals] [--runtime-output /tmp/runtime-effects] (or --traces-only)',
            );
        const source = await readFile(option('--memory')),
            cpuSource = await readFile(option('--z80'));
        if (source.length !== 65536 || sha256(source) !== SOURCE_MEMORY_SHA256)
            throw new Error('Original Sharp memory SHA-256 mismatch');
        if (sha256(cpuSource) !== Z80_SOURCE_SHA256)
            throw new Error('External offline Z80.js SHA-256 mismatch');
        const context = createContext({ window: {} });
        runInContext(cpuSource.toString(), context, {
            filename: 'external-offline-Z80.js',
            timeout: 1000,
        });
        if (typeof context.Z80 !== 'function')
            throw new Error('External Z80.js has no constructor');
        await writeFile(join(output, 'audio-engine.bin'), source.subarray(0xb6d0, 0xc7ab));
        await writeFile(join(output, 'sn-tone-converter.bin'), source.subarray(0x332f, 0x334b));
        for (const [name, entry] of effectEntries) {
            const capture = createCapture(context.Z80, source);
            capture.call(0xb753);
            capture.call(entry);
            let frame = 0;
            for (; frame < 2000; frame++) {
                capture.cycles = ((frame + 1) * SHARP_CLOCK) / 50;
                capture.call(0xbf7e);
                if (
                    Array.from(
                        { length: 16 },
                        (_, index) => capture.memory[0xc5eb + index * 16],
                    ).every((value) => value === 255)
                )
                    break;
            }
            if (frame === 2000) throw new Error(`Sharp effect ${name} did not terminate`);
            await writeFile(
                join(output, `${name}.snr`),
                encodeTrace(capture.events, (frame + 2) * 20000 + 120000),
            );
        }
        const title = createCapture(context.Z80, source);
        title.call(0xb6ec);
        let frame = 0;
        for (; frame < 10000; frame++) {
            title.cycles = ((frame + 1) * SHARP_CLOCK) / 90;
            title.call(0xb767);
            if (title.memory[0xb6e4]) break;
        }
        if (frame === 10000) throw new Error('Sharp title did not terminate');
        title.call(0xb753);
        await writeFile(
            join(output, 'title.snr'),
            encodeTrace(title.events, Math.ceil(((frame + 2) * 1000000) / 90) + 120000),
        );
    }
    const recordings = [];
    for (const name of ['title', ...effectEntries.map(([name]) => name)]) {
        const bytes = await readFile(join(output, `${name}.snr`)),
            trace = decodeTrace(bytes),
            wave = renderTrace(trace);
        await writeFile(
            join(name === 'title' || name === 'game-over' ? output : runtimeOutput, `${name}.wav`),
            wave,
        );
        recordings.push({
            name,
            file: `${name}.wav`,
            trace: `${name}.snr`,
            seconds: (wave.length - 44) / 88200,
            writes: trace.events.length,
            traceSha256: sha256(bytes),
            sha256: sha256(wave),
        });
    }
    await writeFile(
        join(output, 'render.json'),
        `${JSON.stringify({ sourceMemorySha256: SOURCE_MEMORY_SHA256, engineSha256: sha256(await readFile(join(output, 'audio-engine.bin'))), converterSha256: sha256(await readFile(join(output, 'sn-tone-converter.bin'))), cpuSourceSha256: Z80_SOURCE_SHA256, sampleRate: 44100, psgClock: SHARP_CLOCK, effectsRate: 50, titleRate: 90, recordings }, null, 2)}\n`,
    );
    console.log(JSON.stringify(recordings));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
    await main();
