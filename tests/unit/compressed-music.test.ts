import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    compressMusic,
    parseWave,
    parseAACMetadata,
    refreshMusicMetadata,
    renderRecordings,
} from '../../tools/audio/compress.mjs';

const expectedSources = [
    'c64/title.wav',
    'c64/game-over.wav',
    'cpc/title.wav',
    'cpc/game-over.wav',
    'gameboy/title.wav',
    'gameboy/game-over.wav',
    'sharp-mz800/title.wav',
    'amiga/title.wav',
    'atari-st/title.wav',
    'atari-st/game-over.wav',
];
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function descriptor(bytes: Buffer, offset: number) {
    const tag = bytes[offset++];
    let size = 0;
    for (let count = 0; count < 4; count++) {
        const next = bytes[offset++];
        size = size * 128 + (next & 127);
        if (!(next & 128)) return { tag, offset, end: offset + size };
    }
    throw new Error('Invalid MPEG-4 descriptor length');
}

function aacConfiguration(bytes: Buffer) {
    const esds = bytes.indexOf(Buffer.from('esds'));
    assert.ok(esds >= 4, 'MPEG-4 elementary stream descriptor');
    const stream = descriptor(bytes, esds + 8);
    assert.equal(stream.tag, 3, 'ES descriptor');
    assert.equal(bytes[stream.offset + 2], 0, 'No optional ES header fields');
    const decoder = descriptor(bytes, stream.offset + 3);
    assert.equal(decoder.tag, 4, 'DecoderConfig descriptor');
    assert.equal(bytes[decoder.offset], 0x40, 'MPEG-4 Audio object type');
    const specific = descriptor(bytes, decoder.offset + 13);
    assert.equal(specific.tag, 5, 'AudioSpecificConfig descriptor');
    assert.equal(specific.end - specific.offset, 2, 'Standard AAC configuration');
    const config = bytes.readUInt16BE(specific.offset);
    const frequencies = [
        96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
    ];
    return {
        profile: config >>> 11,
        sampleRate: frequencies[(config >>> 7) & 15],
        channels: (config >>> 3) & 15,
    };
}

function atom(name: string, data: Buffer) {
    const result = Buffer.alloc(data.length + 8);
    result.writeUInt32BE(result.length, 0);
    result.write(name, 4, 'ascii');
    data.copy(result, 8);
    return result;
}
function m4a(gapless = ' 00000000 00000840 000003B2 000000000000000E', name = 'iTunSMPB') {
    const item = atom(
        '----',
        Buffer.concat([
            atom('mean', Buffer.concat([Buffer.alloc(4), Buffer.from('com.apple.iTunes')])),
            atom('name', Buffer.concat([Buffer.alloc(4), Buffer.from(name)])),
            atom(
                'data',
                Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 0, 0, 0]), Buffer.from(gapless)]),
            ),
        ]),
    );
    const metadata = atom('meta', Buffer.concat([Buffer.alloc(4), atom('ilst', item)]));
    return Buffer.concat([
        atom('ftyp', Buffer.from('M4A \0\0\0\0M4A ')),
        atom('moov', atom('udta', metadata)),
        atom('mdat', Buffer.from('iTunSMPB is not parsed from unrelated atoms')),
    ]);
}

test('AAC gapless metadata reads exact priming, remainder and valid PCM frame counts', () => {
    assert.deepEqual(parseAACMetadata(m4a()), {
        primingFrames: 2112,
        remainderFrames: 946,
        validFrames: 14,
    });
    assert.deepEqual(parseAACMetadata(m4a(' 00000000 00000840 000002F9 00000000001E88C7')), {
        primingFrames: 2112,
        remainderFrames: 761,
        validFrames: 2001095,
    });
});

test('AAC metadata rejects missing, malformed, unsafe or inconsistent gapless values', () => {
    assert.throws(() => parseAACMetadata(Buffer.alloc(0)), /M4A|MP4/);
    assert.throws(() => parseAACMetadata(m4a('', 'unrelated')), /iTunSMPB/);
    assert.throws(() => parseAACMetadata(m4a('nonsense')), /iTunSMPB/);
    assert.throws(
        () => parseAACMetadata(m4a(' 00000000 00000840 00000000 FFFFFFFFFFFFFFFF')),
        /safe|range/i,
    );
    assert.throws(
        () => parseAACMetadata(m4a(' 00000000 00000840 000003B1 000000000000000E')),
        /packet|frame/i,
    );
    assert.throws(() => parseAACMetadata(m4a().subarray(0, 30)), /truncated|size/i);
});

