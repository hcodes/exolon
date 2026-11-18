import { transformAsync } from '@babel/core';
import { minify } from 'terser';

// Polyfills must already be installed before application code runs.
export async function compileEs5(code, { development = false } = {}) {
    const transformed = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        presets: [
            [
                '@babel/preset-env',
                {
                    targets: { ios: '9.3' },
                    modules: false,
                    bugfixes: true,
                    forceAllTransforms: true,
                    // core-js must distinguish native Symbols from its object shim.
                    // Rewriting typeof breaks startup when Symbol is missing/partial.
                    exclude: ['transform-typeof-symbol'],
                },
            ],
        ],
        sourceMaps: false,
        compact: false,
        comments: development,
    });
    if (!transformed?.code) throw new Error('ES5 transform returned no JavaScript');
    if (development) return transformed.code + '\n';
    const result = await minify(transformed.code, {
        ecma: 5,
        format: { ecma: 5, comments: false },
        compress: { passes: 2 },
        mangle: true,
    });
    if (!result.code) throw new Error('ES5 minifier returned no JavaScript');
    return result.code + '\n';
}
