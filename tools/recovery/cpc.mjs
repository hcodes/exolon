// Offline DSK/AMSDOS data extraction; no CPU or CPC emulator is required.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CPC_TAPE_SHA256 = '32f84af268431975f72847f1cd2d53bcfd1d4db1de0c04eed3f62532b8e2cf30';
const CPC_DISK_SHA256 = 'f8cb122713118feb48fcd7193f77ca66ad86e4fb739c37088ec8f71d34e54fd9';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const word = (bytes, address) => bytes[address] | (bytes[address + 1] << 8);

/** Read the standard 1 KiB-allocation CP/M data disk used by this archive. */
export function readCpcDisk(disk) {
    if (disk.length < 256 || disk.subarray(0, 23).toString() !== 'EXTENDED CPC DSK File\r\n')
        throw new Error('Expected an extended CPC DSK.');
    let offset = 256;
    const tracks = [];
    for (let track = 0; track < disk[48] * disk[49]; track++) {
        const size = disk[52 + track] * 256;
        if (!size) continue;
        if (
            offset + size > disk.length ||
            disk.subarray(offset, offset + 10).toString() !== 'Track-Info'
        )
            throw new Error('Truncated CPC DSK track.');
        const sectors = [];
        let data = offset + 256;
        for (let i = 0; i < disk[offset + 21]; i++) {
            const descriptor = offset + 24 + i * 8,
                length = word(disk, descriptor + 6);
            if (data + length > offset + size || !length)
                throw new Error('Invalid CPC DSK sector.');
            sectors.push({ id: disk[descriptor + 2], bytes: disk.subarray(data, data + length) });
            data += length;
        }
        tracks.push(
            Buffer.concat(sectors.sort((a, b) => a.id - b.id).map((sector) => sector.bytes)),
        );
        offset += size;
    }
    const bytes = Buffer.concat(tracks),
        extents = new Map();
    for (let offset = 0; offset < 2048; offset += 32) {
        const entry = bytes.subarray(offset, offset + 32);
        if (entry.length !== 32 || entry[0] !== 0) continue;
        const name = Buffer.from(
            Array.from(entry.subarray(1, 12), (byte) => byte & 127),
        ).toString();
        const basename = name.slice(0, 8).trim() + '.' + name.slice(8).trim();
        const blocks = [];
        for (const block of entry.subarray(16)) {
            if (!block) continue;
            if ((block + 1) * 1024 > bytes.length)
                throw new Error('Invalid CP/M allocation block.');
            blocks.push(bytes.subarray(block * 1024, (block + 1) * 1024));
        }
        if (!extents.has(basename)) extents.set(basename, []);
        extents.get(basename).push({
            id: entry[12] | (entry[14] << 5),
            bytes: Buffer.concat(blocks).subarray(0, entry[15] * 128),
        });
    }
    return new Map(
        [...extents].map(([name, parts]) => [
            name,
            Buffer.concat(parts.sort((a, b) => a.id - b.id).map((part) => part.bytes)),
        ]),
    );
}

/** Decode the archived disk loader's byte repetition format at $800a. */
export function unpackCpcLoadingScreen(packed) {
    if (packed.length < 108 || packed[0] !== 0x18 || packed[1] !== 8)
        throw new Error('Unsupported CPC loading screen codec.');
    let literal = word(packed, 3),
        mask = word(packed, 5);
    const groups = word(packed, 7),
        result = new Uint8Array(16384);
    let output = 0;
    const at = (address) => {
        if (address < 0 || address >= packed.length)
            throw new Error('Truncated CPC loading picture.');
        return packed[address];
    };
    for (let i = 0; i < 256; i++) {
        const group = at(groups + i);
        for (let bit = 0; bit < 8; bit++) {
            const repeated = group & (1 << bit) ? at(mask++) : 0;
            for (let j = 0; j < 8; j++) {
                result[output] = output && repeated & (1 << j) ? result[output - 1] : at(literal++);
                output++;
            }
        }
    }
    if (literal !== word(packed, 5) || mask !== groups)
        throw new Error('CPC loading picture stream boundaries differ.');
    return result;
}

