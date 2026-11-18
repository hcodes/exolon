import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { compileEs5 } from '../../tools/build/es5.mjs';

for (const symbols of ['native', 'missing', 'chromium38'] as const) {
    test(`selective legacy polyfills restore shell and game APIs with ${symbols} Symbols`, async () => {
        const bundle = await rolldown({
            input: fileURLToPath(new URL('../../src/compat/legacy-polyfills.ts', import.meta.url)),
            platform: 'browser',
        });
        try {
            const { output } = await bundle.generate({ format: 'iife', codeSplitting: false });
            const script = output.find((item) => item.type === 'chunk');
            assert.ok(script);
            const code = await compileEs5(script.code);
            // This realm has no URL/Fetch and deliberately lacks required language APIs.
            // The Node host and other tests retain their native globals.
            const context = vm.createContext({ setTimeout, clearTimeout });
            if (symbols === 'missing') vm.runInContext('Symbol = undefined;', context);
            // core-js replaces incomplete native Symbols on Chromium before 41.
            if (symbols === 'chromium38')
                vm.runInContext('navigator = { userAgent: "Chrome/38.0.2125.122" };', context);
            vm.runInContext(
                `
            Promise = Map = Set = WeakMap = WeakSet = undefined;
            for (const name of ['assign', 'entries', 'values', 'fromEntries', 'groupBy']) delete Object[name];
            for (const name of ['from']) delete Array[name];
            for (const name of ['fill', 'find', 'findIndex', 'flatMap', 'includes']) delete Array.prototype[name];
            for (const name of ['includes', 'startsWith', 'endsWith', 'padStart', 'padEnd']) delete String.prototype[name];
            for (const name of ['isFinite', 'isInteger', 'isSafeInteger']) delete Number[name];
            for (const name of ['hypot', 'imul', 'sign', 'tanh', 'trunc']) delete Math[name];
            const typed = Object.getPrototypeOf(Uint8Array.prototype);
            delete typed.fill;
            delete typed.slice;
            `,
                context,
            );
            vm.runInContext(code, context);
            const result = await vm.runInContext(
                `
            (async function () {
                const key = {};
                const map = new Map([['score', 125]]);
                const weak = new WeakMap([[key, 'player']]);
                const weakSet = new WeakSet([key]);
                const typed = new Uint8Array(3).fill(7).slice(1);
                const url = new URL('../game?level=26', 'https://example.test/reex/index.html');
                url.searchParams.set('graphics', 'c64');
                let finished = false;
                const values = await Promise.all([Promise.resolve(2), 3]).finally(function () { finished = true; });
                return JSON.stringify({
                    objects: Object.fromEntries(Object.entries(Object.assign({}, { score: 125 }))),
                    values: Object.values({ score: 125 }),
                    arrays: Array.from(new Set([1, 1, 2])).flatMap(function (v) { return [v, v]; }),
                    fill: Array(2).fill(9),
                    find: [1, 2].find(function (v) { return v === 2; }),
                    findIndex: [1, 2].findIndex(function (v) { return v === 2; }),
                    includes: [1, 2].includes(2),
                    strings: 'x'.padStart(2, '0').padEnd(3, '_'),
                    stringChecks: 'native'.includes('ativ') && 'native'.startsWith('na') && 'native'.endsWith('ve'),
                    numbers: Number.isFinite(2) && Number.isInteger(2) && Number.isSafeInteger(2),
                    math: [Math.hypot(3, 4), Math.imul(3, 4), Math.sign(-2), Math.tanh(0), Math.trunc(2.9)],
                    collections: [map.get('score'), weak.get(key), weakSet.has(key)],
                    typed: Array.from(typed),
                    url: url.href,
                    promise: values,
                    finished: finished,
                    fetch: typeof fetch,
                    symbol: String(Symbol('player')).startsWith('Symbol('),
                    unused: [typeof Set.prototype.union, typeof Object.groupBy, typeof Promise.withResolvers]
                });
            })()
            `,
                context,
            );
            assert.deepEqual(JSON.parse(result), {
                objects: { score: 125 },
                values: [125],
                arrays: [1, 1, 2, 2],
                fill: [9, 9],
                find: 2,
                findIndex: 1,
                includes: true,
                strings: '0x_',
                stringChecks: true,
                numbers: true,
                math: [5, 12, -1, 0, 2],
                collections: [125, 'player', true],
                typed: [7, 7],
                url: 'https://example.test/game?level=26&graphics=c64',
                promise: [2, 3],
                finished: true,
                fetch: 'function',
                symbol: true,
                unused: ['undefined', 'undefined', 'undefined'],
            });
        } finally {
            await bundle.close();
        }
    });
}