function chunk(id: string, data: Buffer) {
    const result = Buffer.alloc(8 + data.length + (data.length % 2));
    result.write(id, 0, 'ascii');
    result.writeUInt32LE(data.length, 4);
    data.copy(result, 8);
    return result;
}
function wave(channels = 1, extras = false) {
    const format = Buffer.alloc(16);
    format.writeUInt16LE(1, 0);
    format.writeUInt16LE(channels, 2);
    format.writeUInt32LE(44100, 4);
    format.writeUInt32LE(44100 * channels * 2, 8);
    format.writeUInt16LE(channels * 2, 12);
    format.writeUInt16LE(16, 14);
    const chunks = [chunk('fmt ', format), chunk('data', Buffer.alloc(28 * channels))];
    if (extras) chunks.unshift(chunk('JUNK', Buffer.from([1, 2, 3])));
    const body = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
    const header = Buffer.alloc(8);
    header.write('RIFF');
    header.writeUInt32LE(body.length, 4);
    return Buffer.concat([header, body]);
}

test('WAV metadata uses PCM frame count, channels and RIFF chunks including odd padding', () => {
    for (const channels of [1, 2]) {
        assert.deepEqual(parseWave(wave(channels, true)), {
            frames: 14,
            sampleRate: 44100,
            channels,
            bitsPerSample: 16,
        });
    }
    const reordered = wave(1);
    const dataChunk = reordered.subarray(36);
    const fmtChunk = reordered.subarray(12, 36);
    const dataFirst = Buffer.concat([reordered.subarray(0, 12), dataChunk, fmtChunk]);
    assert.equal(parseWave(dataFirst).frames, 14);
});

test('WAV metadata rejects malformed, truncated or non-PCM files', () => {
    assert.throws(() => parseWave(Buffer.alloc(0)), /WAVE|RIFF/);
    const nonWave = wave();
    nonWave.write('AVI ', 8);
    assert.throws(() => parseWave(nonWave), /WAVE/);
    assert.throws(() => parseWave(wave().subarray(0, 45)), /truncated|size/i);
    const badChunk = wave();
    badChunk.writeUInt32LE(0xffffffff, 16);
    assert.throws(() => parseWave(badChunk), /chunk|truncated/i);
    const compressed = wave();
    compressed.writeUInt16LE(3, 20);
    assert.throws(() => parseWave(compressed), /PCM/);
    const partial = wave();
    partial.writeUInt16LE(3, 32);
    assert.throws(() => parseWave(partial), /alignment|frame/i);
    const noData = wave().subarray(0, 36);
    noData.writeUInt32LE(noData.length - 8, 4);
    assert.throws(() => parseWave(noData), /data/i);
    const invalidRate = wave();
    invalidRate.writeUInt32LE(0, 24);
    assert.throws(() => parseWave(invalidRate), /rate|format/i);
});

