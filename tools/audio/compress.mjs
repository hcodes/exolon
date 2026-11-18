import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// Offline only: ordinary builds copy these saved files and never invoke an encoder.
export const MUSIC_SOURCES = Object.freeze([
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
]);
const ENCODER = '/usr/bin/afconvert';
const ENCODER_ARGUMENTS = ['-f', 'm4af', '-d', 'aac', '-b', '128000', '-s', '0', '-q', '127'];
const execFileAsync = promisify(execFile);
const originalsRoot = fileURLToPath(new URL('../../originals/audio/', import.meta.url));
const audioRoot = fileURLToPath(new URL('../../src/audio/', import.meta.url));

/** @typedef {{ frames: number, sampleRate: number, channels: number, bitsPerSample: number }} WaveMetadata */
/** @typedef {{ primingFrames: number, remainderFrames: number, validFrames: number }} AACMetadata */
/** @typedef {{ source: WaveMetadata & { file: string, sha256: string, bytes: number }, encoded: AACMetadata & { file: string, sha256: string, bytes: number } }} Recording */
/** @param {Buffer} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Read PCM metadata without assuming a fixed 44-byte WAV header.
 * @param {Buffer} bytes
 * @returns {WaveMetadata}
 */
export function parseWave(bytes) {
    if (
        bytes.length < 12 ||
        bytes.toString('ascii', 0, 4) !== 'RIFF' ||
        bytes.toString('ascii', 8, 12) !== 'WAVE'
    ) {
        throw new Error('Expected a RIFF/WAVE file');
    }
    const end = bytes.readUInt32LE(4) + 8;
    if (end < 12 || end > bytes.length) throw new Error('Truncated RIFF size');
    /** @type {Omit<WaveMetadata, 'frames'> | undefined} */
    let format;
    let blockAlign = 0;
    let dataBytes;
    for (let offset = 12; offset < end;) {
        if (offset + 8 > end) throw new Error('Truncated RIFF chunk header');
        const kind = bytes.toString('ascii', offset, offset + 4);
        const size = bytes.readUInt32LE(offset + 4);
        const start = offset + 8;
        const next = start + size + (size % 2);
        if (next > end) throw new Error('Truncated RIFF chunk');
        if (kind === 'fmt ') {
            if (format || size < 16) throw new Error('Invalid PCM format chunk');
            if (bytes.readUInt16LE(start) !== 1) throw new Error('Expected integer PCM WAV');
            const channels = bytes.readUInt16LE(start + 2);
            const sampleRate = bytes.readUInt32LE(start + 4);
            const byteRate = bytes.readUInt32LE(start + 8);
            blockAlign = bytes.readUInt16LE(start + 12);
            const bitsPerSample = bytes.readUInt16LE(start + 14);
            if (!channels || !sampleRate || !bitsPerSample || bitsPerSample % 8) {
                throw new Error('Invalid PCM format or sample rate');
            }
            if (
                blockAlign !== (channels * bitsPerSample) / 8 ||
                byteRate !== sampleRate * blockAlign
            ) {
                throw new Error('Invalid PCM frame alignment or byte rate');
            }
            format = { sampleRate, channels, bitsPerSample };
        } else if (kind === 'data') {
            if (dataBytes !== undefined) throw new Error('Duplicate PCM data chunk');
            dataBytes = size;
        }
        offset = next;
    }
    if (!format || dataBytes === undefined) throw new Error('Missing PCM format or data chunk');
    if (dataBytes % blockAlign) throw new Error('Partial PCM frame in data chunk');
    return { frames: dataBytes / blockAlign, ...format };
}

/** @param {Buffer} bytes @param {number} start @param {number} end */
function readBoxes(bytes, start, end) {
    const boxes = [];
    for (let at = start; at < end;) {
        if (at + 8 > end) throw new Error('Truncated MP4 box header');
        let size = bytes.readUInt32BE(at);
        let header = 8;
        if (size === 1) {
            if (at + 16 > end) throw new Error('Truncated MP4 extended box size');
            size = Number(bytes.readBigUInt64BE(at + 8));
            header = 16;
        } else if (size === 0) {
            size = end - at;
        }
        if (!Number.isSafeInteger(size) || size < header || at + size > end) {
            throw new Error('Invalid or truncated MP4 box size');
        }
        boxes.push({
            type: bytes.toString('ascii', at + 4, at + 8),
            start: at + header,
            end: at + size,
        });
        at += size;
    }
    return boxes;
}

