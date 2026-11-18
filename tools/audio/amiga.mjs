import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AMIGA_TITLE_TIMING, parseAmigaTitleBank, renderAmigaTitle } from './amiga/replay.ts';
import { AMIGA_DISK_SHA256, recoverAmigaMemory } from '../recovery/amiga.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const defaultOutput = fileURLToPath(new URL('../../originals/audio/amiga/', import.meta.url));

export function encodeAmigaWave(samples, sampleRate) {
    if (!(samples instanceof Int16Array) || samples.length % 2)
        throw new Error('Expected interleaved stereo Int16 PCM.');
    const wave = Buffer.alloc(44 + samples.length * 2);
    wave.write('RIFF');
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write('WAVEfmt ', 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(2, 22);
    wave.writeUInt32LE(sampleRate, 24);
    wave.writeUInt32LE(sampleRate * 4, 28);
    wave.writeUInt16LE(4, 32);
    wave.writeUInt16LE(16, 34);
    wave.write('data', 36);
    wave.writeUInt32LE(samples.length * 2, 40);
    for (let index = 0; index < samples.length; index++)
        wave.writeInt16LE(samples[index], 44 + index * 2);
    return wave;
}

export async function extractAmigaAudio(disk, directory = defaultOutput) {
    // Validates the entire supported source revision before extracting any bytes.
    const { memory } = recoverAmigaMemory(disk);
    const bank = memory.slice(0x5e4f0, 0x682f0);
    const driver = memory.slice(0x5da00, 0x5e200);
    const lifecycleRegions = [
        { address: 0x9570, bytes: 0x2a },
        { address: 0x9fce, bytes: 0x74 },
        { address: 0x9310, bytes: 0xac },
    ];
    const lifecycle = Buffer.concat(
        lifecycleRegions.map(({ address, bytes }) => memory.slice(address, address + bytes)),
    );
    const song = parseAmigaTitleBank(bank);
    const render = renderAmigaTitle(song);
    const wave = encodeAmigaWave(render.samples, render.sampleRate);
    const instruments = song.instruments.map((instrument, index) => ({
        index: index + 1,
        name: instrument.name,
        sourceOffset: instrument.sourceOffset,
        diskOffset: 0x1f400 + instrument.sourceOffset,
        bytes: instrument.data.length,
        initialBytes: instrument.initialBytes,
        volume: instrument.volume,
        loopStart: instrument.loopStart,
        loopBytes: instrument.loopBytes,
        sourceSha256: sha256(
            bank.subarray(
                instrument.sourceOffset,
                instrument.sourceOffset + instrument.data.length,
            ),
        ),
        initializedSha256: sha256(instrument.data),
    }));
    const provenance = {
        platform: 'Amiga',
        sourceDiskSha256: AMIGA_DISK_SHA256,
        sourceRevision: 'Disk.1 from Exolon_v1.3_0015.lha; PAL timing assumed',
        driverDiskOffset: 0x1ec00,
        driverAddress: 0x5da00,
        driverBytes: driver.length,
        driverSha256: sha256(driver),
        bankDiskOffset: 0x1f400,
        bankAddress: 0x5e4f0,
        bankBytes: bank.length,
        bankSha256: sha256(bank),
        playbackContexts: ['title', 'gameplay'],
        lifecycleRegions,
        lifecycleSha256: sha256(lifecycle),
        format: '60-byte sample-allocation prefix + 600-byte 15-instrument SoundTracker header + 1024-byte patterns + signed 8-bit PCM',
        originalDriver: {
            initialize: '0x5da0e',
            tick: '0x5db04',
            row: '0x5dcb2',
            note: '0x5dd92',
            timerSetup: 'loader 0x15812 writes 0x3b88 to 0x155e4',
            timerDispatch: 'loader 0x15398 calls pointer at 0x5da08',
            gameplayInitialize: '0x957c calls 0xa016 -> pointer 0x5da00',
            gameplayTimer: '0x9578 calls 0x9582: pointer 0x1500c = 0x155e4, latch 0x3b88',
            gameplayRouting: '0x96a8 -> 0x9310 -> 0x93b6 -> 0x9570',
            gameplayToggle: '0x9fda tests F; 0x9fec calls init 0xa016, 0x9ff4 calls stop 0xa02c',
            modulePointer: '0x5df86 = 0x5e4f0; same bank used in both playback contexts',
            effectDispatcher: '0xa040: RTS (0x4e75)',
        },
        paulaClock: AMIGA_TITLE_TIMING.paulaClock,
        ciaClock: AMIGA_TITLE_TIMING.ciaClock,
        timerLatch: AMIGA_TITLE_TIMING.timerLatch,
        ticksPerRow: AMIGA_TITLE_TIMING.ticksPerRow,
        orders: song.orders,
        patternCount: song.patternCount,
        rows: song.rows.length,
        effects: [...new Set(song.rows.flat().map((note) => note.effect))].sort(),
        instruments,
        sampleRate: render.sampleRate,
        channels: 2,
        frames: render.frames,
        durationSeconds: render.durationSeconds,
        wavSha256: sha256(wave),
        rendering:
            'Original notes, periods, volumes and initialized PCM; sample-and-hold mixing; Amiga stereo channels 0/3 left, 1/2 right; half-gain per channel',
        limitations: [
            'Register-level offline port; DMA bus contention, intra-tick register-write timing and analog filters are not simulated.',
            'PAL clocks assumed. No source-based PAL/NTSC auto-detection is claimed.',
            'Five initialization ticks of silence are omitted; recording begins on first note and spans one score loop.',
            'The original gameplay effect dispatcher at 0xa040 is a bare RTS; no substitute effects are provided.',
        ],
        reproduce:
            'node --experimental-strip-types tools/audio/amiga.mjs /path/to/Disk.1 [output-directory]',
    };
    await mkdir(directory, { recursive: true });
    for (const [name, data] of [
        ['title-bank.bin', bank],
        ['audio-engine.bin', driver],
        ['music-lifecycle.bin', lifecycle],
        ['title.wav', wave],
        ['provenance.json', JSON.stringify(provenance, null, 2) + '\n'],
    ])
        await writeFile(join(directory, name), data);
    return provenance;
}

async function main(args) {
    if (args.length < 1 || args.length > 2)
        throw new Error(
            'Usage: node --experimental-strip-types tools/audio/amiga.mjs /path/to/Disk.1 [output-directory]',
        );
    const provenance = await extractAmigaAudio(
        await readFile(resolve(args[0])),
        args[1] ? resolve(args[1]) : defaultOutput,
    );
    console.log(
        JSON.stringify({
            frames: provenance.frames,
            seconds: provenance.durationSeconds,
            sha256: provenance.wavSha256,
        }),
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
