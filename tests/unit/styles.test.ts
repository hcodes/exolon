import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rolldown } from 'rolldown';
import { stylesPlugin } from '../../tools/build/styles.mjs';

test('component CSS is extracted transitively in import order without runtime imports or duplicates', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'reex-styles-'));
    try {
        await mkdir(path.join(directory, 'component'));
        for (const [file, code] of Object.entries({
            'main.js': `import './base.css'; import './component/index.js'; import './base.css'; export const ready = true;`,
            'base.css': `.button { color: red; user-select: none; appearance: none; backdrop-filter: blur(2px); }`,
            'component/index.js': `import './index.css'; export const component = true;`,
            'component/index.css': `@media (max-width: 650px) { .button { color: blue; } }`,
            'unused.js': `import './unused.css'; export const unrelated = true;`,
            'unused.css': `.unrelated { color: green; }`,
        }))
            await writeFile(path.join(directory, file), code);
        const entry = path.join(directory, 'main.js');
        const bundle = await rolldown({
            input: [entry, path.join(directory, 'unused.js')],
            plugins: [stylesPlugin({ entry })],
        });
        try {
            const result = await bundle.generate({ format: 'es', preserveModules: true });
            const css = result.output.find(
                (item) => item.type === 'asset' && item.fileName === 'index.css',
            );
            assert.ok(css && css.type === 'asset');
            const text = String(css.source);
            assert.equal((text.match(/color: red/g) || []).length, 1);
            assert.ok(text.indexOf('color: red') < text.indexOf('color: blue'));
            assert.ok(!text.includes('.unrelated'));
            for (const property of ['user-select', 'appearance', 'backdrop-filter']) {
                assert.ok(
                    text.includes('-webkit-' + property + ':'),
                    'Missing Safari prefix: ' + property,
                );
                assert.match(text, new RegExp('(?:^|[;{\\s])' + property + ':'));
            }
            for (const item of result.output)
                if (item.type === 'chunk') {
                    assert.ok(!/import.*\.css/.test(item.code), item.fileName);
                    assert.ok(!item.fileName.endsWith('.css.js'), item.fileName);
                }
        } finally {
            await bundle.close();
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
