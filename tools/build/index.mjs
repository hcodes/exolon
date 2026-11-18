// A clean static build; source files and archival inputs are read-only.
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = new URL('../../src/', import.meta.url),
    output = new URL('../../dist/', import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
async function copyResources(directory = source, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = prefix + entry.name;
        if (entry.isDirectory()) {
            await copyResources(new URL(entry.name + '/', directory), file + '/');
        } else if (/\.(?:html|json|png|jpe?g|svg|ico|wav|mp3|m4a|txt)$/.test(entry.name)) {
            const target = new URL(file, output);
            await mkdir(new URL('.', target), { recursive: true });
            await cp(new URL(entry.name, directory), target);
        }
    }
}
await copyResources();
for (const stage of ['./native.mjs', './legacy.mjs', './boot.mjs', './html.mjs'])
    await import(stage);
await mkdir(new URL('licenses/', output), { recursive: true });
await cp(
    new URL('../../node_modules/preact/LICENSE', import.meta.url),
    new URL('licenses/preact.txt', output),
);
await cp(
    new URL('../../node_modules/lyam/LICENSE', import.meta.url),
    new URL('licenses/lyam.txt', output),
);
await cp(
    new URL('../../node_modules/classnames/LICENSE', import.meta.url),
    new URL('licenses/classnames.txt', output),
);
await cp(
    new URL('../../node_modules/three/LICENSE', import.meta.url),
    new URL('licenses/three.txt', output),
);
await cp(
    new URL('../../node_modules/show-js-error/LICENSE', import.meta.url),
    new URL('licenses/show-js-error.txt', output),
);
console.log(`Static game built in ${fileURLToPath(output)}`);
