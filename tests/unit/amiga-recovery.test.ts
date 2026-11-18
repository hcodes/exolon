import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    readAmigaLoadPlan,
    recoverAmigaMemory,
    copyAmigaRegions,
} from '../../tools/recovery/amiga.mjs';

test('Amiga loader recovers every original native disk-read record', async () => {
    const fixture = JSON.parse(
        await readFile(new URL('../../research/amiga-loader.json', import.meta.url), 'utf8'),
    );
    const loads = readAmigaLoadPlan(Buffer.from(fixture.startupHex, 'hex'));
    assert.equal(loads.length, 30);
    assert.deepEqual(loads, fixture.loads.slice(5));
    assert.deepEqual(loads[0], { source: 0x2b200, target: 0x2926c, length: 0x2800 });
    assert.deepEqual(loads.at(-1), { source: 0x43400, target: 0x42e70, length: 0x871d });
});

test('Amiga recovery rejects truncated, changed or unbounded source data', () => {
    assert.throws(() => recoverAmigaMemory(new Uint8Array(100)), /size/i);
    assert.throws(() => recoverAmigaMemory(new Uint8Array(901120)), /checksum/i);
    assert.throws(() => readAmigaLoadPlan(new Uint8Array(10)), /startup/i);
    assert.throws(
        () => copyAmigaRegions(new Uint8Array(16), [{ source: 15, target: 0, length: 2 }]),
        /region/i,
    );
    assert.throws(
        () => copyAmigaRegions(new Uint8Array(16), [{ source: 0, target: 0x7ffff, length: 2 }]),
        /region/i,
    );
    assert.throws(
        () => copyAmigaRegions(new Uint8Array(16), [{ source: -1, target: 0, length: 2 }]),
        /region/i,
    );
    const disk = new Uint8Array([1, 2, 3, 4]);
    const memory = copyAmigaRegions(disk, [{ source: 1, target: 0x10, length: 2 }]);
    assert.equal(memory.length, 0x80000);
    assert.deepEqual(Array.from(memory.slice(0x10, 0x12)), [2, 3]);
    assert.deepEqual(Array.from(disk), [1, 2, 3, 4]);
});
