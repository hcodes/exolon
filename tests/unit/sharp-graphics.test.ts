import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    decodeSharpBlock,
    extractSharpGraphics,
    reverseSharpByte,
} from '../../tools/graphics/sharp.mjs';
import {
    readSharpMzf,
    recoverSharpMemory,
    SHARP_MZF_SHA256,
    SHARP_RAM_SHA256,
} from '../../tools/recovery/sharp.mjs';

type Cell = { x: number; y: number; color: number; bitmap: number[] };
type SourceGraphics = {
    platform: string;
    width: number;
    height: number;
    playfieldHeight: number;
    sourceMZFSha256: string;
    sourceRamSha256: string;
    sourceMapsSha256: string;
    tableSha256: Record<string, string>;
    sourceTableSha256: Record<string, string>;
    shapes: number[][];
    screens: Record<string, Cell[]>;
    menuText: { y: number; text: string }[];
    sourceHighScores: { name: string; score: number }[];
};
type TableName =
    'player' | 'small' | 'shifted' | 'font' | 'torch' | 'beam' | 'mine' | 'star' | 'turret';
type Tables = Record<TableName, number[]>;
const sha = (bytes: ArrayLike<number> | string) =>
    createHash('sha256')
        .update(typeof bytes === 'string' ? bytes : Buffer.from(bytes))
        .digest('hex');
const loadGraphics = async (platform: string): Promise<SourceGraphics & Tables> =>
    JSON.parse(
        await readFile(
            new URL(`../../src/assets/graphics/${platform}/graphics.json`, import.meta.url),
            'utf8',
        ),
    );

// This fixture uses the original drawing format, with deliberately asymmetric
// LSB-first rows. Opcodes, source coordinates and full color bytes stay intact.
test('Sharp drawing normalizes only bitmap bit order', () => {
    const memory = new Uint8Array(65536);
    memory.set([0xe6, 0, 0x90, 0xdf, 2, 3, 0xe0, 0x46, 1, 0xff], 0x8000);
    memory.set([1, 2, 4, 8, 16, 32, 64, 128], 0x9008);
    const result = decodeSharpBlock(memory, 0x8000);
    assert.equal(result.cells.length, 1);
    assert.deepEqual(result.cells[0].bitmap, [128, 64, 32, 16, 8, 4, 2, 1]);
    assert.deepEqual([result.cells[0].x, result.cells[0].y, result.cells[0].color], [3, 2, 0x46]);
    assert.deepEqual(Array.from(memory.subarray(0x9008, 0x9010)), [1, 2, 4, 8, 16, 32, 64, 128]);
    for (let byte = 0; byte < 256; byte++)
        assert.equal(reverseSharpByte(reverseSharpByte(byte)), byte);
});

test('Sharp MZF reader rejects truncation, overflow and unverified game data', () => {
    assert.throws(() => readSharpMzf(Buffer.alloc(127)), /Truncated/);
    const mzf = Buffer.alloc(129);
    mzf[0] = 1;
    mzf[18] = 1;
    mzf[20] = 0x60;
    mzf[21] = 0x39;
    mzf[22] = 8;
    mzf[23] = 0x11;
    const record = readSharpMzf(mzf);
    assert.deepEqual([record.length, record.load, record.execute], [1, 0x3960, 0x1108]);
    assert.throws(() => readSharpMzf(mzf.subarray(0, 128)), /Invalid/);
    assert.throws(() => recoverSharpMemory(mzf, ''), /Unsupported archived/);
    mzf[18] = 2;
    mzf[20] = mzf[21] = 255;
    assert.throws(() => readSharpMzf(Buffer.concat([mzf, Buffer.alloc(1)])), /Invalid/);
    assert.throws(() => extractSharpGraphics(new Uint8Array(65536)), /Unsupported/);
});