/** Parse the iTunes gapless tag; every count is in source PCM sample frames.
 * @param {Buffer} bytes
 * @returns {AACMetadata}
 */
export function parseAACMetadata(bytes) {
    const top = readBoxes(bytes, 0, bytes.length);
    const ftyp = top.find((box) => box.type === 'ftyp');
    if (!ftyp || bytes.toString('ascii', ftyp.start, ftyp.start + 4) !== 'M4A ') {
        throw new Error('Expected an M4A/MP4 audio file');
    }
    let boxes = top;
    for (const type of ['moov', 'udta', 'meta', 'ilst']) {
        const box = boxes.find((entry) => entry.type === type);
        if (!box) throw new Error('Missing iTunSMPB metadata container');
        boxes = readBoxes(bytes, box.start + (type === 'meta' ? 4 : 0), box.end);
    }
    for (const item of boxes.filter((box) => box.type === '----')) {
        const fields = readBoxes(bytes, item.start, item.end);
        const name = fields.find((box) => box.type === 'name');
        const mean = fields.find((box) => box.type === 'mean');
        if (!name || bytes.toString('ascii', name.start + 4, name.end) !== 'iTunSMPB') continue;
        if (!mean || bytes.toString('ascii', mean.start + 4, mean.end) !== 'com.apple.iTunes')
            continue;
        const data = fields.find((box) => box.type === 'data');
        if (!data || data.start + 8 > data.end) throw new Error('Invalid iTunSMPB data atom');
        const text = bytes.toString('ascii', data.start + 8, data.end);
        const match = /^\s*[\da-f]{8}\s+([\da-f]{8})\s+([\da-f]{8})\s+([\da-f]{16})(?:\s|$)/i.exec(
            text,
        );
        if (!match) throw new Error('Invalid iTunSMPB gapless values');
        const primingFrames = parseInt(match[1], 16);
        const remainderFrames = parseInt(match[2], 16);
        const validFrames = parseInt(match[3], 16);
        const packetFrames = primingFrames + validFrames + remainderFrames;
        if (!Number.isSafeInteger(packetFrames) || validFrames <= 0) {
            throw new Error('iTunSMPB frame count exceeds the safe integer range');
        }
        if (remainderFrames >= 1024 || packetFrames % 1024) {
            throw new Error('iTunSMPB frames do not fill AAC-LC packets');
        }
        return { primingFrames, remainderFrames, validFrames };
    }
    throw new Error('Missing iTunSMPB gapless metadata');
}

/** @param {string} file @param {Buffer} sourceBytes @param {Buffer} encodedBytes
 * @returns {Recording}
 */
function createRecording(file, sourceBytes, encodedBytes) {
    const source = parseWave(sourceBytes);
    const encoded = parseAACMetadata(encodedBytes);
    if (encoded.validFrames !== source.frames) {
        throw new Error(`AAC valid frames do not match source WAV frames: ${file}`);
    }
    return {
        source: { file, sha256: sha256(sourceBytes), bytes: sourceBytes.length, ...source },
        encoded: {
            file: file.replace(/\.wav$/, '.m4a'),
            sha256: sha256(encodedBytes),
            bytes: encodedBytes.length,
            ...encoded,
        },
    };
}

/** @param {Record<string, Recording>} recordings */
export function renderRecordings(recordings) {
    return (
        [
            '// Generated by tools/audio/compress.mjs from the preserved source PCM metadata.',
            ...Object.values(recordings).map(({ source, encoded }) => {
                const name = encoded.file
                    .replace(/\.m4a$/, '')
                    .replace(/[/-]/g, '_')
                    .toUpperCase();
                return [
                    `export const ${name} = {`,
                    `    file: '${encoded.file}',`,
                    `    frames: ${source.frames},`,
                    `    sampleRate: ${source.sampleRate},`,
                    `    channels: ${source.channels},`,
                    `    primingFrames: ${encoded.primingFrames},`,
                    `    remainderFrames: ${encoded.remainderFrames},`,
                    '} as const;',
                ].join('\n');
            }),
        ].join('\n\n') + '\n'
    );
}

/** @param {string} source @param {string} target */
async function encodeAfconvert(source, target) {
    await execFileAsync(ENCODER, [...ENCODER_ARGUMENTS, source, target]);
}

