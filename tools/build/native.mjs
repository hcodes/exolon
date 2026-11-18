import { rolldown } from 'rolldown';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runtimeConfig, sourceRoot, transforms } from '../../rolldown.config.mjs';
import { stylesPlugin } from './styles.mjs';
import { versioningPlugin } from './versioning.mjs';

const development = process.argv.includes('--dev');
const { output, ...options } = runtimeConfig({ development });
const runtime = await rolldown(options);
try {
    await runtime.write(output);
} finally {
    await runtime.close();
}

// A private SSR bundle renders the picker; no individual modules enter dist.
const cache = new URL('../../.cache/build/', import.meta.url);
await mkdir(cache, { recursive: true });
const picker = await rolldown({
    input: path.join(sourceRoot, 'components/PlatformPicker/index.tsx'),
    platform: 'node',
    preserveEntrySignatures: 'strict',
    transform: transforms,
    plugins: [
        stylesPlugin({ entry: path.join(sourceRoot, 'components/PlatformPicker/index.tsx') }),
        versioningPlugin({ versionImports: false }),
    ],
});
try {
    await picker.write({
        file: fileURLToPath(new URL('platform-picker.mjs', cache)),
        format: 'es',
        minify: !development,
        sourcemap: false,
    });
} finally {
    await picker.close();
}
console.log(`Bundled native runtime built (${development ? 'development' : 'production'}).`);
