import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const assetDirectory = fileURLToPath(new URL('../../originals/audio/c64/', import.meta.url));
const runtimeDirectory = fileURLToPath(new URL('../../src/audio/c64/', import.meta.url));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseSid(bytes) {
    if (bytes.length < 124 || bytes.toString('ascii', 0, 4) !== 'PSID')
        throw new Error('Invalid PSID header');
    const dataOffset = bytes.readUInt16BE(6);
    let loadAddress = bytes.readUInt16BE(8),
        payloadOffset = dataOffset;
    if (dataOffset < 118 || dataOffset + 2 >= bytes.length)
        throw new Error('Invalid PSID data offset');
    if (!loadAddress) {
        loadAddress = bytes.readUInt16LE(dataOffset);
        payloadOffset += 2;
    }
    if (loadAddress + bytes.length - payloadOffset > 65536)
        throw new Error('PSID data exceeds memory');
    const memory = Buffer.alloc(65536);
    bytes.copy(memory, loadAddress, payloadOffset);
    const text = (offset) =>
        bytes
            .toString('latin1', offset, offset + 32)
            .replace(/\0.*$/, '')
            .trim();
    return {
        memory,
        loadAddress,
        initAddress: bytes.readUInt16BE(10),
        playAddress: bytes.readUInt16BE(12),
        songs: bytes.readUInt16BE(14),
        name: text(22),
        author: text(54),
        published: text(86),
    };
}