test('Sharp asset freezes independently recovered source checksums and all nine table ranges', async () => {
    const graphics = await loadGraphics('sharp-mz800');
    const bytes = await readFile(
        new URL('../../src/assets/graphics/sharp-mz800/graphics.json', import.meta.url),
    );
    assert.equal(sha(bytes), 'a3c3b3b6276f921d5892c53acee16eb5da906fb5c42c95d95a1800828463901d');
    assert.equal(graphics.sourceMZFSha256, SHARP_MZF_SHA256);
    assert.equal(graphics.sourceRamSha256, SHARP_RAM_SHA256);
    assert.equal(
        graphics.sourceRamSha256,
        '108ee5352b0eaf8c809f55c6624265e8c55b35a73534206a0d390f3ed322f78f',
    );
    assert.equal(graphics.platform, 'sharp-mz800');
    assert.deepEqual([graphics.width, graphics.height, graphics.playfieldHeight], [320, 200, 176]);
    const zx = await loadGraphics('zx-spectrum');
    const ranges: [TableName, number, string][] = [
        ['player', 2400, 'e1ab7926aa64bb055629b50d3c06ad073293c25d2ec77c053ffc8197bdfd93b7'],
        ['small', 1440, 'cabb8ba8a7d3235fac34575ccb85f61473f5df71ac5a7c07ad5f5ef3c117b348'],
        ['shifted', 576, '67a5768d513f171984386fcfbab91a9977a4429d5a97a0c72f8bda805fa39357'],
        ['font', 472, '3a5ffdee790fb4da9079192636231e69ffcd9318c152ca9c6c0e97ff5fbc954f'],
        ['torch', 48, 'a3ddf4f8f3d3c64df41def07c77279365e74f977b5dba04de74f63da85ca8e55'],
        ['beam', 8, '79382447c440577878287f7174a3c62f9d3c8d16109173bee1bcd5ac08234767'],
        ['mine', 32, '97963c7b32863454c2fa6c0c4dcf04cc4d19b789f9495499f8a356a755e414c0'],
        ['star', 8, '7b742c398b1a841a160d67298c4e11857acc1db71c3f90509722ca74733cb814'],
        ['turret', 128, '702c6abf15415bd4578965e305a396d700e8a35c6df8d59c220bbb0e7625815c'],
    ];
    for (const [name, length, sourceHash] of ranges) {
        assert.equal(graphics[name].length, length);
        assert.equal(
            sha(graphics[name].map(reverseSharpByte)),
            sourceHash,
            `Original LSB-first ${name}`,
        );
        assert.equal(graphics.sourceTableSha256[name], sourceHash);
        assert.equal(sha(graphics[name]), graphics.tableSha256[name]);
        assert.deepEqual(graphics[name], zx[name], `Every normalized ${name} byte, not a sample`);
    }
    assert.equal(graphics.shapes.length, 483);
    const changed = graphics.shapes.flatMap((shape, index) =>
        JSON.stringify(shape) === JSON.stringify(zx.shapes[index]) ? [] : [index],
    );
    assert.deepEqual(changed, [451]);
    assert.deepEqual(graphics.shapes[451], [254, 254, 254, 254, 254, 254, 254, 0]);
    assert.deepEqual(zx.shapes[451], [127, 127, 127, 127, 127, 127, 127, 0]);
    const world: { screens: { placements: unknown[] }[] } = JSON.parse(
        await readFile(new URL('../../src/data/world.json', import.meta.url), 'utf8'),
    );
    assert.equal(world.screens.length, 125);
    assert.equal(
        sha(JSON.stringify(world.screens.map((screen) => screen.placements))),
        graphics.sourceMapsSha256,
    );
    assert.equal(
        graphics.sourceMapsSha256,
        '1cbd9a5130c0b97948c07b2ad5cb7eafd06ff64b53d11dc8f7e7bc05a890a85d',
    );
});

test('Sharp screens and high scores retain Datelsoft text rather than borrowed ZX menus', async () => {
    const graphics = await loadGraphics('sharp-mz800');
    const zx = await loadGraphics('zx-spectrum');
    assert.deepEqual(
        Object.fromEntries(
            Object.entries(graphics.screens).map(([name, cells]) => [name, cells.length]),
        ),
        {
            menu: 154,
            logo: 50,
            scores: 318,
            hud: 70,
            gameOver: 33,
            hallOfFame: 370,
            bonus: 400,
            combat: 345,
            bravery: 382,
        },
    );
    assert.deepEqual(graphics.menuText, [
        { y: 7, text: 'BY  RAFFAELE CECCO' },
        { y: 11, text: '1 START GAME' },
        { y: 13, text: '2 DEFINE KEYS' },
        { y: 15, text: '3 KEYBOARD' },
        { y: 17, text: '4 CURSOR     ' },
        { y: 19, text: '5 JOYSTICK' },
        { y: 23, text: 'PRO SHARP UPRAVIL DATELSOFT ' },
    ]);
    // Read the actual emitted bitmap cells back through the recovered font.
    const letters = new Map(
        Array.from({ length: 59 }, (_, index) => [
            graphics.font.slice(index * 8, index * 8 + 8).join(','),
            String.fromCharCode(index + 32),
        ]),
    );
    const credit = graphics.screens.menu
        .filter((cell) => cell.y === 23)
        .map((cell) => letters.get(cell.bitmap.join(',')))
        .join('');
    assert.equal(credit, 'PRO SHARP UPRAVIL DATELSOFT ');
    assert.notDeepEqual(graphics.screens.menu, zx.screens.menu);
    assert.deepEqual(graphics.screens.scores, zx.screens.scores);
    assert.equal(graphics.sourceHighScores.length, 50);
    assert.deepEqual(graphics.sourceHighScores.slice(0, 5), [
        { name: 'DATEL', score: 100000 },
        { name: 'CECCO', score: 90000 },
        { name: 'ROBOCOP', score: 80000 },
        { name: 'BATMAN', score: 70000 },
        { name: 'R-TYPE', score: 60000 },
    ]);
    assert.deepEqual(graphics.sourceHighScores[49], { name: 'SEVILLE', score: 150 });
});
