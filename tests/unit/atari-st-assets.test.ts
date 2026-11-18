import test from 'node:test';
import assert from 'node:assert/strict';
import {
    readStxSectors,
    readAtariTosData,
    recoverAtariStFiles,
} from '../../tools/recovery/atari-st.mjs';

function sectorImage() {
    const bytes = Buffer.alloc(16 + 16 + 16 + 512);
    bytes.write('RSY\0');
    bytes.writeUInt16LE(3, 4);
    bytes[10] = 1;
    bytes.writeUInt32LE(16 + 16 + 512, 16);
    bytes.writeUInt16LE(1, 24);
    bytes.writeUInt16LE(1, 26);
    bytes[40] = 0;
    bytes[41] = 0;
    bytes[42] = 1;
    bytes[43] = 2;
    bytes[46] = 8;
    bytes.set([0xde, 0xad, 0xbe, 0xef], 48);
    return bytes;
}

test('STX extraction respects descriptor bounds and preserves native sector error flags', () => {
    const input = sectorImage(),
        before = Buffer.from(input);
    const sectors = readStxSectors(input);
    assert.equal(sectors.length, 1);
    assert.deepEqual(
        [sectors[0].track, sectors[0].head, sectors[0].sector, sectors[0].status],
        [0, 0, 1, 8],
    );
    assert.equal(sectors[0].data.length, 512);
    assert.deepEqual([...sectors[0].data.slice(0, 4)], [222, 173, 190, 239]);
    assert.deepEqual(input, before);
});

test('STX recovery rejects truncated tracks, out-of-track data and unsupported headers', () => {
    assert.throws(() => readStxSectors(sectorImage().subarray(0, 100)));
    const offset = sectorImage();
    offset.writeUInt32LE(600, 32);
    assert.throws(() => readStxSectors(offset));
    const version = sectorImage();
    version.writeUInt16LE(1, 4);
    assert.throws(() => readStxSectors(version));
    assert.throws(() => recoverAtariStFiles(sectorImage()), /checksum|Unsupported/);
});

test('TOS data extraction omits the28-byte header and relocation trailer using declared lengths', () => {
    const file = Buffer.alloc(34);
    file.writeUInt16BE(0x601a);
    file.writeUInt32BE(4, 2);
    file.set([1, 2, 3, 4, 0, 0], 28);
    assert.deepEqual([...readAtariTosData(file)], [1, 2, 3, 4]);
    assert.throws(() => readAtariTosData(file.subarray(0, 30)));
    assert.throws(() => readAtariTosData(new Uint8Array(28)));
});