test('offline generation is repeatable, restricts inputs, and preserves all source bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reex-aac-test-'));
    const runtimeRoot = join(root, 'runtime');
    const encodedFiles: string[] = [];
    const fakeM4a = m4a();
    try {
        for (const source of expectedSources) {
            await mkdir(join(root, source, '..'), { recursive: true });
            await writeFile(join(root, source), wave(source.startsWith('amiga/') ? 2 : 1));
        }
        await mkdir(join(root, 'atari-st/archive'), { recursive: true });
        const extraFiles = ['c64/fire.wav', 'atari-st/archive/title-50hz.wav'];
        for (const file of extraFiles) await writeFile(join(root, file), wave());
        const encode = async (source: string, target: string) => {
            encodedFiles.push(source);
            await writeFile(target, fakeM4a);
        };
        const first = await compressMusic(root, encode, runtimeRoot);
        const firstMetadata = await readFile(join(runtimeRoot, 'compressed/recordings.ts'), 'utf8');
        const second = await compressMusic(root, encode, runtimeRoot);
        assert.deepEqual(first, second);
        assert.equal(
            firstMetadata,
            await readFile(join(runtimeRoot, 'compressed/recordings.ts'), 'utf8'),
        );
        assert.equal(firstMetadata, renderRecordings(first.recordings));
        const historicalProvenance = await readFile(join(root, 'compressed/provenance.json'));
        const refreshed = await refreshMusicMetadata(root, runtimeRoot);
        assert.deepEqual(refreshed, first);
        assert.deepEqual(
            await readFile(join(root, 'compressed/provenance.json')),
            historicalProvenance,
        );
        assert.ok(!firstMetadata.includes('COMPRESSED_RECORDINGS'));
        assert.ok(!firstMetadata.includes('.wav'));
        assert.ok(firstMetadata.includes('export const C64_TITLE = {'));
        assert.equal(
            firstMetadata,
            await readFile(join(runtimeRoot, 'compressed/recordings.ts'), 'utf8'),
        );
        for (const file of expectedSources) {
            assert.deepEqual(
                await readFile(join(runtimeRoot, file.replace(/\.wav$/, '.m4a'))),
                fakeM4a,
            );
            assert.equal(first.recordings[file].encoded.primingFrames, 2112);
            assert.equal(first.recordings[file].encoded.remainderFrames, 946);
            assert.equal(first.recordings[file].encoded.validFrames, 14);
        }
        assert.deepEqual(
            encodedFiles,
            [...expectedSources, ...expectedSources].map((f) => join(root, f)),
        );
        for (const file of [...expectedSources, ...extraFiles]) {
            assert.deepEqual(
                await readFile(join(root, file)),
                wave(file.startsWith('amiga/') ? 2 : 1),
            );
        }
        assert.equal(first.encoder.executable, '/usr/bin/afconvert');
        assert.deepEqual(first.encoder.arguments, [
            '-f',
            'm4af',
            '-d',
            'aac',
            '-b',
            '128000',
            '-s',
            '0',
            '-q',
            '127',
        ]);
        for (const source of expectedSources) {
            const item = first.recordings[source];
            assert.equal(item.source.file, source);
            assert.equal(item.source.sha256, digest(wave(source.startsWith('amiga/') ? 2 : 1)));
            assert.equal(item.encoded.sha256, digest(fakeM4a));
            assert.equal(item.encoded.file, source.replace(/\.wav$/, '.m4a'));
            assert.equal(item.source.frames, 14);
        }
        const savedManifest = await readFile(join(runtimeRoot, 'compressed/recordings.ts'));
        const changedEncoded = Buffer.concat([
            fakeM4a,
            atom('free', Buffer.from('new encoder metadata')),
        ]);
        await assert.rejects(
            compressMusic(
                root,
                async (_source: string, target: string) => {
                    await writeFile(target, changedEncoded);
                },
                runtimeRoot,
            ),
            /historical.*provenance/i,
        );
        assert.deepEqual(
            await readFile(join(root, 'compressed/provenance.json')),
            historicalProvenance,
        );
        assert.deepEqual(await readFile(join(runtimeRoot, 'c64/title.m4a')), fakeM4a);
        assert.deepEqual(
            await readFile(join(runtimeRoot, 'compressed/recordings.ts')),
            savedManifest,
        );
        const invalid = m4a(' 00000000 00000840 000003B0 0000000000000010');
        await writeFile(join(runtimeRoot, 'c64/title.m4a'), invalid);
        await assert.rejects(refreshMusicMetadata(root, runtimeRoot), /source|valid|frames/i);
        assert.deepEqual(
            await readFile(join(runtimeRoot, 'compressed/recordings.ts')),
            savedManifest,
        );
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('saved AAC copies match provenance, PCM metadata and runtime manifest without an encoder', async () => {
    const root = new URL('../../src/audio/', import.meta.url);
    const originals = new URL('../../originals/audio/', import.meta.url);
    const provenance = JSON.parse(
        await readFile(new URL('compressed/provenance.json', originals), 'utf8'),
    ) as {
        codec: string;
        bitrate: number;
        recordings: Record<
            string,
            {
                source: {
                    file: string;
                    sha256: string;
                    bytes: number;
                    frames: number;
                    sampleRate: number;
                    channels: number;
                    bitsPerSample: number;
                };
                encoded: {
                    file: string;
                    sha256: string;
                    bytes: number;
                    primingFrames: number;
                    remainderFrames: number;
                    validFrames: number;
                };
            }
        >;
    };
    assert.equal(provenance.codec, 'AAC-LC');
    assert.equal(provenance.bitrate, 128000);
    assert.deepEqual(Object.keys(provenance.recordings), expectedSources);
    assert.equal(
        await readFile(new URL('compressed/recordings.ts', root), 'utf8'),
        renderRecordings(provenance.recordings),
    );
    let sourceBytes = 0;
    let encodedBytes = 0;
    for (const file of expectedSources) {
        const { source, encoded } = provenance.recordings[file];
        const original = await readFile(new URL(file, originals));
        const compressed = await readFile(new URL(encoded.file, root));
        assert.equal(source.file, file);
        assert.equal(source.sha256, digest(original), file);
        assert.equal(source.bytes, original.length, file);
        assert.equal(encoded.sha256, digest(compressed), file);
        assert.equal(encoded.bytes, compressed.length, file);
        assert.deepEqual(parseAACMetadata(compressed), {
            primingFrames: encoded.primingFrames,
            remainderFrames: encoded.remainderFrames,
            validFrames: source.frames,
        });
        assert.equal(encoded.validFrames, source.frames);
        assert.deepEqual(parseWave(original), {
            frames: source.frames,
            sampleRate: source.sampleRate,
            channels: source.channels,
            bitsPerSample: source.bitsPerSample,
        });
        assert.equal(compressed.toString('ascii', 4, 8), 'ftyp', file);
        assert.equal(compressed.toString('ascii', 8, 12), 'M4A ', file);
        for (const atom of ['moov', 'mdat', 'mp4a', 'esds']) {
            assert.ok(compressed.includes(Buffer.from(atom)), `${file}: ${atom}`);
        }
        assert.deepEqual(
            aacConfiguration(compressed),
            {
                profile: 2,
                sampleRate: source.sampleRate,
                channels: source.channels,
            },
            `${file}: AAC-LC preserves source sample rate/channels`,
        );
        assert.ok(compressed.length < original.length * 0.3, `${file}: compression ratio`);
        sourceBytes += original.length;
        encodedBytes += compressed.length;
    }
    assert.ok(encodedBytes < sourceBytes * 0.25, 'Total music payload reduced by at least 75%');
});
