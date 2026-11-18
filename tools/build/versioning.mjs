import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const contentVersion = (bytes) =>
    createHash('sha256').update(bytes).digest('hex').slice(0, 16);
async function files(directory) {
    try {
        return (await readdir(directory, { recursive: true, withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(entry.parentPath, entry.name))
            .sort();
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}
export async function readVersions(directory = root, { development = false } = {}) {
    const source = path.join(directory, 'src');
    const output = path.join(directory, 'dist');
    /** @type {Record<string, string>} */
    const assets = {};
    for (const file of await files(output)) {
        const relative = path.relative(output, file).split(path.sep).join('/');
        if (
            /^(?:assets\/|audio\/|data\/|games\/.*\/data\/)/.test(relative) &&
            /\.(?:json|png|jpe?g|svg|ico|wav|mp3|m4a|fnt)$/.test(relative) &&
            !relative.includes('/social/')
        )
            assets[relative] = contentVersion(await readFile(file));
    }
    const hash = createHash('sha256');
    for (const file of [
        ...(await files(source)),
        ...(await files(path.join(directory, 'tools/build'))),
    ]) {
        if (!/\.(?:[cm]?js|tsx?|css|html)$/.test(file)) continue;
        hash.update(path.relative(directory, file).split(path.sep).join('/'));
        hash.update('\0')
            .update(await readFile(file))
            .update('\0');
    }
    for (const name of ['rolldown.config.mjs', 'package-lock.json', '.browserslistrc']) {
        try {
            hash.update(name)
                .update('\0')
                .update(await readFile(path.join(directory, name)));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    }
    hash.update(JSON.stringify(assets)).update(development ? 'development' : 'production');
    return { code: hash.digest('hex').slice(0, 16), assets };
}
let current;
export function buildVersions() {
    return (current ??= readVersions(root, { development: process.argv.includes('--dev') }));
}

export function versionModuleImports(code, version) {
    return code.replace(
        /\b(from\s*|import\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"\n]+\.js)(\2)/g,
        (_, prefix, quote, file) => `${prefix}${quote}${file}?v=${version}${quote}`,
    );
}
export function versioningPlugin({ versionImports = true } = {}) {
    let versions;
    return {
        name: 'asset-url-versions',
        async buildStart() {
            versions = await buildVersions();
        },
        transform(code, id) {
            if (id === path.join(root, 'src/entries/vr.ts')) {
                const marker = "/* @runtime-build */ ''";
                if (!code.includes(marker)) this.error('Missing VR build identity marker');
                return { code: code.replace(marker, JSON.stringify(versions.code)), map: null };
            }
            if (id === path.join(root, 'src/services/game-loader.ts')) {
                const marker = "/* @vr-entry */ './runtime/vr.js'";
                if (!code.includes(marker)) this.error('Missing VR entry version marker');
                return {
                    code: code.replace(
                        marker,
                        JSON.stringify('./runtime/vr.js?v=' + versions.code),
                    ),
                    map: null,
                };
            }
            if (id !== path.join(root, 'src/services/asset-url.ts')) return null;
            if (!code.includes('/* @asset-versions */ {}'))
                this.error('Missing asset version marker');
            return {
                code: code.replace('/* @asset-versions */ {}', JSON.stringify(versions.assets)),
                map: null,
            };
        },
        renderChunk(code, _chunk, options) {
            return versionImports && options.format === 'es'
                ? { code: versionModuleImports(code, versions.code), map: null }
                : null;
        },
    };
}