/** Generate just the pinned music copies; never traverse archives or rewrite WAV/manifests.
 * Encoder injection lets unit tests verify file/provenance handling without macOS.
 * @param {string} root
 * @param {(source: string, target: string) => Promise<void>} encode
 * @param {string} runtimeRoot
 */
export async function compressMusic(
    root = originalsRoot,
    encode = encodeAfconvert,
    runtimeRoot = audioRoot,
) {
    const staging = await mkdtemp(join(tmpdir(), 'reex-aac-'));
    /** @type {Record<string, Recording>} */
    const recordings = {};
    try {
        for (const file of MUSIC_SOURCES) {
            const bytes = await readFile(join(root, file));
            const encodedFile = file.replace(/\.wav$/, '.m4a');
            const stagedFile = join(staging, encodedFile);
            await mkdir(dirname(stagedFile), { recursive: true });
            await encode(join(root, file), stagedFile);
            const encoded = await readFile(stagedFile);
            recordings[file] = createRecording(file, bytes, encoded);
        }
        // Finish all conversions before publishing. Refuse provenance for a changed input.
        for (const [file, { source }] of Object.entries(recordings)) {
            if (sha256(await readFile(join(root, file))) !== source.sha256) {
                throw new Error(`Source WAV changed during conversion: ${file}`);
            }
        }
        const provenance = await writeMetadata(root, runtimeRoot, recordings);
        for (const { encoded } of Object.values(recordings)) {
            await mkdir(dirname(join(runtimeRoot, encoded.file)), { recursive: true });
            await writeFile(
                join(runtimeRoot, encoded.file),
                await readFile(join(staging, encoded.file)),
            );
        }
        return provenance;
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
}

/** @param {string} root @param {string} runtimeRoot @param {Record<string, Recording>} recordings @param {boolean} publishProvenance */
async function writeMetadata(root, runtimeRoot, recordings, publishProvenance = true) {
    const provenance = {
        version: 1,
        codec: 'AAC-LC',
        bitrate: 128000,
        encoder: { executable: ENCODER, arguments: ENCODER_ARGUMENTS },
        // afconvert may change MP4 UUID metadata. Hash the real output on every run.
        recordings,
    };
    await mkdir(join(runtimeRoot, 'compressed'), { recursive: true });
    if (publishProvenance) {
        await mkdir(join(root, 'compressed'), { recursive: true });
        const file = join(root, 'compressed/provenance.json');
        const bytes = JSON.stringify(provenance, null, 4) + '\n';
        try {
            await writeFile(file, bytes, { flag: 'wx' });
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            if ((await readFile(file, 'utf8')) !== bytes)
                throw new Error(
                    'Refusing to replace historical compression provenance; use new output roots.',
                    { cause: error },
                );
        }
    }
    await writeFile(join(runtimeRoot, 'compressed/recordings.ts'), renderRecordings(recordings));
    return provenance;
}

/** Refresh metadata from existing bytes without invoking an encoder or writing audio.
 * @param {string} root
 * @param {string} runtimeRoot
 */
export async function refreshMusicMetadata(root = originalsRoot, runtimeRoot = audioRoot) {
    /** @type {Record<string, Recording>} */
    const recordings = {};
    for (const file of MUSIC_SOURCES) {
        recordings[file] = createRecording(
            file,
            await readFile(join(root, file)),
            await readFile(join(runtimeRoot, file.replace(/\.wav$/, '.m4a'))),
        );
    }
    return writeMetadata(root, runtimeRoot, recordings, false);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const args = process.argv.slice(2);
    const option = (name, fallback) =>
        args.includes(name) ? resolve(args[args.indexOf(name) + 1]) : fallback;
    for (let index = 0; index < args.length; index++) {
        if (args[index] === '--metadata-only') continue;
        if (!['--originals-root', '--runtime-root'].includes(args[index]) || !args[index + 1])
            throw new Error(
                'Use --metadata-only, --originals-root /path/to/originals and --runtime-root /path/to/runtime.',
            );
        index++;
    }
    const sourceRoot = option('--originals-root', originalsRoot);
    const runtimeRoot = option('--runtime-root', audioRoot);
    const { recordings } = args.includes('--metadata-only')
        ? await refreshMusicMetadata(sourceRoot, runtimeRoot)
        : await compressMusic(sourceRoot, encodeAfconvert, runtimeRoot);
    for (const { source, encoded } of Object.values(recordings)) {
        console.log(`${source.file}: ${source.bytes} -> ${encoded.bytes} bytes`);
    }
}
