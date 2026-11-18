import { defineConfig } from 'rolldown';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stylesPlugin } from './tools/build/styles.mjs';
import { versioningPlugin } from './tools/build/versioning.mjs';

export const sourceRoot = fileURLToPath(new URL('./src/', import.meta.url));
export const outputRoot = fileURLToPath(new URL('./dist/', import.meta.url));
export const transforms = { define: { 'process.env.NODE_ENV': JSON.stringify('production') } };

// Bundled files live in runtime/, but resources retain their original document-relative paths.
// This also handles template URLs in the generated, byte-preserved audio manifests.
export function sourceUrlsPlugin() {
    return {
        name: 'document-relative-source-urls',
        transform(code, id) {
            if (!code.includes('import.meta.url') || !id.startsWith(sourceRoot)) return null;
            const relative = path.relative(sourceRoot, id).split(path.sep).join('/');
            return {
                code: code.replaceAll(
                    'import.meta.url',
                    `new URL(${JSON.stringify(relative)},document.baseURI).href`,
                ),
                map: null,
            };
        },
    };
}

export const legacyGameEntries = {
    classic: path.join(sourceRoot, 'components/App/index.tsx'),
    amiga: path.join(sourceRoot, 'components/AmigaGame/index.tsx'),
    'atari-st': path.join(sourceRoot, 'components/AtariGame/index.tsx'),
};
export const gameEntries = {
    ...legacyGameEntries,
    vr: path.join(sourceRoot, 'entries/vr.ts'),
};

/** @returns {import('rolldown').InputOptions & { output: import('rolldown').OutputOptions }} */
export function runtimeConfig({ development = false } = {}) {
    return {
        input: {
            main: path.join(sourceRoot, 'entries/main.tsx'),
            vr: gameEntries.vr,
        },
        platform: 'browser',
        preserveEntrySignatures: 'strict',
        transform: transforms,
        plugins: [
            stylesPlugin({
                entry: path.join(sourceRoot, 'entries/main.tsx'),
                additionalEntries: [gameEntries.vr],
            }),
            sourceUrlsPlugin(),
            versioningPlugin(),
        ],
        output: {
            dir: outputRoot,
            format: 'es',
            entryFileNames: 'runtime/[name].js',
            chunkFileNames(chunk) {
                const game = Object.entries(gameEntries).find(
                    ([, entry]) => entry === chunk.facadeModuleId,
                )?.[0];
                return game ? `runtime/${game}-[hash].js` : 'runtime/chunks/[name]-[hash].js';
            },
            minify: !development,
            sourcemap: false,
        },
    };
}

export const legacyGlobals = {
    preact: '__reexLegacy.preact',
    'preact/hooks': '__reexLegacy.hooks',
    'preact/jsx-runtime': '__reexLegacy.jsxRuntime',
};

export function legacyConfig({ chunks = {} } = {}) {
    return {
        input: path.join(sourceRoot, 'entries/legacy.ts'),
        platform: 'browser',
        transform: {
            define: { ...transforms.define, __REEX_LEGACY_CHUNKS__: JSON.stringify(chunks) },
        },
        plugins: [
            stylesPlugin({ entry: path.join(sourceRoot, 'entries/legacy.ts') }),
            sourceUrlsPlugin(),
            versioningPlugin(),
            {
                name: 'deferred-legacy-games',
                resolveId(source, importer) {
                    if (
                        importer &&
                        path.resolve(path.dirname(importer), source) ===
                            path.join(sourceRoot, 'services/game-loader.ts')
                    )
                        return path.join(sourceRoot, 'compat/legacy-loader.ts');
                    return null;
                },
            },
        ],
    };
}

export function legacyGameConfig(game) {
    return {
        input: legacyGameEntries[game],
        platform: 'browser',
        transform: transforms,
        external: Object.keys(legacyGlobals),
        plugins: [
            stylesPlugin({ entry: legacyGameEntries[game] }),
            sourceUrlsPlugin(),
            versioningPlugin(),
        ],
    };
}
export default defineConfig(runtimeConfig);
