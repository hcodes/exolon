import test from 'node:test';
import assert from 'node:assert/strict';
import { createOptionalGraphicsInstaller } from '../../src/controllers/optional-graphics.ts';

test('optional graphics installation shares pending work and ignores unrelated modes', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
        resolve = done;
    });
    let loads = 0;
    const installed: unknown[] = [];
    const missing: string[] = [];
    const bank = { platform: 'c64' };
    const ensure = createOptionalGraphicsInstaller({
        loaders: {
            c64: () => {
                loads++;
                return pending;
            },
            cpc: async () => null,
            'sharp-mz800': async () => null,
        },
        renderer: {
            setC64Graphics(data) {
                installed.push(data);
                return true;
            },
            setCpcGraphics: () => false,
            setSharpGraphics: () => false,
        },
        isDisposed: () => false,
        onUnavailable: (mode) => missing.push(mode),
    });
    const first = ensure(['c64', 'c64', 'remastered']);
    const second = ensure(['c64']);
    assert.equal(loads, 1);
    resolve(bank);
    await Promise.all([first, second]);
    await ensure(['c64']);
    assert.deepEqual(installed, [bank]);
    assert.deepEqual(missing, []);
});

test('optional graphics reports rejected artwork once and ignores late cancelled loads', async () => {
    let disposed = false;
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
        resolve = done;
    });
    let lateInstalls = 0;
    const missing: string[] = [];
    const ensure = createOptionalGraphicsInstaller({
        loaders: { c64: async () => null, cpc: async () => null, 'sharp-mz800': () => pending },
        renderer: {
            setC64Graphics: () => {
                throw new Error('Malformed bank');
            },
            setCpcGraphics: () => false,
            setSharpGraphics: () => {
                lateInstalls++;
                return true;
            },
        },
        isDisposed: () => disposed,
        onUnavailable: (mode) => missing.push(mode),
    });
    await ensure(['c64', 'cpc', 'c64']);
    await ensure(['c64']);
    assert.deepEqual(missing, ['c64', 'cpc']);
    const late = ensure(['sharp-mz800']);
    disposed = true;
    resolve({});
    await late;
    assert.equal(lateInstalls, 0);
    assert.deepEqual(missing, ['c64', 'cpc']);
});
