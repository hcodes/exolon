// Test-only module graph, generated on demand and never published with the game.
import { readdir, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { sourceRoot, transforms } from '../../rolldown.config.mjs';
import { stylesPlugin } from './styles.mjs';
import { versioningPlugin } from './versioning.mjs';

export const referenceRoot = fileURLToPath(new URL('../../.cache/reference/', import.meta.url));
/** @type {Promise<string> | undefined} */
let pending;
export function buildReferenceModules() {
    return (pending ??= (async () => {
        await rm(referenceRoot, { recursive: true, force: true });
        await mkdir(referenceRoot, { recursive: true });
        const { output, ...options } = await referenceConfig();
        const bundle = await rolldown(options);
        try {
            await bundle.write(output);
        } finally {
            await bundle.close();
        }
        return referenceRoot;
    })());
}

async function referenceConfig() {
    const input = {};
    async function visit(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'types') await visit(file);
            } else if (
                /\.(?:ts|tsx|js)$/.test(file) &&
                !file.endsWith('.d.ts') &&
                ![
                    'boot.ts',
                    'legacy.ts',
                    'legacy-runtime.ts',
                    'legacy-loader.ts',
                    'legacy-bridge.ts',
                ].includes(entry.name)
            ) {
                input[
                    path
                        .relative(sourceRoot, file)
                        .replace(/\.(?:tsx?|js)$/, '')
                        .split(path.sep)
                        .join('/')
                ] = file;
            }
        }
    }
    await visit(sourceRoot);
    return {
        input,
        platform: 'browser',
        preserveEntrySignatures: 'strict',
        transform: transforms,
        plugins: [
            stylesPlugin({ entry: path.join(sourceRoot, 'entries/main.tsx') }),
            versioningPlugin({ versionImports: false }),
        ],
        output: {
            dir: referenceRoot,
            format: 'es',
            preserveModules: true,
            preserveModulesRoot: sourceRoot,
            entryFileNames: '[name].js',
            sourcemap: false,
        },
    };
}
