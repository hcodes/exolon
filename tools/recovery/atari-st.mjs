// Offline sector/file recovery from the canonical STX; no floppy or CPU runs in the game.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ATARI_ST_STX_SHA256 =
    '10a96cc93ab4c73a171f0e3408e99d2ff692a280bdb4f05eaf4e75f33e185ccf';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const u16 = (b, a) => b[a] + b[a + 1] * 256;
const u32 = (b, a) => u16(b, a) + u16(b, a + 2) * 65536;
const be32 = (b, a) => b[a] * 16777216 + b[a + 1] * 65536 + b[a + 2] * 256 + b[a + 3];
function bounds(bytes, at, size, end = bytes.length) {
    if (
        !Number.isSafeInteger(at) ||
        !Number.isSafeInteger(size) ||
        at < 0 ||
        size < 0 ||
        at + size > end ||
        end > bytes.length
    )
        throw new RangeError('Truncated or out-of-bounds Atari data.');
}
export function readStxSectors(bytes) {
    bounds(bytes, 0, 16);
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RSY\0' || u16(bytes, 4) !== 3)
        throw new Error('Unsupported STX header.');
    let at = 16;
    const sectors = [];
    for (let track = 0; track < bytes[10]; track++) {
        bounds(bytes, at, 16);
        const size = u32(bytes, at),
            fuzzy = u32(bytes, at + 4),
            count = u16(bytes, at + 8),
            flags = u16(bytes, at + 10);
        if (size < 16 || count > 128 || (count && !(flags & 1)))
            throw new Error('Unsupported STX track.');
        bounds(bytes, at, size);
        const dataStart = at + 16 + count * 16 + fuzzy;
        bounds(bytes, at + 16, count * 16 + fuzzy, at + size);
        for (let index = 0; index < count; index++) {
            const header = at + 16 + index * 16,
                exponent = bytes[header + 11];
            if (exponent > 7) throw new Error('Unsupported STX sector length.');
            const offset = u32(bytes, header),
                length = 128 << exponent,
                status = bytes[header + 14];
            if (status & 16) continue; // Original RNF sectors have no data payload.
            bounds(bytes, dataStart + offset, length, at + size);
            sectors.push({
                track: bytes[header + 8],
                head: bytes[header + 9],
                sector: bytes[header + 10],
                status,
                bitPosition: u16(bytes, header + 4),
                data: bytes.slice(dataStart + offset, dataStart + offset + length),
            });
        }
        at += size;
    }
    if (at !== bytes.length) throw new Error('Unexpected STX trailing data.');
    return sectors;
}
export function readAtariTosData(bytes) {
    bounds(bytes, 0, 28);
    if (bytes[0] !== 0x60 || bytes[1] !== 0x1a) throw new Error('Unsupported TOS data header.');
    const length = be32(bytes, 2) + be32(bytes, 6);
    bounds(bytes, 28, length);
    return bytes.slice(28, 28 + length);
}
export function recoverAtariStFiles(bytes) {
    if (sha256(bytes) !== ATARI_ST_STX_SHA256)
        throw new Error('Unsupported Atari ST disk checksum.');
    const sectors = readStxSectors(bytes),
        boot = sectors.find((s) => s.track === 0 && s.head === 0 && s.sector === 1)?.data;
    if (!boot) throw new Error('Missing Atari boot sector.');
    const bps = u16(boot, 11),
        spc = boot[13],
        reserved = u16(boot, 14),
        copies = boot[16],
        entries = u16(boot, 17),
        total = u16(boot, 19),
        fatSize = u16(boot, 22),
        spt = u16(boot, 24),
        heads = u16(boot, 26);
    if (
        bps !== 512 ||
        spc !== 2 ||
        copies !== 2 ||
        entries !== 112 ||
        total !== 880 ||
        spt !== 11 ||
        heads !== 1
    )
        throw new Error('Unsupported canonical FAT12 geometry.');
    const image = new Uint8Array(total * bps);
    for (const s of sectors) {
        const index = (s.track * heads + s.head) * spt + s.sector - 1;
        if (
            s.head < heads &&
            index >= 0 &&
            index < total &&
            s.sector >= 1 &&
            s.sector <= spt &&
            s.data.length === bps
        )
            image.set(s.data, index * bps);
    }
    const fat = image.subarray(reserved * bps, (reserved + fatSize) * bps),
        root = (reserved + copies * fatSize) * bps;
    const dataStart = root + entries * 32,
        files = {};
    function chain(cluster) {
        const chunks = [],
            seen = new Set();
        while (cluster >= 2 && cluster < 0xff8) {
            if (seen.has(cluster)) throw new Error('FAT12 chain cycle.');
            seen.add(cluster);
            const at = dataStart + (cluster - 2) * spc * bps;
            bounds(image, at, spc * bps);
            chunks.push(image.subarray(at, at + spc * bps));
            const atFat = Math.floor((cluster * 3) / 2);
            bounds(fat, atFat, 2);
            const next = u16(fat, atFat);
            cluster = cluster & 1 ? next >> 4 : next & 0xfff;
        }
        const result = new Uint8Array(chunks.length * spc * bps);
        chunks.forEach((chunk, i) => result.set(chunk, i * spc * bps));
        return result;
    }
    function directory(data, prefix = '', depth = 0) {
        if (depth > 8) throw new Error('FAT directory nesting limit.');
        for (let at = 0; at + 32 <= data.length; at += 32) {
            if (!data[at]) break;
            if (data[at] === 0xe5 || data[at] === 0x2e || data[at + 11] & 8) continue;
            const text = (start, len) =>
                String.fromCharCode(...data.subarray(start, start + len)).trim();
            const name = text(at, 8),
                ext = text(at + 8, 3),
                path = prefix + name + (ext ? '.' + ext : '');
            if (!/^[A-Z0-9_.\-/]+$/.test(path)) throw new Error('Invalid canonical filename.');
            const content = chain(u16(data, at + 26));
            if (data[at + 11] & 16) directory(content, path + '/', depth + 1);
            else {
                const length = u32(data, at + 28);
                bounds(content, 0, length);
                files[path] = content.slice(0, length);
            }
        }
    }
    directory(image.subarray(root, dataStart));
    return {
        files,
        sectors: sectors.map(({ data, ...header }) => ({ ...header, length: data.length })),
    };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [, , source, target] = process.argv;
    if (!source || !target)
        throw new Error('Usage: node tools/recovery/atari-st.mjs original.stx output-directory');
    const result = recoverAtariStFiles(await readFile(source));
    for (const [name, bytes] of Object.entries(result.files)) {
        const file = resolve(target, name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes, { flag: 'wx' });
    }
    console.log(
        JSON.stringify({ files: Object.keys(result.files).length, sectors: result.sectors.length }),
    );
}