export function encodeWave(samples, sampleRate) {
    const wave = Buffer.alloc(44 + samples.length * 2);
    wave.write('RIFF', 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(sampleRate, 24);
    wave.writeUInt32LE(sampleRate * 2, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write('data', 36);
    wave.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((sample, index) =>
        wave.writeInt16LE(
            Math.min(32767, Math.max(-32768, Math.round(sample * 32768))),
            44 + index * 2,
        ),
    );
    return wave;
}

// jsSID is an offline research input, never a dependency of the game or this repo.
// Obtain mos6510.js and tinysid.js from https://github.com/jhohertz/jsSID/tree/develop/js.
async function loadOfflineRenderer(directory) {
    const context = createContext({ jsSID: { synth: {} }, console });
    const sources = {};
    for (const filename of ['mos6510.js', 'tinysid.js']) {
        const bytes = await readFile(join(directory, filename));
        sources[filename] = sha256(bytes);
        runInContext(bytes.toString(), context, { filename, timeout: 1000 });
    }
    return { jsSID: context.jsSID, sources };
}

function renderSid(jsSID, sid, { song = 0, frames = 5200, sampleRate = 44100 } = {}) {
    const samplesPerFrame = sampleRate / 50;
    if (!Number.isInteger(samplesPerFrame))
        throw new Error('Sample rate must divide into PAL 50 Hz frames');
    const synth = new jsSID.TinySID({ sampleRate });
    const memory = Array.from(sid.memory),
        cpu = new jsSID.MOS6510(memory, synth);
    const samples = new Float32Array(frames * samplesPerFrame);
    let instructions = 0;
    const parse = cpu.cpuParse;
    cpu.cpuParse = function () {
        if (++instructions > 1000000) throw new Error('SID routine exceeded instruction budget');
        return parse.call(this);
    };
    cpu.cpuJSR(sid.initAddress, song);
    for (let frame = 0; frame < frames; frame++) {
        instructions = 0;
        cpu.cpuJSR(sid.playAddress, 0);
        synth.generateIntoBuffer(samplesPerFrame, samples, frame * samplesPerFrame);
    }
    return samples;
}

const C64_EFFECTS = [
    { name: 'shot', entry: 0x7c77 },
    { name: 'grenade', entry: 0x7cc8 },
    { name: 'enemy-destroyed', entry: 0x7c28 },
    { name: 'explosion', entry: 0x7c3a },
    { name: 'death', entry: 0x7c65 },
    { name: 'teleport', entry: 0x7c1f },
    { name: 'refill-ammo', entry: 0x7cbf },
    { name: 'refill-grenades', entry: 0x7cb6 },
    { name: 'turret', entry: 0x7c92 },
    { name: 'crusher', entry: 0x7c9b },
    { name: 'bonus', entry: 0x7cad },
    { name: 'impact', entry: 0x7c80 },
];

function renderEffect(jsSID, sourceMemory, entry, { sampleRate = 44100, maxFrames = 500 } = {}) {
    const memory = Array.from(sourceMemory),
        synth = new jsSID.TinySID({ sampleRate });
    const cpu = new jsSID.MOS6510(memory, synth),
        samplesPerFrame = sampleRate / 50;
    const samples = new Float32Array(samplesPerFrame * maxFrames);
    let instructions = 0;
    const parse = cpu.cpuParse;
    cpu.cpuParse = function () {
        if (++instructions > 1000000) throw new Error('Effect routine exceeded instruction budget');
        return parse.call(this);
    };
    cpu.cpuJSR(0x7b79, 0);
    cpu.cpuJSR(entry, 0);
    let frame = 0,
        releaseFrames = 0;
    for (; frame < maxFrames; frame++) {
        instructions = 0;
        cpu.cpuJSR(0x7cda, 0);
        synth.generateIntoBuffer(samplesPerFrame, samples, frame * samplesPerFrame);
        if (!memory[0x7e28] && !memory[0x7e31] && !memory[0x7e3a]) releaseFrames++;
        else releaseFrames = 0;
        if (releaseFrames >= 50) break;
    }
    if (frame === maxFrames) throw new Error(`Effect $${entry.toString(16)} did not finish`);
    return samples.subarray(0, (frame + 1) * samplesPerFrame);
}

async function main() {
    const args = process.argv.slice(2),
        rendererPath = args[args.indexOf('--jssid') + 1];
    if (!args.includes('--jssid') || !rendererPath)
        throw new Error(
            'Usage: node tools/audio/c64.mjs --jssid /path/to/jsSID/js [--output /tmp/originals] [--runtime-output /tmp/runtime-effects]',
        );
    const output = args.includes('--output')
        ? resolve(args[args.indexOf('--output') + 1])
        : assetDirectory;
    const runtimeOutput = args.includes('--runtime-output')
        ? resolve(args[args.indexOf('--runtime-output') + 1])
        : args.includes('--output')
          ? output
          : runtimeDirectory;
    await mkdir(output, { recursive: true });
    await mkdir(runtimeOutput, { recursive: true });
    const sidBytes = await readFile(join(assetDirectory, 'Exolon.sid')),
        sid = parseSid(sidBytes);
    const renderer = await loadOfflineRenderer(rendererPath),
        recordings = [];
    for (const [name, song, frames] of [
        ['title', 0, 5200],
        ['game-over', 1, 180],
    ]) {
        const wave = encodeWave(renderSid(renderer.jsSID, sid, { song, frames }), 44100);
        const wavPath = join(output, `${name}.wav`);
        await writeFile(wavPath, wave);
        recordings.push({
            name,
            subsong: song + 1,
            frames,
            seconds: frames / 50,
            waveSha256: sha256(wave),
            file: `${name}.wav`,
            sha256: sha256(wave),
        });
    }
    const memory = Buffer.alloc(65536);
    const engine = await readFile(join(assetDirectory, 'audio-engine.bin'));
    const random = await readFile(join(assetDirectory, 'random-routine.bin'));
    engine.copy(memory, 0x6aba);
    random.copy(memory, 0x37a5);
    // The original PRNG is seeded deterministically for reproducible captures.
    memory[0x2f] = 0;
    memory[0x30] = 0;
    for (const { name, entry } of C64_EFFECTS) {
        const samples = renderEffect(renderer.jsSID, memory, entry),
            wave = encodeWave(samples, 44100);
        await writeFile(join(runtimeOutput, `${name}.wav`), wave);
        recordings.push({
            name,
            entry: `$${entry.toString(16)}`,
            file: `${name}.wav`,
            seconds: samples.length / 44100,
            sha256: sha256(wave),
        });
    }
    await writeFile(
        join(output, 'render.json'),
        `${JSON.stringify(
            {
                sourceSha256: sha256(sidBytes),
                sampleRate: 44100,
                engineSha256: sha256(engine),
                randomRoutineSha256: sha256(random),
                clock: 'PAL 50 Hz',
                renderer: 'jsSID TinySID (offline only)',
                rendererSourceSha256: renderer.sources,
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
