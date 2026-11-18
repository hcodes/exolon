import { rolldown } from 'rolldown';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileEs5 } from './es5.mjs';
import { buildVersions, contentVersion } from './versioning.mjs';
import { stylesPlugin } from './styles.mjs';
const bundle = await rolldown({
    input: fileURLToPath(new URL('../../src/entries/boot.ts', import.meta.url)),
    platform: 'browser',
});
try {
    const { output } = await bundle.generate({ format: 'iife' });
    const versions = await buildVersions();
    let source = output[0].code;
    for (const file of ['legacy/game.js', 'legacy/index.css', 'runtime/main.js']) {
        const version = file.endsWith('.css')
            ? contentVersion(await readFile(new URL('../../dist/' + file, import.meta.url)))
            : versions.code;
        source = source.replace('./' + file, './' + file + '?v=' + version);
    }
    const code = await compileEs5(source, { development: process.argv.includes('--dev') });
    await writeFile(new URL('../../dist/boot.js', import.meta.url), code);
} finally {
    await bundle.close();
}

// Diagnostics run before either application, including before legacy polyfills.
const errorsEntry = fileURLToPath(new URL('../../src/entries/errors.ts', import.meta.url));
const errorsBundle = await rolldown({
    input: errorsEntry,
    platform: 'browser',
    plugins: [
        {
            name: 'error-panel-extracted-styles',
            transform(code, id) {
                if (!id.endsWith('/show-js-error/dist/show-js-error.esm.js')) return null;
                const injection = 'injectStyle(STYLE)';
                if (code.split(injection).length !== 3)
                    this.error('show-js-error style injection changed; review CSS extraction');
                return {
                    code: "import './index.css';\n" + code.replaceAll(injection, 'undefined'),
                    map: null,
                };
            },
        },
        stylesPlugin({ entry: errorsEntry, fileName: 'errors.css' }),
    ],
});
try {
    const { output } = await errorsBundle.generate({ format: 'iife' });
    for (const item of output) {
        const file = item.type === 'asset' ? item.fileName : 'errors.js';
        const source =
            item.type === 'asset'
                ? item.source
                : await compileEs5(item.code, { development: process.argv.includes('--dev') });
        await writeFile(new URL('../../dist/runtime/' + file, import.meta.url), source);
    }
} finally {
    await errorsBundle.close();
}
