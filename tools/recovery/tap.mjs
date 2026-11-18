/** Read TAP records, checking boundaries and the Spectrum XOR checksum. */
export function parseTap(bytes) {
    const blocks = [];
    let offset = 0;
    while (offset < bytes.length) {
        if (offset + 2 > bytes.length) {
            throw new Error(`Incomplete TAP length at ${offset}`);
        }
        const size = bytes[offset] | (bytes[offset + 1] << 8);
        if (size < 2) {
            throw new Error(`Invalid TAP block size at ${offset}`);
        }
        const end = offset + 2 + size;
        if (end > bytes.length) {
            throw new Error(`Truncated TAP block at ${offset}`);
        }
        let checksum = 0;
        for (let index = offset + 2; index < end; index++) {
            checksum ^= bytes[index];
        }
        if (checksum !== 0) {
            throw new Error(`Invalid TAP checksum at ${offset}`);
        }
        blocks.push({ offset, flag: bytes[offset + 2], payload: bytes.slice(offset + 3, end - 1) });
        offset = end;
    }
    return blocks;
}

/** Describe standard headers; preserve custom headers as raw metadata. */
export function inspectTap(bytes) {
    return parseTap(bytes).map(({ offset, flag, payload }) => {
        const block = { offset, flag, size: payload.length + 2 };
        if (flag === 0 && payload.length === 17) {
            block.header = {
                type: payload[0],
                name: String.fromCharCode(...payload.slice(1, 11)).trimEnd(),
                length: payload[11] | (payload[12] << 8),
                parameter1: payload[13] | (payload[14] << 8),
                parameter2: payload[15] | (payload[16] << 8),
            };
        }
        return block;
    });
}
