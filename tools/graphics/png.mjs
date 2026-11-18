// Minimal lossless codec for the project's non-interlaced 8-bit RGB/RGBA assets.
import { inflateSync, deflateSync } from 'node:zlib';
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
    const type = Buffer.from(name),
        length = Buffer.alloc(4),
        checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, checksum]);
}
export function encodePng(width, height, rgba) {
    if (rgba.length !== width * height * 4) throw Error('Incomplete PNG raster');
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++)
        rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
    return Buffer.concat([
        signature,
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(rows)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
export function decodePng(bytes) {
    if (!bytes.subarray(0, 8).equals(signature)) throw Error('Not a PNG');
    const width = bytes.readUInt32BE(16),
        height = bytes.readUInt32BE(20),
        depth = bytes[24],
        color = bytes[25],
        channels = color === 2 ? 3 : color === 6 ? 4 : 0;
    if (depth !== 8 || !channels || bytes[28] !== 0)
        throw Error('Only non-interlaced 8-bit RGB/RGBA PNG is supported');
    const data = [];
    for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset),
            name = bytes.toString('ascii', offset + 4, offset + 8),
            payload = bytes.subarray(offset + 8, offset + 8 + length);
        if (
            crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
            bytes.readUInt32BE(offset + 8 + length)
        )
            throw Error('PNG checksum mismatch');
        if (name === 'IDAT') data.push(payload);
        offset += length + 12;
    }
    const raw = inflateSync(Buffer.concat(data)),
        stride = width * channels,
        rgb = Buffer.alloc(stride * height),
        rgba = new Uint8Array(width * height * 4);
    const paeth = (a, b, c) => {
        const p = a + b - c,
            pa = Math.abs(p - a),
            pb = Math.abs(p - b),
            pc = Math.abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    };
    if (raw.length !== (stride + 1) * height) throw Error('Incomplete PNG scanlines');
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        if (filter > 4) throw Error('Unknown PNG scanline filter');
        for (let x = 0; x < stride; x++) {
            const i = y * stride + x,
                a = x >= channels ? rgb[i - channels] : 0,
                b = y ? rgb[i - stride] : 0,
                c = y && x >= channels ? rgb[i - stride - channels] : 0;
            const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
            rgb[i] = (raw[y * (stride + 1) + x + 1] + prediction) & 255;
        }
    }
    for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = rgb[i * channels];
        rgba[i * 4 + 1] = rgb[i * channels + 1];
        rgba[i * 4 + 2] = rgb[i * channels + 2];
        rgba[i * 4 + 3] = channels === 4 ? rgb[i * channels + 3] : 255;
    }
    return { width, height, rgba };
}