export function unpackCpcDisk(disk) {
    if (disk.length !== 194816 || sha256(disk) !== CPC_DISK_SHA256)
        throw new Error('Unsupported original CPC Exolon archive disk.');
    const files = readCpcDisk(disk);
    const binary = (name, length) => {
        const file = files.get(name);
        if (!file || word(file, 24) !== length || file.length < length + 128)
            throw new Error(`Invalid AMSDOS binary ${name}.`);
        let sum = 0;
        for (let i = 0; i < 67; i++) sum += file[i];
        if ((sum & 65535) !== word(file, 67))
            throw new Error(`Invalid AMSDOS header checksum: ${name}.`);
        return file.subarray(128, 128 + length);
    };
    const memory = new Uint8Array(65536);
    memory.set(binary('EXOLON.1', 0x6add), 0x100);
    memory.set(binary('EXOLON.2', 0x3424), 0x6bdd);
    // Original loader copies EXOLON.3 from C000 to A001 before entering 0100.
    memory.set(binary('EXOLON.3', 0x11cc), 0xa001);
    const loading = unpackCpcLoadingScreen(binary('EXOLON.SCR', 0x181c));
    if (sha256(memory) !== '496d9dac1ed78cd9f0635ca751d33bf73073d515626ef3a05dfc02166a3059ec')
        throw new Error('CPC memory checksum differs from the verified source.');
    return { memory, loading };
}

/** Verify that all disk game bytes are also in the original commercial cassette. */
export function verifyCpcCommercialTape(tape, memory) {
    if (sha256(tape) !== CPC_TAPE_SHA256) throw new Error('Unsupported commercial Exolon CDT.');
    let offset = 10;
    const records = [];
    while (offset < tape.length) {
        const type = tape[offset++];
        if (type === 0x20) {
            offset += 2;
            records.push(null);
        } else if (type === 0x11) {
            const length = tape[offset + 15] | (tape[offset + 16] << 8) | (tape[offset + 17] << 16);
            records.push(tape.subarray(offset + 18, offset + 18 + length));
            offset += 18 + length;
        } else throw new Error('Unexpected original CDT record.');
    }
    const code = records[6]?.subarray(1, -1),
        graphics = records[8]?.subarray(1, -1);
    if (
        !code ||
        !graphics ||
        code.length !== 0x6add ||
        graphics.length !== 0x45f0 ||
        !Buffer.from(memory.subarray(0x100, 0x6bdd)).equals(code) ||
        !Buffer.from(memory.subarray(0x6bdd, 0xb1cd)).equals(graphics)
    )
        throw new Error('Commercial CPC tape and disk game bytes differ.');
    return {
        codeBytes: code.length,
        graphicsBytes: graphics.length,
        codeSha256: sha256(code),
        graphicsSha256: sha256(graphics),
    };
}

async function main(args) {
    if (args.length < 3 || args.length > 4)
        throw new Error(
            'Usage: node tools/recovery/cpc.mjs /path/to/exolon,exolon.dsk /path/to/cpc-ram.bin /path/to/cpc-disk-loading.bin [/path/to/original-erbe.cdt]',
        );
    const { memory, loading } = unpackCpcDisk(await readFile(resolve(args[0])));
    const verification = args[3]
        ? verifyCpcCommercialTape(await readFile(resolve(args[3])), memory)
        : null;
    await writeFile(resolve(args[1]), memory, { flag: 'wx' });
    await writeFile(resolve(args[2]), loading, { flag: 'wx' });
    console.log(
        JSON.stringify(
            {
                memorySha256: sha256(memory),
                loadingSha256: sha256(loading),
                commercialVerification: verification,
            },
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
