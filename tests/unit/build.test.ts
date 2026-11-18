import * as music from '../../src/audio/compressed/recordings.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import type { ComponentProps } from 'preact';
const root = new URL('../../', import.meta.url),
    run = promisify(execFile);
async function snapshot(directory: URL) {
    const files: Record<string, string> = {};
    async function visit(url: URL, prefix = '') {
        for (const item of await readdir(url, { withFileTypes: true })) {
            const path = prefix + item.name,
                child = new URL(item.name + (item.isDirectory() ? '/' : ''), url);
            if (item.isDirectory()) await visit(child, path + '/');
            else
                files[path] = createHash('sha256')
                    .update(await readFile(child))
                    .digest('hex');
        }
    }
    await visit(directory);
    return files;
}

test('build publishes a complete static dist without changing source files or leaving stale output', async () => {
    const before = await snapshot(new URL('src/', root));
    await run(
        process.execPath,
        ['--experimental-strip-types', fileURLToPath(new URL('tools/build/index.mjs', root))],
        { cwd: fileURLToPath(root), timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    assert.deepEqual(
        (await readdir(new URL('dist/', root), { recursive: true })).filter((file) =>
            file.endsWith('.map'),
        ),
        [],
        'Production output must not publish source maps',
    );
    assert.deepEqual(
        (await readdir(new URL('dist/', root), { recursive: true })).filter(
            (file) =>
                file.endsWith('.js') && file !== 'boot.js' && !/^(?:runtime|legacy)\//.test(file),
        ),
        [],
        'Only browser bundles belong in dist; individual source modules must stay outside it',
    );
    for (const file of [
        'index.html',
        'robots.txt',
        'llms.txt',
        'index.css',
        'boot.js',
        'runtime/main.js',
        'runtime/errors.js',
        'runtime/errors.css',
        'legacy/chunks.json',
        'data/world.json',
        'assets/images/shared/icons/favicon.svg',
        'assets/images/shared/icons/favicon.ico',
        'assets/images/shared/icons/apple-touch-icon.png',
        'assets/images/zx-spectrum/loading.png',
        'assets/images/c64/loading.png',
        'assets/images/amstrad-cpc/loading.png',
        'assets/images/sharp-mz800/loading.png',
        'assets/graphics/sharp-mz800/graphics.json',
        'audio/sharp-mz800/title.m4a',
        'assets/images/amiga/loading.png',
        'assets/graphics/amiga/resources.json',
        'games/amiga/data/world.json',
        'audio/amiga/title.m4a',
        'assets/images/atari-st/loading.png',
        'assets/images/vr/banner.png',
        'licenses/three.txt',
        'licenses/show-js-error.txt',
        'assets/graphics/atari-st/resources.json',
        'games/atari-st/data/world.json',
        'audio/atari-st/title.m4a',
        'audio/atari-st/game-over.m4a',
        'legacy/game.js',
        'legacy/index.css',
    ])
        assert.equal(existsSync(new URL('dist/' + file, root)), true, 'Missing dist/' + file);
    for (const { file } of Object.values(music)) {
        assert.deepEqual(
            await readFile(new URL('dist/audio/' + file, root)),
            await readFile(new URL('src/audio/' + file, root)),
            'Build copies the directly referenced music without re-encoding: ' + file,
        );
    }
    const published = await readdir(new URL('dist/', root), { recursive: true });
    assert.deepEqual(
        published.filter((file) =>
            /(?:^|\/)(?:originals|archive|reference|source)(?:\/|$)|\.(?:bin|sid|sndh|snr|ayr|ym14|fnt|md)$|\/(?:title|game-over)\.wav$|provenance\.json$|render\.json$/.test(
                file,
            ),
        ),
        [],
        'No archival inputs, music WAV or provenance are deployed',
    );
    for (const file of ['robots.txt', 'llms.txt'])
        assert.deepEqual(
            await readFile(new URL('dist/' + file, root)),
            await readFile(new URL('src/' + file, root)),
            `Static metadata must be copied unchanged: ${file}`,
        );
    const robots = await readFile(new URL('dist/robots.txt', root), 'utf8');
    assert.match(robots, /^User-agent: \*$/m);
    assert.match(robots, /^Sitemap: https:\/\/hcodes\.github\.io\/exolon\/sitemap\.xml$/m);
    const llms = await readFile(new URL('dist/llms.txt', root), 'utf8');
    assert.match(llms, /^# Exolon \/ reex\n/);
    const html = await readFile(new URL('dist/index.html', root), 'utf8');
    assert.equal((html.match(/<h1\b/g) || []).length, 1, 'One prerendered heading');
    assert.equal((html.match(/data-platform=/g) || []).length, 8, 'Eight platform banners');
    assert.ok(!html.includes('<!-- platform-picker-prerender -->'));
    assert.ok(html.includes('data-prerendered'));
    assert.match(html, /<link rel="describedby" href="\.\/llms\.txt"/);
    const sitemap = await readFile(new URL('dist/sitemap.xml', root), 'utf8');
    assert.match(sitemap, /xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9"/);
    assert.deepEqual(
        [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]),
        ['https://hcodes.github.io/exolon/'],
    );
    const banner = 'assets/images/remastered/previews/banner.jpg';
    assert.ok(html.includes(banner), 'The initial page loads the small Remastered preview');
    assert.ok(!html.includes('intro-green-weapon.jpg'), 'Do not load full-size art in the picker');
    const preview = await readFile(new URL('dist/' + banner, root));
    assert.ok(preview.length < 100000, 'The banner preview must stay below 100 KB');
    assert.deepEqual(preview, await readFile(new URL('src/' + banner, root)));
    const social = await readFile(new URL('dist/assets/images/shared/social/exolon.png', root));
    assert.equal(social.readUInt32BE(16), 1200);
    assert.equal(social.readUInt32BE(20), 630);
    assert.ok(social.length < 200000, 'Social preview should stay lightweight');
    const stylesheet = await readFile(new URL('dist/index.css', root), 'utf8');
    const legacyStylesheet = await readFile(new URL('dist/legacy/index.css', root), 'utf8');
    for (const selector of [
        '.game-app',
        '.game-viewport__display',
        '.game-footer__options',
        '.title-menu',
        '.toolbar',
        '.touch-controls',
        '.fullscreen-button',
        '.cheat-settings',
        '.high-scores',
        '.hud',
        '.button_primary',
        '.native-game__menu',
        '.vr-game__canvas',
    ]) {
        assert.ok(stylesheet.includes(selector), 'Missing component CSS: ' + selector);
        assert.ok(legacyStylesheet.includes(selector), 'Missing legacy component CSS: ' + selector);
    }
    for (const css of [stylesheet, legacyStylesheet]) {
        assert.ok(
            css.includes('-webkit-backdrop-filter:'),
            'Safari CSS prefixes must be generated in both builds',
        );
    }
    assert.ok(!/\.exolon[\w-]*/.test(stylesheet), 'Old prefixed CSS classes must not survive');
    assert.ok(!/@import\b/.test(stylesheet), 'CSS must be bundled before the app mounts');
    assert.ok(
        !/#(?:[\da-f]{8}|[\da-f]{4})\b/i.test(legacyStylesheet),
        'Safari 9 needs RGBA colours',
    );
    assert.equal(
        existsSync(new URL('dist/components/App/index.css', root)),
        false,
        'Component CSS sources must be bundled, not copied into dist',
    );
    assert.deepEqual(
        await snapshot(new URL('src/', root)),
        before,
        'Normal builds must not generate or modify files in src',
    );
    for (const platform of [
        'zx-spectrum',
        'c64',
        'amstrad-cpc',
        'sharp-mz800',
        'amiga',
        'atari-st',
    ]) {
        const file = 'assets/images/' + platform + '/loading.png';
        assert.deepEqual(
            await readFile(new URL('dist/' + file, root)),
            await readFile(new URL('src/' + file, root)),
            'Saved loading pixels are copied unchanged: ' + file,
        );
    }
    assert.equal(
        existsSync(new URL('dist/images/', root)),
        false,
        'Legacy flat image paths must not survive a clean build',
    );
    assert.equal(
        existsSync(new URL('dist/lib/LocalStorage/index.ts', root)),
        false,
        'TypeScript sources must not be published',
    );
    assert.equal(
        existsSync(new URL('dist/lib/LocalStorage/index.js', root)),
        false,
        'Storage must be included in bundles, not emitted as a separate module',
    );
    assert.equal(
        existsSync(new URL('dist/components/App/index.js', root)),
        false,
        'The Preact shell must be bundled',
    );
    assert.equal(existsSync(new URL('dist/entries/main.tsx', root)), false);
    assert.equal(
        existsSync(new URL('dist/entries/legacy.js', root)),
        false,
        'Bare polyfill imports must not leak into the static site',
    );
    const productionMain = await readFile(new URL('dist/runtime/main.js', root), 'utf8');
    const productionLegacy = await readFile(new URL('dist/legacy/game.js', root), 'utf8');
    const boot = await readFile(new URL('dist/boot.js', root), 'utf8');
    assert.ok(boot.includes('./runtime/main.js'), 'The published boot uses bundled runtime');
    assert.ok(!boot.includes('./entries/main.js'), 'The reference graph is opt-in');
    const native = await readFile(new URL('.cache/build/platform-picker.mjs', root), 'utf8');
    assert.ok(!/from\s*['"][^'"]+\.ts['"]/.test(native));
    await writeFile(new URL('dist/stale-build-marker.txt', root), 'previous build');
    await run(
        process.execPath,
        [
            '--experimental-strip-types',
            fileURLToPath(new URL('tools/build/index.mjs', root)),
            '--dev',
        ],
        { cwd: fileURLToPath(root), timeout: 120000, maxBuffer: 1024 * 1024 },
    );
    assert.equal(
        existsSync(new URL('dist/stale-build-marker.txt', root)),
        false,
        'Clean builds remove obsolete artifacts',
    );
    assert.deepEqual(
        (await readdir(new URL('dist/', root), { recursive: true })).filter((file) =>
            file.endsWith('.map'),
        ),
        [],
        'Development output must not publish source maps',
    );
    assert.deepEqual(
        (await readdir(new URL('dist/', root), { recursive: true })).filter(
            (file) =>
                file.endsWith('.js') && file !== 'boot.js' && !/^(?:runtime|legacy)\//.test(file),
        ),
        [],
        'Development output must contain only bundles as well',
    );

    assert.deepEqual(await snapshot(new URL('src/', root)), before);
    assert.ok(
        (await readFile(new URL('dist/runtime/main.js', root), 'utf8')).length >
            productionMain.length,
        'Development bundles are unminified',
    );
    assert.ok(
        (await readFile(new URL('dist/legacy/game.js', root), 'utf8')).length >
            productionLegacy.length,
        'Legacy development bundles are unminified',
    );
});

test('bundled runtime keeps deferred engines and normalizes original asset URLs in both modes', async () => {
    const configuration = await import('../../rolldown.config.mjs');
    const { rolldown } = await import('rolldown');
    const variants = [];
    for (const development of [true, false]) {
        const { output, ...options } = configuration.runtimeConfig({ development });
        const bundle = await rolldown(options);
        try {
            const generated = await bundle.generate(output);
            const chunks = generated.output.filter((item) => item.type === 'chunk');
            const main = chunks.find((chunk) => chunk.fileName === 'runtime/main.js');
            assert.ok(main, 'Stable runtime/main.js entry');
            assert.ok(chunks.some((chunk) => /^runtime\/classic-[^/]+\.js$/.test(chunk.fileName)));
            assert.ok(chunks.some((chunk) => /^runtime\/amiga-[^/]+\.js$/.test(chunk.fileName)));
            assert.ok(chunks.some((chunk) => /^runtime\/atari-st-[^/]+\.js$/.test(chunk.fileName)));
            const vr = chunks.find((chunk) => chunk.fileName === 'runtime/vr.js');
            assert.ok(vr?.isEntry, 'VR has its own explicit build entry');
            assert.ok(
                vr.exports.includes('buildId'),
                'VR exposes its build identity before mounting',
            );
            assert.ok(vr.moduleIds.some((id) => id.endsWith('/entries/vr.ts')));
            function modulesFor(entry: (typeof chunks)[number], dynamic = false) {
                const modules = new Set<string>();
                const visited = new Set<string>();
                function collect(chunk: (typeof chunks)[number]) {
                    if (visited.has(chunk.fileName)) return;
                    visited.add(chunk.fileName);
                    for (const id of chunk.moduleIds) modules.add(id);
                    for (const dependency of [
                        ...chunk.imports,
                        ...(dynamic ? chunk.dynamicImports : []),
                    ]) {
                        const next = chunks.find((candidate) => candidate.fileName === dependency);
                        if (next) collect(next);
                    }
                }
                collect(entry);
                return [...modules];
            }
            assert.ok(
                modulesFor(vr).some((id) => id.includes('/node_modules/three/')),
                'The VR entry owns Three.js',
            );
            const vrModules =
                /\/(?:node_modules\/three|games\/vr|controllers\/vr|components\/VrGame|entries\/vr\.ts)(?:\/|$)/;
            for (const entry of [
                main,
                ...chunks.filter((chunk) =>
                    /^runtime\/(?:classic|amiga|atari-st)-/.test(chunk.fileName),
                ),
            ]) {
                assert.ok(
                    !modulesFor(entry, true).some((id) => vrModules.test(id)),
                    `${entry.fileName} cannot pull VR or Three.js through any bundled dependency`,
                );
            }
            assert.match(
                main.code,
                /runtime\/vr\.js\?v=[a-f0-9]{16}/,
                'The external VR entry URL is versioned',
            );
            const initialModules = new Set<string>();
            const visit = (chunk: (typeof chunks)[number]) => {
                for (const id of chunk.moduleIds) initialModules.add(id);
                for (const dependency of chunk.imports) {
                    const next = chunks.find((candidate) => candidate.fileName === dependency);
                    if (next) visit(next);
                }
            };
            visit(main);
            assert.ok(
                ![...initialModules].some((id) => /\/(?:model|view)\//.test(id)),
                'Picker must not import model/renderers',
            );
            assert.ok(
                chunks.every((chunk) => !chunk.code.includes('import.meta.url')),
                'Bundled assets retain their document-relative source paths',
            );
            const sharp = chunks.find((chunk) =>
                chunk.moduleIds.some((id) => id.endsWith('/audio/sharp-mz800/manifest.js')),
            );
            assert.ok(
                sharp?.code.includes('audio/sharp-mz800/manifest.js'),
                'Template audio URLs must use their original source folder',
            );
            variants.push({
                size: chunks.reduce((total, chunk) => total + chunk.code.length, 0),
                modules: chunks.map((chunk) => [...chunk.moduleIds].sort().join('\n')).sort(),
            });
        } finally {
            await bundle.close();
        }
    }
    assert.deepEqual(
        variants[0].modules,
        variants[1].modules,
        'Dev and production keep identical module boundaries',
    );
    assert.ok(variants[1].size < variants[0].size * 0.8, 'Only production is minified');
});

test('deferred legacy engines remain ES5 and share the shell Preact and hooks instances', async () => {
    const { legacyArtifacts } = await import('../../tools/build/legacy-artifacts.mjs');
    const preact = await import('preact');
    const hooks = await import('preact/hooks');
    const jsxRuntime = await import('preact/jsx-runtime');
    const { renderToString } = await import('preact-render-to-string');
    const sizes = [];
    for (const development of [true, false]) {
        const { files, chunks } = await legacyArtifacts({ development });
        assert.equal(files.size, 4, 'One shell and three separately deferred games');
        assert.deepEqual(Object.keys(chunks), ['classic', 'amiga', 'atari']);
        for (const code of files.values())
            assert.doesNotMatch(
                code,
                /WebXRManager|WebGLRenderer|threejs\.org/,
                'Three.js stays outside every legacy bundle',
            );
        const shell = files.get('game.js');
        assert.ok(shell);
        assert.ok(
            !shell.includes('audio/sharp-mz800/manifest.js'),
            'Classic engine data must stay out of the shell',
        );
        if (!development)
            assert.ok(
                shell.length < 450000,
                'Initial ES5 payload must contain only shell and polyfills',
            );
        const bridge = {
            preact,
            hooks,
            jsxRuntime,
            games: {} as {
                classic?: typeof import('../../src/components/App/index.tsx');
                amiga?: typeof import('../../src/components/AmigaGame/index.tsx');
                atari?: typeof import('../../src/components/AtariGame/index.tsx');
            },
        };
        const context = vm.createContext({
            __reexLegacy: bridge,
            URL,
            URLSearchParams,
            document: { baseURI: 'https://example.test/reex/' },
        });
        for (const [name, code] of files) {
            const syntax = ts.createSourceFile(name, code, ts.ScriptTarget.ES5, true);
            function visit(node: ts.Node) {
                assert.ok(
                    !ts.isArrowFunction(node) &&
                        !ts.isClassDeclaration(node) &&
                        !ts.isTemplateExpression(node),
                    'ES5 syntax: ' + name,
                );
                if (ts.isVariableDeclarationList(node))
                    assert.equal(
                        node.flags & ts.NodeFlags.BlockScoped,
                        0,
                        'ES5 var declarations: ' + name,
                    );
                ts.forEachChild(node, visit);
            }
            visit(syntax);
            if (name !== 'game.js') vm.runInContext(code, context);
        }
        assert.equal(bridge.preact, preact);
        assert.equal(bridge.hooks, hooks);
        assert.ok(
            bridge.games.classic && bridge.games.amiga && bridge.games.atari,
            'Each IIFE registers its exports',
        );
        assert.match(
            renderToString(
                preact.createElement<ComponentProps<typeof bridge.games.classic.App>>(
                    bridge.games.classic.App,
                    {},
                ),
            ),
            /class="game-app/,
        );
        for (const [name, url] of Object.entries(chunks)) {
            assert.ok(
                /^\.\/legacy\/(classic|amiga|atari-st)-[a-f0-9]+\.js\?v=[a-f0-9]{16}$/.test(
                    String(url),
                ),
                name,
            );
            assert.ok(files.has(String(url).replace('./legacy/', '').split('?')[0]));
            assert.ok(shell.includes(String(url)), 'Shell manifest points to its emitted engines');
        }
        sizes.push([...files.values()].reduce((size, code) => size + code.length, 0));
    }
    assert.ok(sizes[1] < sizes[0] * 0.8, 'Production alone minifies legacy code');
});
